import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from './supabase';
import { getBusinessZone } from './time';

export type Period = 'week' | 'maand' | 'jaar' | 'alles';

export interface Stats {
  planned: number;
  upcoming: number;
  completed: number;
  cancelled: number;
  no_show: number;
  revenue_planned_cents: number;
  revenue_completed_cents: number;
  price_unknown: number;
  first_start: string | null;
  by_team: { team_id: string | null; name: string; color: string | null; count: number; revenue_cents: number }[];
  by_service: { name: string; count: number }[];
  buckets: { start: string; planned: number; completed: number; revenue_cents: number }[];
}

export interface PeriodRange {
  from: string | null; // ISO (UTC), null = alles
  to: string | null;
  bucket: 'day' | 'week' | 'month' | 'year';
  label: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Periode rond een ankerdatum (yyyy-MM-dd) in de bedrijfstijdzone. */
export function periodRange(period: Period, anchor: string, zone = getBusinessZone()): PeriodRange {
  const a = DateTime.fromISO(anchor, { zone }).setLocale('nl');
  if (period === 'alles') return { from: null, to: null, bucket: 'month', label: 'Alles' };
  const unit = period === 'week' ? 'week' : period === 'maand' ? 'month' : 'year';
  const start = a.startOf(unit);
  const end = start.plus({ [unit + 's']: 1 } as never);
  const label =
    period === 'week'
      ? `Week ${start.weekNumber} · ${start.toFormat('d LLL')} – ${end.minus({ days: 1 }).toFormat('d LLL yyyy')}`
      : period === 'maand'
        ? cap(start.toFormat('LLLL yyyy'))
        : start.toFormat('yyyy');
  return {
    from: start.toUTC().toISO(),
    to: end.toUTC().toISO(),
    bucket: period === 'jaar' ? 'month' : 'day',
    label,
  };
}

export function shiftAnchor(period: Period, anchor: string, delta: number, zone = getBusinessZone()): string {
  if (period === 'alles') return anchor;
  const unit = period === 'week' ? 'weeks' : period === 'maand' ? 'months' : 'years';
  return DateTime.fromISO(anchor, { zone }).plus({ [unit]: delta }).toISODate()!;
}

export function bucketLabel(start: string, bucket: PeriodRange['bucket'], period: Period): string {
  const d = DateTime.fromISO(start).setLocale('nl');
  if (bucket === 'day') return period === 'week' ? d.toFormat('ccc') : d.toFormat('d');
  if (bucket === 'month') return period === 'alles' ? d.toFormat('LLL yy') : d.toFormat('LLL');
  if (bucket === 'week') return `wk ${d.weekNumber}`;
  return d.toFormat('yyyy');
}

export function useStats(range: PeriodRange, team: 'alle' | 'geen' | string) {
  return useQuery({
    queryKey: ['appointments', 'stats', range.from, range.to, range.bucket, team],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('appointment_stats', {
        p_from: range.from,
        p_to: range.to,
        p_bucket: range.bucket,
        p_team_id: team !== 'alle' && team !== 'geen' ? team : null,
        p_unassigned: team === 'geen',
      });
      if (error) throw error;
      return data as Stats;
    },
  });
}

// ---------------------------------------------------------------------------
// Export naar CSV (opent in Excel / Numbers / Google Sheets)
// ---------------------------------------------------------------------------
const STATUS_NL: Record<string, string> = {
  ingepland: 'Ingepland',
  bezig: 'Bezig',
  afgerond: 'Afgerond',
  geannuleerd: 'Geannuleerd',
  niet_verschenen: 'Niet verschenen',
};

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function buildAppointmentsCsv(range: PeriodRange, teamNames: Map<string, string>): Promise<{ csv: string; count: number }> {
  const zone = getBusinessZone();
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 200; page++) {
    let q = supabase
      .from('appointments')
      .select('starts_at, ends_at, customer_name, customer_phone, vehicle, team_id, status, price_total_cents, price_complete, created_by_name, internal_notes, appointment_items(service_name, position)')
      .order('starts_at')
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (range.from) q = q.gte('starts_at', range.from);
    if (range.to) q = q.lt('starts_at', range.to);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  const header = ['Datum', 'Start', 'Eind', 'Klant', 'Telefoon', 'Auto', 'Kenteken', 'Behandelingen', 'Uitvoerende partij', 'Status', 'Prijs (EUR)', 'Ingevoerd door', 'Opmerkingen'];
  const lines = rows.map((r) => {
    const start = DateTime.fromISO(String(r.starts_at)).setZone(zone);
    const end = DateTime.fromISO(String(r.ends_at)).setZone(zone);
    const v = (r.vehicle ?? {}) as Record<string, unknown>;
    const items = ((r.appointment_items ?? []) as { service_name: string; position: number }[]).sort((x, y) => x.position - y.position);
    const price = r.price_complete && r.price_total_cents != null ? ((r.price_total_cents as number) / 100).toFixed(2).replace('.', ',') : 'nog te bepalen';
    return [
      start.toFormat('dd-MM-yyyy'),
      start.toFormat('HH:mm'),
      end.toFormat('HH:mm'),
      r.customer_name,
      r.customer_phone,
      [v.make, v.model, v.variant].filter(Boolean).join(' '),
      v.plate ? String(v.plate).toUpperCase() : '',
      items.map((i) => i.service_name).join(' + '),
      r.team_id ? teamNames.get(String(r.team_id)) ?? '' : 'Niet toegewezen',
      STATUS_NL[String(r.status)] ?? r.status,
      price,
      r.created_by_name,
      r.internal_notes,
    ]
      .map(csvCell)
      .join(';');
  });
  return { csv: '﻿' + [header.join(';'), ...lines].join('\r\n'), count: rows.length };
}

/** Alleen in de webversie: bestand downloaden. */
export function downloadTextFile(name: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
