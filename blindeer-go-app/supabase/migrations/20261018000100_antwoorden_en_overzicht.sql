-- Verwerking van de antwoorden van 18-10-2026 + inloggen met gebruikersnaam + overzicht/statistieken.

-- ---------------------------------------------------------------------------
-- 1. Pauzes alleen maandag t/m zaterdag (zondag geen pauzes)
-- ---------------------------------------------------------------------------
delete from public.recurring_breaks where weekday is null and start_time in ('12:00', '16:00');
insert into public.recurring_breaks (weekday, start_time, end_time, label)
select d, t.s, t.e, 'Pauze'
from generate_series(1, 6) d
cross join (values ('12:00'::time, '13:00'::time), ('16:00'::time, '17:00'::time)) t(s, e);

-- ---------------------------------------------------------------------------
-- 2. Eén werkplek: Binckhorst. Capaciteit blijft 1 auto tegelijk.
-- ---------------------------------------------------------------------------
insert into public.workstations (name, sort_order) values ('Binckhorst', 1) on conflict (name) do nothing;
update public.company_settings set max_parallel_appointments = 1, buffer_must_fit_before_close = false where id = 1;

-- ---------------------------------------------------------------------------
-- 3. Combinatiekorting: €10 op voorportieren bij elke combinatie met een andere behandeling
-- ---------------------------------------------------------------------------
alter table public.discount_rules add column requires_any_other boolean not null default false;
update public.discount_rules
   set active = true,
       requires_any_other = true,
       required_any_service_ids = '{}',
       body_types = null,
       notes = 'Bij elke combinatie: voorportieren plus minimaal één andere behandeling.'
 where name = 'Combinatiekorting voorportieren';

-- ---------------------------------------------------------------------------
-- 4. Complete auto = B-stijl + voorportieren + voorruit (alle ramen), als pakketprijs
-- ---------------------------------------------------------------------------
alter table public.bundles add column rear_window_count smallint
  check (rear_window_count is null or rear_window_count between 0 and 20);

update public.services
   set active = false,
       notes = 'Vervangen door de pakketten "Compleet …" (B-stijl + voorportieren + voorruit).'
 where code = 'complete_auto';

insert into public.bundles (name, service_ids, body_type, rear_window_count, price_cents, duration_min, active, notes)
select v.name,
       array[(select id from public.services where code = 'bstijl'),
             (select id from public.services where code = 'voorportieren'),
             (select id from public.services where code = v.ruit)],
       v.body::public.body_type, v.rear, v.price, 150, true,
       'Complete auto: B-stijl, voorportieren en voorruit.'
from (values
  ('Compleet hatchback met kameleon voorruit', 'kameleon_voorruit', 'hatchback', null::smallint, 29000),
  ('Compleet hatchback met zwarte voorruit', 'keramisch_voorruit', 'hatchback', null::smallint, 28000),
  ('Compleet sedan met kameleon voorruit', 'kameleon_voorruit', 'sedan', null::smallint, 32000),
  ('Compleet sedan met zwarte voorruit', 'keramisch_voorruit', 'sedan', null::smallint, 30000),
  ('Compleet station (7 ramen) met kameleon voorruit', 'kameleon_voorruit', 'station', 7::smallint, 33000),
  ('Compleet station (7 ramen) met zwarte voorruit', 'keramisch_voorruit', 'station', 7::smallint, 33000),
  ('Compleet station (5 ramen) met kameleon voorruit', 'kameleon_voorruit', 'station', 5::smallint, 30000),
  ('Compleet station (5 ramen) met zwarte voorruit', 'keramisch_voorruit', 'station', 5::smallint, 30000)
) as v(name, ruit, body, rear, price);

-- ---------------------------------------------------------------------------
-- 5. Gebruikersnaam (inloggen met gebruikersnaam of e-mailadres)
-- ---------------------------------------------------------------------------
alter table public.profiles add column username text
  check (username is null or username ~ '^[A-Za-z0-9._-]{3,32}$');
