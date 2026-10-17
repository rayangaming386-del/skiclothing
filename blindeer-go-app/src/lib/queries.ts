import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Catalog } from './pricing';
import { supabase } from './supabase';
import { dayRangeUtc, setBusinessZone } from './time';
import type {
  Appointment,
  AppointmentEvent,
  AppointmentPhoto,
  AppointmentStatus,
  Block,
  CompanySettings,
  Customer,
  DateOverride,
  OpeningHours,
  Profile,
  RecurringBreak,
  Team,
  Vehicle,
  Workstation,
} from './types';

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export const qk = {
  settings: ['settings'] as const,
  teams: ['teams'] as const,
  workstations: ['workstations'] as const,
  profiles: ['profiles'] as const,
  schedule: ['schedule'] as const,
  catalog: ['catalog'] as const,
  hints: ['hints'] as const,
  appointments: ['appointments'] as const,
  appointment: (id: string) => ['appointments', 'one', id] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', 'one', id] as const,
  blocks: ['blocks'] as const,
};

export function useSettings() {
  const q = useQuery({
    queryKey: qk.settings,
    queryFn: () => unwrap(supabase.from('company_settings').select('*').eq('id', 1).single()) as Promise<CompanySettings>,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (q.data?.timezone) setBusinessZone(q.data.timezone);
  }, [q.data?.timezone]);
  return q;
}

export function useTeams() {
  return useQuery({
    queryKey: qk.teams,
    queryFn: () => unwrap(supabase.from('teams').select('*').order('sort_order').order('name')) as Promise<Team[]>,
    staleTime: 5 * 60_000,
  });
}

export function useWorkstations() {
  return useQuery({
    queryKey: qk.workstations,
    queryFn: () => unwrap(supabase.from('workstations').select('*').order('sort_order').order('name')) as Promise<Workstation[]>,
    staleTime: 5 * 60_000,
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: qk.profiles,
    queryFn: () => unwrap(supabase.from('profiles').select('*').order('display_name')) as Promise<Profile[]>,
    staleTime: 60_000,
  });
}

export interface Schedule {
  hours: OpeningHours[];
  breaks: RecurringBreak[];
  overrides: DateOverride[];
}

export function useSchedule() {
  return useQuery({
    queryKey: qk.schedule,
    queryFn: async (): Promise<Schedule> => {
      const [hours, breaks, overrides] = await Promise.all([
        unwrap(supabase.from('opening_hours').select('*').order('weekday')),
        unwrap(supabase.from('recurring_breaks').select('*').eq('active', true).order('start_time')),
        unwrap(supabase.from('date_overrides').select('*').order('date')),
      ]);
      return { hours: hours as OpeningHours[], breaks: breaks as RecurringBreak[], overrides: overrides as DateOverride[] };
    },
    staleTime: 5 * 60_000,
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: qk.catalog,
    queryFn: async (): Promise<Catalog> => {
      const [services, prices, exceptions, bundles, discounts] = await Promise.all([
        unwrap(supabase.from('services').select('*').order('sort_order').order('name')),
        unwrap(supabase.from('service_prices').select('*').order('sort_order')),
        unwrap(supabase.from('model_exceptions').select('*').order('label')),
        unwrap(supabase.from('bundles').select('*').order('name')),
        unwrap(supabase.from('discount_rules').select('*').order('name')),
      ]);
      return { services, prices, exceptions, bundles, discounts } as Catalog;
    },
    staleTime: 5 * 60_000,
  });
}

export function useModelHints() {
  return useQuery({
    queryKey: qk.hints,
    queryFn: () => unwrap(supabase.from('vehicle_model_hints').select('make, model, high_entry')) as Promise<
      { make: string; model: string; high_entry: boolean }[]
    >,
    staleTime: 10 * 60_000,
  });
}

/** Afspraken die (deels) binnen [fromDate, toDate) vallen, in bedrijfsdagen. */
export function useAppointmentsRange(fromDate: string, toDateExclusive: string) {
  return useQuery({
    queryKey: [...qk.appointments, 'range', fromDate, toDateExclusive],
    queryFn: async () => {
      const from = dayRangeUtc(fromDate).from;
      const to = dayRangeUtc(toDateExclusive).from;
      return unwrap(
        supabase
          .from('appointments')
          .select('*, appointment_items(*)')
          .lt('starts_at', to)
          .gt('ends_at', from)
          .order('starts_at'),
      ) as Promise<Appointment[]>;
    },
  });
}

export function useBlocksRange(fromDate: string, toDateExclusive: string) {
  return useQuery({
    queryKey: [...qk.blocks, fromDate, toDateExclusive],
    queryFn: async () => {
      const from = dayRangeUtc(fromDate).from;
      const to = dayRangeUtc(toDateExclusive).from;
      return unwrap(supabase.from('blocks').select('*').lt('starts_at', to).gt('ends_at', from).order('starts_at')) as Promise<Block[]>;
    },
  });
}

