import { DateTime } from 'luxon';
import React, { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatEuro } from '../lib/pricing';
import { formatTime, getBusinessZone } from '../lib/time';
import { Appointment, AppointmentStatus, statusLabel, STATUSES, Team } from '../lib/types';
import { colors, font, onColor, radius, space, statusColors, withAlpha } from '../theme';

export const UNASSIGNED_COLOR = '#64748B';

/** Kleur én naam, zodat het onderscheid ook zonder kleurherkenning duidelijk is. */
export function TeamBadge({ team, small }: { team: Team | null | undefined; small?: boolean }) {
  const color = team?.color ?? UNASSIGNED_COLOR;
  return (
    <View style={[s.badge, { backgroundColor: withAlpha(color, 0.18), borderColor: color }]}>
      <View style={[s.swatch, { backgroundColor: color }]} />
      <Text style={[s.badgeText, small && { fontSize: 12 }]} numberOfLines={1}>
        {team?.name ?? 'Niet toegewezen'}
      </Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const c = statusColors[status] ?? colors.textDim;
  const icon = STATUSES.find((x) => x.value === status)?.icon ?? '';
  return (
    <View style={[s.badge, { borderColor: c, backgroundColor: withAlpha(c, 0.15) }]}>
      <Text style={[s.badgeText, { color: c }]}>
        {icon} {statusLabel(status)}
      </Text>
    </View>
  );
}

export function vehicleLabel(v: Appointment['vehicle'] | null | undefined) {
  if (!v) return 'Auto onbekend';
  const name = [v.make, v.model, v.variant].filter(Boolean).join(' ');
  const parts = [name || 'Auto', v.build_year ? `(${v.build_year})` : null, v.plate ? `· ${v.plate.toUpperCase()}` : null];
  return parts.filter(Boolean).join(' ');
}

export function treatmentsLabel(a: Appointment) {
  const items = [...(a.appointment_items ?? [])].sort((x, y) => x.position - y.position);
  if (!items.length) return 'Geen behandeling gekozen';
  return items
    .map((i) => [i.service_name, i.film_percentage != null ? `${i.film_percentage}%` : null, i.film_color].filter(Boolean).join(' '))
    .join(' + ');
}

export function AppointmentCard({
  a,
  team,
  onPress,
  compact,
}: {
  a: Appointment;
  team: Team | null | undefined;
  onPress?: () => void;
  compact?: boolean;
}) {
  const color = team?.color ?? UNASSIGNED_COLOR;
  const inactive = a.status === 'geannuleerd' || a.status === 'niet_verschenen';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${formatTime(a.starts_at)} tot ${formatTime(a.ends_at)}, ${a.customer_name}, ${vehicleLabel(a.vehicle)}, ${team?.name ?? 'niet toegewezen'}, ${statusLabel(a.status)}`}
      style={({ pressed }) => [s.card, { borderLeftColor: color }, inactive && { opacity: 0.55 }, pressed && { opacity: 0.7 }]}
    >
      <View style={s.cardTop}>
        <Text style={[s.time, inactive && s.strike]}>
          {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
        </Text>
        <StatusBadge status={a.status} />
      </View>
      <Text style={s.title} numberOfLines={1}>
        {vehicleLabel(a.vehicle)}
      </Text>
      <Text style={s.sub} numberOfLines={compact ? 1 : 2}>
        {treatmentsLabel(a)}
      </Text>
      <View style={s.cardBottom}>
        <Text style={s.sub} numberOfLines={1}>
          👤 {a.customer_name}
        </Text>
        <TeamBadge team={team} small />
      </View>
      {!compact ? (
        <Text style={[s.sub, { marginTop: 4 }]}>
          {formatDuration(a.duration_min)} · {a.price_complete ? formatEuro(a.price_total_cents) : 'prijs nog te bepalen'}
          {a.deviates_from_standard ? ' · afwijkend' : ''}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Bellen / WhatsApp (bericht alleen als concept, nooit automatisch verzonden)
// ---------------------------------------------------------------------------
export function toInternationalNL(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '31' + d.slice(1);
  return d.length >= 8 ? d : null;
}

export function callPhone(phone: string | null | undefined) {
  if (!phone) return;
  Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
}

export function openWhatsApp(phone: string | null | undefined, draft?: string) {
  const intl = toInternationalNL(phone);
  if (!intl) return;
  const url = `https://wa.me/${intl}${draft ? `?text=${encodeURIComponent(draft)}` : ''}`;
  Linking.openURL(url);
}

// ---------------------------------------------------------------------------
// Maandoverzicht om snel naar een datum te gaan
// ---------------------------------------------------------------------------
export function MonthGrid({
  month,
  selected,
  onSelect,
  onChangeMonth,
  counts,
  accent,
}: {
  month: string; // yyyy-MM-01
  selected: string;
  onSelect: (date: string) => void;
  onChangeMonth: (month: string) => void;
  counts?: Record<string, number>;
  accent: string;
}) {
  const zone = getBusinessZone();
  const start = DateTime.fromISO(month, { zone }).startOf('month');
  const today = DateTime.now().setZone(zone).toISODate();
  const days = useMemo(() => {
    const first = start.startOf('week');
    return Array.from({ length: 42 }, (_, i) => first.plus({ days: i }));
  }, [start]);
  return (
    <View>
      <View style={s.monthHeader}>
        <Pressable onPress={() => onChangeMonth(start.minus({ months: 1 }).toISODate()!)} hitSlop={12} accessibilityLabel="Vorige maand">
          <Text style={s.navArrow}>‹</Text>
        </Pressable>
        <Text style={s.monthTitle}>{start.setLocale('nl').toFormat('LLLL yyyy')}</Text>
        <Pressable onPress={() => onChangeMonth(start.plus({ months: 1 }).toISODate()!)} hitSlop={12} accessibilityLabel="Volgende maand">
          <Text style={s.navArrow}>›</Text>
        </Pressable>
      </View>
      <View style={s.weekRow}>
        {['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => (
          <Text key={d} style={s.weekday}>
            {d}
          </Text>
        ))}
      </View>
      <View style={s.grid}>
        {days.map((d) => {
          const iso = d.toISODate()!;
          const inMonth = d.month === start.month;
          const isSel = iso === selected;
          const n = counts?.[iso] ?? 0;
          return (
            <Pressable
              key={iso}
              onPress={() => onSelect(iso)}
              accessibilityLabel={`${d.setLocale('nl').toFormat('d LLLL')}${n ? `, ${n} afspraken` : ''}`}
              style={[s.dayCell, isSel && { backgroundColor: accent }]}
            >
              <Text
                style={[
                  s.dayNum,
                  !inMonth && { color: colors.textFaint },
                  iso === today && !isSel && { color: accent, fontWeight: '800' },
                  isSel && { color: onColor(accent), fontWeight: '800' },
                ]}
              >
                {d.day}
              </Text>
              {n ? <Text style={[s.dayCount, isSel && { color: onColor(accent) }]}>{n}</Text> : <Text style={s.dayCount}> </Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function OfflineBanner({ online, realtime }: { online: boolean; realtime: string }) {
  if (online && realtime !== 'onderbroken') return null;
  return (
    <View style={s.offline} accessibilityLiveRegion="polite">
      <Text style={s.offlineText}>
        {online
          ? '⚠ Live-verbinding onderbroken. Gegevens worden opnieuw opgehaald zodra die terug is.'
          : '⚠ Geen internetverbinding. Wijzigingen kunnen nu niet worden opgeslagen.'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 180 },
  swatch: { width: 9, height: 9, borderRadius: 2, marginRight: 6 },
  badgeText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 6,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: space.sm },
  time: { color: colors.text, fontSize: font.large, fontWeight: '800' },
  strike: { textDecorationLine: 'line-through' },
  title: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  sub: { color: colors.textDim, fontSize: 14, flexShrink: 1 },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  monthTitle: { color: colors.text, fontSize: font.large, fontWeight: '700', textTransform: 'capitalize' },
  navArrow: { color: colors.text, fontSize: 30, paddingHorizontal: space.md },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: colors.textFaint, fontSize: 12, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 6, borderRadius: radius.sm },
  dayNum: { color: colors.text, fontSize: font.body },
  dayCount: { color: colors.textDim, fontSize: 11 },
  offline: { backgroundColor: colors.warning, paddingHorizontal: space.lg, paddingVertical: space.sm, },
  offlineText: { color: '#111', fontWeight: '700', fontSize: 14 },
});