create unique index profiles_username_lower_key on public.profiles (lower(username));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role := 'colleague';
  v_team uuid;
  v_username text;
begin
  if new.raw_app_meta_data ? 'role' and new.raw_app_meta_data ->> 'role' in ('owner', 'colleague') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  end if;
  begin
    v_team := nullif(new.raw_app_meta_data ->> 'team_id', '')::uuid;
  exception when others then
    v_team := null;
  end;
  if v_team is not null and not exists (select 1 from public.teams t where t.id = v_team) then
    v_team := null;
  end if;
  v_username := nullif(trim(new.raw_app_meta_data ->> 'username'), '');
  if v_username is not null and (v_username !~ '^[A-Za-z0-9._-]{3,32}$'
      or exists (select 1 from public.profiles p where lower(p.username) = lower(v_username))) then
    v_username := null;
  end if;

  insert into public.profiles (id, email, display_name, role, team_id, username)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'gebruiker'), '@', 1)),
    v_role,
    v_team,
    v_username
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Gebruikersnaam → e-mailadres voor het inlogscherm. Geeft alleen iets terug voor actieve accounts.
create or replace function public.login_email_for(p_login text) returns text
language sql stable security definer set search_path = '' as $$
  select p.email from public.profiles p
  where p.active and p.username is not null and lower(p.username) = lower(trim(p_login))
  limit 1;
$$;
revoke all on function public.login_email_for(text) from public;
grant execute on function public.login_email_for(text) to anon, authenticated;

drop function public.admin_update_member(uuid, public.user_role, uuid, boolean, boolean, text);
create function public.admin_update_member(
  p_user_id uuid,
  p_role public.user_role default null,
  p_team_id uuid default null,
  p_clear_team boolean default false,
  p_active boolean default null,
  p_display_name text default null,
  p_username text default null
) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.profiles;
  v_owner_count integer;
