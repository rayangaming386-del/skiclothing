-- Blindeer & Go planning: basisschema
-- Alle tijden worden opgeslagen als timestamptz (UTC) en getoond in de bedrijfstijdzone
-- (company_settings.timezone, standaard Europe/Amsterdam).
-- Bedragen in eurocenten (integer). NULL = "nog te bepalen", nooit automatisch 0.

create extension if not exists pgcrypto;

create type public.user_role as enum ('owner', 'colleague');
create type public.appointment_status as enum ('ingepland', 'bezig', 'afgerond', 'geannuleerd', 'niet_verschenen');
create type public.body_type as enum ('hatchback', 'station', 'sedan', 'coupe', 'suv', 'bus');

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Bedrijfsinstellingen (één rij)
-- ---------------------------------------------------------------------------
create table public.company_settings (
  id smallint primary key default 1 check (id = 1),
  company_name text not null,
  former_name text,
  activity text,
  address_line text,
  postal_code text,
  city text,
  directions text,
  phone text,
  email text,
  -- Niet vastgesteld in de briefing: bewust leeg gelaten.
  legal_name text,
  kvk_number text,
  vat_number text,
  prices_include_vat boolean,
  timezone text not null default 'Europe/Amsterdam',
  currency text not null default 'EUR',
  locale text not null default 'nl-NL',
  slot_interval_min integer not null default 15 check (slot_interval_min between 5 and 120),
  default_buffer_min integer not null default 15 check (default_buffer_min between 0 and 240),
  -- Open punt: moet de buffer ná de laatste afspraak nog binnen de openingstijd vallen?
  buffer_must_fit_before_close boolean not null default false,
  -- Afspraken mogen niet over een pauze heen lopen.
  breaks_block_appointments boolean not null default true,
  -- Open punt: aantal auto's tegelijk. Standaard voorzichtig 1; aanpasbaar door eigenaar.
  max_parallel_appointments integer not null default 1 check (max_parallel_appointments between 1 and 50),
  film_percentages integer[] not null default '{3,5,15,20,35,50,60,70}',
  accent_color text not null default '#3B82F6' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create or replace function public.validate_timezone() returns trigger
language plpgsql as $$
begin
  perform now() at time zone new.timezone; -- faalt bij een onbekende tijdzone
  return new;
end $$;

create trigger company_settings_tz before insert or update on public.company_settings
  for each row execute function public.validate_timezone();
create trigger company_settings_touch before update on public.company_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Uitvoerende partijen, werkplekken, profielen
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  sort_order integer not null default 0,
  -- Optioneel: maximaal aantal gelijktijdige afspraken voor deze partij (NULL = alleen bedrijfslimiet)
  max_parallel integer check (max_parallel is null or max_parallel >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger teams_touch before update on public.teams for each row execute function public.touch_updated_at();

create table public.workstations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workstations_touch before update on public.workstations for each row execute function public.touch_updated_at();

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  email text,
  display_name text not null check (length(trim(display_name)) > 0),
  phone text,
  avatar_path text,
  role public.user_role not null default 'colleague',
  team_id uuid references public.teams (id) on delete set null,
  active boolean not null default true,
  notification_prefs jsonb not null default
    '{"assigned": true, "moved": true, "cancelled": true, "reminder_minutes": null}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Openingstijden, pauzes, afwijkende dagen, blokkades
-- ---------------------------------------------------------------------------
create table public.opening_hours (
  weekday smallint primary key check (weekday between 1 and 7), -- ISO: 1 = maandag, 7 = zondag
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  check (is_closed or (open_time is not null and close_time is not null and open_time < close_time))
);

create table public.recurring_breaks (
  id uuid primary key default gen_random_uuid(),
  weekday smallint check (weekday between 1 and 7), -- NULL = iedere dag
  start_time time not null,
  end_time time not null,
  label text not null default 'Pauze',
  active boolean not null default true,
  check (start_time < end_time)
);

create table public.date_overrides (
  date date primary key,
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  ignore_breaks boolean not null default false,
  note text,
  check (is_closed or (open_time is not null and close_time is not null and open_time < close_time))
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'blokkade' check (kind in ('blokkade', 'afwezigheid')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (length(trim(reason)) > 0),
  -- Geen van deze ingevuld = blokkade voor het hele bedrijf.
  team_id uuid references public.teams (id) on delete cascade,
  workstation_id uuid references public.workstations (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index blocks_range_idx on public.blocks (starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- Klanten en voertuigen
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text,
  phone_digits text generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored,
  email text,
  notes text,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
create index customers_name_idx on public.customers (lower(name));
create index customers_phone_idx on public.customers (phone_digits);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  plate text,
  plate_norm text generated always as (upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g'))) stored,
  make text,
  model text,
  variant text,
  build_year integer check (build_year is null or build_year between 1900 and 2100),
  body_type public.body_type,
  door_count smallint check (door_count is null or door_count between 1 and 8),
  rear_window_count smallint check (rear_window_count is null or rear_window_count between 0 and 20),
  front_window_count smallint check (front_window_count is null or front_window_count between 0 and 10),
  high_entry boolean, -- NULL = onbekend
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger vehicles_touch before update on public.vehicles for each row execute function public.touch_updated_at();
create index vehicles_customer_idx on public.vehicles (customer_id);
create index vehicles_plate_idx on public.vehicles (plate_norm);

-- ---------------------------------------------------------------------------
-- Catalogus: diensten, prijsregels, modeluitzonderingen, pakketten, kortingen
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  is_windshield boolean not null default false, -- prijs hangt af van gewone/hoge instap
  price_on_sight boolean not null default false, -- bv. panoramadak: prijs op zicht
  film_kind text,                 -- vrije omschrijving, bv. 'kameleon', 'keramisch'
  film_brands text[],             -- NULL = vrij
  film_percentages integer[],     -- NULL = vrije keuze uit bedrijfslijst; '{}' = geen percentage
  film_colors text[],             -- NULL/'{}' = geen kleurkeuze
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger services_touch before update on public.services for each row execute function public.touch_updated_at();

-- Prijs-/duurregel. Ingevulde criteria moeten overeenkomen met het voertuig;
-- de meest specifieke passende regel wint.
create table public.service_prices (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services (id) on delete cascade,
  label text not null,
  body_type public.body_type,
  passenger_car_only boolean not null default false, -- alles behalve bus
  high_entry boolean,
  door_count smallint,
  rear_window_count smallint,
  front_window_count smallint,
  price_cents integer check (price_cents is null or price_cents >= 0),
  duration_min integer check (duration_min is null or duration_min > 0),
  active boolean not null default true,
  sort_order integer not null default 0
);
create index service_prices_service_idx on public.service_prices (service_id);

create table public.model_exceptions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  service_id uuid not null references public.services (id) on delete cascade,
  make text,                     -- vergelijking zonder hoofdletters
  match_terms text[] not null default '{}', -- één van deze termen moet voorkomen in "model uitvoering"
  body_type public.body_type,
  year_from integer,
  year_to integer,
  price_cents integer check (price_cents is null or price_cents >= 0), -- vervangt de basisprijs
  duration_min integer check (duration_min is null or duration_min > 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table public.bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_ids uuid[] not null check (cardinality(service_ids) >= 2),
  make text,
  match_terms text[] not null default '{}',
  body_type public.body_type,
  price_cents integer check (price_cents is null or price_cents >= 0),  -- NULL = som van onderdelen
  duration_min integer check (duration_min is null or duration_min > 0), -- NULL = som van onderdelen
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table public.discount_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_service_id uuid not null references public.services (id) on delete cascade,
  required_any_service_ids uuid[] not null default '{}',
  body_types public.body_type[], -- NULL = alle
  amount_cents integer not null check (amount_cents > 0),
  active boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table public.vehicle_model_hints (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  high_entry boolean not null,
  notes text,
  unique (make, model)
);

-- ---------------------------------------------------------------------------
-- Afspraken (alleen via functies te schrijven)
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique, -- voorkomt dubbele afspraken bij herhaald tikken
  customer_id uuid references public.customers (id) on delete restrict,
  vehicle_id uuid references public.vehicles (id) on delete restrict,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  vehicle jsonb not null default '{}'::jsonb, -- momentopname
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_min integer not null check (duration_min between 1 and 1440),
  buffer_min integer not null default 0 check (buffer_min between 0 and 240),
  team_id uuid references public.teams (id) on delete restrict,
  assignee_id uuid references public.profiles (id) on delete restrict,
  workstation_id uuid references public.workstations (id) on delete restrict,
  status public.appointment_status not null default 'ingepland',
  status_reason text,
  price_total_cents integer,
  price_complete boolean not null default false,
  discount_total_cents integer not null default 0,
  deviates_from_standard boolean not null default false,
  internal_notes text,
  rules_overridden boolean not null default false,
  override_reason text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_by_name text not null,
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (ends_at > starts_at)
);
create index appointments_range_idx on public.appointments (starts_at, ends_at);
create index appointments_customer_idx on public.appointments (customer_id);

create table public.appointment_items (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  position integer not null default 0,
  service_id uuid references public.services (id) on delete set null,
  service_name text not null,
  price_rule_label text,
  model_exception_id uuid references public.model_exceptions (id) on delete set null,
  model_exception_label text,
  bundle_id uuid references public.bundles (id) on delete set null,
  bundle_label text,
  film_brand text,
  film_kind text,
  film_percentage integer,
  film_color text,
  measured_vlt numeric(5, 2) check (measured_vlt is null or measured_vlt between 0 and 100), -- gemeten lichtdoorlaat glas + folie
  standard_price_cents integer,
  price_cents integer check (price_cents is null or price_cents >= 0),
  standard_duration_min integer,
  duration_min integer check (duration_min is null or duration_min >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  discount_label text,
  discount_rule_id uuid references public.discount_rules (id) on delete set null,
  price_overridden boolean not null default false,
  duration_overridden boolean not null default false,
  note text
);
create index appointment_items_appt_idx on public.appointment_items (appointment_id);

create table public.appointment_events (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index appointment_events_appt_idx on public.appointment_events (appointment_id, created_at);

create table public.appointment_photos (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  storage_path text not null unique,
  caption text,
  uploaded_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
