import type { BodyType } from './pricing';

export type Role = 'owner' | 'colleague';
export type AppointmentStatus = 'ingepland' | 'bezig' | 'afgerond' | 'geannuleerd' | 'niet_verschenen';

export const STATUSES: { value: AppointmentStatus; label: string; icon: string }[] = [
  { value: 'ingepland', label: 'Ingepland', icon: '○' },
  { value: 'bezig', label: 'Bezig', icon: '◐' },
  { value: 'afgerond', label: 'Afgerond', icon: '✓' },
  { value: 'geannuleerd', label: 'Geannuleerd', icon: '✕' },
  { value: 'niet_verschenen', label: 'Niet verschenen', icon: '!' },
];
export const statusLabel = (s: AppointmentStatus) => STATUSES.find((x) => x.value === s)?.label ?? s;

export interface CompanySettings {
  id: number;
  company_name: string;
  former_name: string | null;
  activity: string | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  directions: string | null;
  phone: string | null;
  email: string | null;
  legal_name: string | null;
  kvk_number: string | null;
  vat_number: string | null;
  prices_include_vat: boolean | null;
  timezone: string;
  currency: string;
  slot_interval_min: number;
  default_buffer_min: number;
  buffer_must_fit_before_close: boolean;
  breaks_block_appointments: boolean;
  max_parallel_appointments: number;
  film_percentages: number[];
  accent_color: string;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sort_order: number;
  max_parallel: number | null;
}

export interface Workstation {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  notes: string | null;
}

export interface NotificationPrefs {
  assigned: boolean;
  moved: boolean;
  cancelled: boolean;
  reminder_minutes: number | null;
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string;
  phone: string | null;
  avatar_path: string | null;
  role: Role;
  team_id: string | null;
  active: boolean;
  notification_prefs: NotificationPrefs;
}

export interface OpeningHours {
  weekday: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

export interface RecurringBreak {
  id: string;
  weekday: number | null;
  start_time: string;
  end_time: string;
  label: string;
  active: boolean;
}

export interface DateOverride {
  date: string;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
  ignore_breaks: boolean;
  note: string | null;
}

export interface Block {
  id: string;
  kind: 'blokkade' | 'afwezigheid';
  starts_at: string;
  ends_at: string;
  reason: string;
  team_id: string | null;
  workstation_id: string | null;
  profile_id: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Vehicle {
  id: string;
  customer_id: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  build_year: number | null;
  body_type: BodyType | null;
  door_count: number | null;
  rear_window_count: number | null;
  front_window_count: number | null;
  high_entry: boolean | null;
  notes: string | null;
  archived_at: string | null;
}

export type VehicleSnapshot = Partial<Omit<Vehicle, 'id' | 'customer_id' | 'archived_at' | 'notes'>>;

export interface Appointment {
  id: string;
  client_request_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  vehicle: VehicleSnapshot;
  starts_at: string;
  ends_at: string;
  duration_min: number;
  buffer_min: number;
  team_id: string | null;
  assignee_id: string | null;
  workstation_id: string | null;
  status: AppointmentStatus;
  status_reason: string | null;
  price_total_cents: number | null;
  price_complete: boolean;
  discount_total_cents: number;
  deviates_from_standard: boolean;
  internal_notes: string | null;
  rules_overridden: boolean;
  override_reason: string | null;
  created_by: string;
  created_by_name: string;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  appointment_items?: AppointmentItem[];
}

export interface AppointmentItem {
  id: string;
  appointment_id: string;
  position: number;
  service_id: string | null;
  service_name: string;
  price_rule_label: string | null;
  model_exception_id: string | null;
  model_exception_label: string | null;
  bundle_id: string | null;
  bundle_label: string | null;
  film_brand: string | null;
  film_kind: string | null;
  film_percentage: number | null;
  film_color: string | null;
  measured_vlt: number | null;
  standard_price_cents: number | null;
  price_cents: number | null;
  standard_duration_min: number | null;
  duration_min: number | null;
  discount_cents: number;
  discount_label: string | null;
  discount_rule_id: string | null;
  price_overridden: boolean;
  duration_overridden: boolean;
  note: string | null;
}

export interface AppointmentEvent {
  id: number;
  appointment_id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AppointmentPhoto {
  id: string;
  appointment_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}