export function useAppointment(id: string | undefined) {
  return useQuery({
    queryKey: qk.appointment(id ?? ''),
    enabled: !!id,
    queryFn: () =>
      unwrap(supabase.from('appointments').select('*, appointment_items(*)').eq('id', id!).single()) as Promise<Appointment>,
  });
}

export function useAppointmentEvents(id: string | undefined) {
  return useQuery({
    queryKey: [...qk.appointment(id ?? ''), 'events'],
    enabled: !!id,
    queryFn: () =>
      unwrap(supabase.from('appointment_events').select('*').eq('appointment_id', id!).order('created_at', { ascending: false })) as Promise<
        AppointmentEvent[]
      >,
  });
}

export function useAppointmentPhotos(id: string | undefined) {
  return useQuery({
    queryKey: [...qk.appointment(id ?? ''), 'photos'],
    enabled: !!id,
    queryFn: async () => {
      const rows = (await unwrap(
        supabase.from('appointment_photos').select('*').eq('appointment_id', id!).order('created_at'),
      )) as AppointmentPhoto[];
      if (!rows.length) return [];
      const { data } = await supabase.storage.from('appointment-photos').createSignedUrls(
        rows.map((r) => r.storage_path),
        60 * 30,
      );
      return rows.map((r, i) => ({ ...r, url: data?.[i]?.signedUrl ?? null }));
    },
  });
}

export function useCustomerSearch(term: string) {
  const t = term.trim();
  return useQuery({
    queryKey: [...qk.customers, 'search', t],
    queryFn: async () => {
      let q = supabase.from('customers').select('*, vehicles(*)').is('archived_at', null).order('name').limit(50);
      if (t) {
        const digits = t.replace(/\D/g, '');
        const plate = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const safe = t.replace(/[%,()]/g, ' ');
        const ors = [`name.ilike.%${safe}%`];
        if (digits.length >= 3) ors.push(`phone_digits.ilike.%${digits}%`);
        if (plate.length >= 2) {
          const { data: v } = await supabase.from('vehicles').select('customer_id').ilike('plate_norm', `%${plate}%`).limit(50);
          const ids = [...new Set((v ?? []).map((x) => x.customer_id))];
          if (ids.length) ors.push(`id.in.(${ids.join(',')})`);
        }
        q = q.or(ors.join(','));
      }
      return unwrap(q) as Promise<(Customer & { vehicles: Vehicle[] })[]>;
    },
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: qk.customer(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const [customer, appointments] = await Promise.all([
        unwrap(supabase.from('customers').select('*, vehicles(*)').eq('id', id!).single()),
        unwrap(supabase.from('appointments').select('*, appointment_items(*)').eq('customer_id', id!).order('starts_at', { ascending: false })),
      ]);
      return { customer: customer as unknown as Customer & { vehicles: Vehicle[] }, appointments: appointments as unknown as Appointment[] };
    },
  });
}

// ---------------------------------------------------------------------------
// Mutaties
// ---------------------------------------------------------------------------

export function useSaveAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc('save_appointment', { p: payload });
      if (error) throw error;
      return data as { appointment: Appointment; duplicate: boolean; warnings: { message: string }[] };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.appointments });
      qc.invalidateQueries({ queryKey: qk.customers });
    },
  });
}

export function useSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; status: AppointmentStatus; version: number; reason?: string | null }) => {
      const { data, error } = await supabase.rpc('set_appointment_status', {
        p_id: v.id,
        p_status: v.status,
        p_expected_version: v.version,
        p_reason: v.reason ?? null,
      });
      if (error) throw error;
      return data as Appointment;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.appointments });
      qc.invalidateQueries({ queryKey: qk.customers });
    },
  });
}

export async function fetchAvailableStarts(args: {
  date: string;
  duration: number;
  buffer?: number | null;
  teamId?: string | null;
  assigneeId?: string | null;
  workstationId?: string | null;
  excludeId?: string | null;
}): Promise<string[]> {
  const { data, error } = await supabase.rpc('available_starts', {
    p_date: args.date,
    p_duration_min: args.duration,
    p_buffer_min: args.buffer ?? null,
    p_team_id: args.teamId ?? null,
    p_assignee_id: args.assigneeId ?? null,
    p_workstation_id: args.workstationId ?? null,
    p_exclude_id: args.excludeId ?? null,
  });
  if (error) throw error;
  return (data as string[]) ?? [];
}

export async function fetchBookingProblems(args: {
  startsAt: string;
  duration: number;
  buffer?: number | null;
  teamId?: string | null;
  assigneeId?: string | null;
  workstationId?: string | null;
  excludeId?: string | null;
}) {
  const { data, error } = await supabase.rpc('booking_problems', {
    p_starts_at: args.startsAt,
    p_duration_min: args.duration,
    p_buffer_min: args.buffer ?? null,
    p_team_id: args.teamId ?? null,
    p_assignee_id: args.assigneeId ?? null,
    p_workstation_id: args.workstationId ?? null,
    p_exclude_id: args.excludeId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as { code: string; message: string; overridable: boolean }[];
}