begin
  if not public.is_owner() then
    raise exception 'Alleen de eigenaar mag teamleden beheren' using errcode = '42501';
  end if;

  select * into v_row from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Teamlid niet gevonden';
  end if;

  if (p_role is not null and p_role <> 'owner') or p_active = false then
    if v_row.role = 'owner' and v_row.active then
      select count(*) into v_owner_count from public.profiles where role = 'owner' and active and id <> p_user_id;
      if v_owner_count = 0 then
        raise exception 'Er moet minimaal één actieve eigenaar blijven';
      end if;
    end if;
  end if;

  if nullif(trim(p_username), '') is not null then
    if trim(p_username) !~ '^[A-Za-z0-9._-]{3,32}$' then
      raise exception 'Gebruikersnaam: 3–32 tekens, alleen letters, cijfers, punt, streepje of underscore';
    end if;
    if exists (select 1 from public.profiles where lower(username) = lower(trim(p_username)) and id <> p_user_id) then
      raise exception 'Deze gebruikersnaam is al in gebruik';
    end if;
  end if;

  update public.profiles set
    role = coalesce(p_role, role),
    team_id = case when p_clear_team then null else coalesce(p_team_id, team_id) end,
    active = coalesce(p_active, active),
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
    username = coalesce(nullif(trim(p_username), ''), username)
  where id = p_user_id
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.admin_update_member(uuid, public.user_role, uuid, boolean, boolean, text, text) from public, anon;
grant execute on function public.admin_update_member(uuid, public.user_role, uuid, boolean, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Overzicht: aantallen en bedragen per periode (week, maand, jaar, alles)
-- ---------------------------------------------------------------------------
create or replace function public.appointment_stats(
  p_from timestamptz default null,     -- NULL = vanaf de eerste afspraak
  p_to timestamptz default null,       -- exclusief; NULL = tot en met de laatste afspraak
  p_bucket text default 'day',         -- day | week | month | year
  p_team_id uuid default null,
  p_unassigned boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := public.company_tz();
  v_from_local timestamp;
  v_to_local timestamp;
  v_step interval;
  v_result jsonb;
begin
  if not public.is_active_member() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if p_bucket not in ('day', 'week', 'month', 'year') then
    raise exception 'Onbekende indeling';
  end if;
  v_step := case p_bucket when 'day' then interval '1 day' when 'week' then interval '1 week'
                          when 'month' then interval '1 month' else interval '1 year' end;

  with sel as (
    select a.id, a.starts_at, a.status, a.team_id, a.price_total_cents, a.price_complete
    from public.appointments a
    where (p_from is null or a.starts_at >= p_from)
      and (p_to is null or a.starts_at < p_to)
      and (p_team_id is null or a.team_id = p_team_id)
      and (not p_unassigned or a.team_id is null)
  ),
  bounds as (
    select
      date_trunc(p_bucket, coalesce(p_from at time zone v_tz, min(r.starts_at at time zone v_tz), now() at time zone v_tz)) as b_from,
      date_trunc(p_bucket, coalesce((p_to - interval '1 microsecond') at time zone v_tz, max(r.starts_at at time zone v_tz), now() at time zone v_tz)) as b_to
    from sel r
  ),
  series as (
    select generate_series(b.b_from, b.b_to, v_step) as bucket from bounds b
  ),
  per_bucket as (
    select s.bucket,
           count(r.id) filter (where r.status in ('ingepland', 'bezig', 'afgerond')) as planned,
           count(r.id) filter (where r.status = 'afgerond') as completed,
           coalesce(sum(r.price_total_cents) filter (where r.status in ('ingepland', 'bezig', 'afgerond') and r.price_complete), 0) as revenue_cents
    from series s
    left join sel r on date_trunc(p_bucket, r.starts_at at time zone v_tz) = s.bucket
    group by s.bucket
  )
  select jsonb_build_object(
    'planned', (select count(*) from sel where status in ('ingepland', 'bezig', 'afgerond')),
    'upcoming', (select count(*) from sel where status in ('ingepland', 'bezig') and starts_at >= now()),
    'completed', (select count(*) from sel where status = 'afgerond'),
    'cancelled', (select count(*) from sel where status = 'geannuleerd'),
    'no_show', (select count(*) from sel where status = 'niet_verschenen'),
    'revenue_planned_cents', (select coalesce(sum(price_total_cents), 0) from sel where status in ('ingepland', 'bezig', 'afgerond') and price_complete),
    'revenue_completed_cents', (select coalesce(sum(price_total_cents), 0) from sel where status = 'afgerond' and price_complete),
    'price_unknown', (select count(*) from sel where status in ('ingepland', 'bezig', 'afgerond') and not price_complete),
    'first_start', (select min(starts_at) from sel),
    'by_team', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', x.team_id, 'name', coalesce(t.name, 'Niet toegewezen'), 'color', t.color,
                                          'count', x.cnt, 'revenue_cents', x.rev) order by x.cnt desc, t.name)
      from (select team_id, count(*) cnt, coalesce(sum(price_total_cents) filter (where price_complete), 0) rev
            from sel where status in ('ingepland', 'bezig', 'afgerond') group by team_id) x
      left join public.teams t on t.id = x.team_id), '[]'::jsonb),
    'by_service', coalesce((
      select jsonb_agg(jsonb_build_object('name', y.service_name, 'count', y.cnt) order by y.cnt desc, y.service_name)
      from (select i.service_name, count(*) cnt
            from public.appointment_items i join sel r on r.id = i.appointment_id
            where r.status in ('ingepland', 'bezig', 'afgerond')
            group by i.service_name) y), '[]'::jsonb),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('start', to_char(b.bucket, 'YYYY-MM-DD'), 'planned', b.planned,
                                          'completed', b.completed, 'revenue_cents', b.revenue_cents) order by b.bucket)
      from per_bucket b), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.appointment_stats(timestamptz, timestamptz, text, uuid, boolean) from public, anon;
grant execute on function public.appointment_stats(timestamptz, timestamptz, text, uuid, boolean) to authenticated;
