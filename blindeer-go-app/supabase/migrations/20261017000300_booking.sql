-- Boekingsregels, capaciteit en het opslaan van afspraken.
-- Alle controles draaien op de server binnen één transactie met een advisory lock,
-- zodat twee collega's die tegelijk boeken nooit samen dezelfde capaciteit gebruiken.

create or replace function public.company_tz() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from public.company_settings where id = 1), 'Europe/Amsterdam');
$$;

-- Statussen die tijd/capaciteit bezetten.
create or replace function public.status_occupies(p_status public.appointment_status) returns boolean
language sql immutable as $$
  select p_status in ('ingepland', 'bezig', 'afgerond');
$$;

-- Bezettende afspraken waarvan [start, einde + eigen buffer) overlapt met [p_from, p_to).
create or replace function public.occupying_overlaps(p_from timestamptz, p_to timestamptz, p_exclude_id uuid)
returns table (id uuid, starts_at timestamptz, occ_end timestamptz, team_id uuid, assignee_id uuid, workstation_id uuid)
language sql stable security definer set search_path = '' as $$
  select a.id, a.starts_at, a.ends_at + make_interval(mins => a.buffer_min), a.team_id, a.assignee_id, a.workstation_id
  from public.appointments a
  where public.status_occupies(a.status)
    and (p_exclude_id is null or a.id <> p_exclude_id)
    and a.starts_at < p_to
    and p_from < a.ends_at + make_interval(mins => a.buffer_min);
$$;
revoke all on function public.occupying_overlaps(timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Controle van een (voorgestelde) afspraak. Geeft een lijst met problemen terug.
-- overridable = eigenaar mag dit bewust negeren (openingstijden, pauzes, blokkades);
-- capaciteits- en dubbele-boekingsconflicten zijn nooit te negeren.
-- ---------------------------------------------------------------------------
create or replace function public.booking_problems(
  p_starts_at timestamptz,
  p_duration_min integer,
  p_buffer_min integer default null,
  p_team_id uuid default null,
  p_assignee_id uuid default null,
  p_workstation_id uuid default null,
  p_exclude_id uuid default null
) returns table (code text, message text, overridable boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.company_settings;
  v_tz text;
  v_ends timestamptz;
  v_buffer integer;
  v_local_start timestamp;
  v_local_end timestamp;
  v_date date;
  v_open time;
  v_close time;
  v_closed boolean;
  v_ignore_breaks boolean := false;
  v_override public.date_overrides;
  v_hours public.opening_hours;
  v_limit_end time;
  v_team_max integer;
  v_max integer;
  r record;
begin
  if not public.is_active_member() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  select * into s from public.company_settings where id = 1;
  v_tz := coalesce(s.timezone, 'Europe/Amsterdam');
  v_buffer := coalesce(p_buffer_min, s.default_buffer_min, 0);
  v_ends := p_starts_at + make_interval(mins => p_duration_min);

  if p_duration_min is null or p_duration_min <= 0 then
    return query select 'duur'::text, 'Vul een behandelduur in.'::text, false;
    return;
  end if;

  v_local_start := p_starts_at at time zone v_tz;
  v_local_end := v_ends at time zone v_tz;
  v_date := v_local_start::date;

  -- Openingstijden (afwijkende datum gaat voor)
  select * into v_override from public.date_overrides where date = v_date;
  if found then
    v_closed := v_override.is_closed;
    v_open := v_override.open_time;
    v_close := v_override.close_time;
    v_ignore_breaks := v_override.ignore_breaks;
  else
    select * into v_hours from public.opening_hours where weekday = extract(isodow from v_date)::smallint;
    if found then
      v_closed := v_hours.is_closed;
      v_open := v_hours.open_time;
      v_close := v_hours.close_time;
    else
      v_closed := true;
    end if;
  end if;

  if v_local_end::date > v_date and v_local_end::time <> time '00:00' then
    return query select 'meerdaags'::text, 'Een afspraak moet op dezelfde dag eindigen.'::text, true;
  end if;

  if v_closed then
    return query select 'gesloten'::text,
      format('Op %s is het bedrijf gesloten%s.', to_char(v_date, 'DD-MM-YYYY'),
             case when v_override.note is not null then ' (' || v_override.note || ')' else '' end),
      true;
  else
    v_limit_end := v_local_end::time;
    if v_local_end::date > v_date then v_limit_end := time '24:00'; end if;
    if v_local_start::time < v_open then
      return query select 'voor_opening'::text, format('Start ligt vóór opening (%s).', to_char(v_open, 'HH24:MI')), true;
    end if;
    if v_limit_end > v_close then
      return query select 'na_sluiting'::text, format('Afspraak loopt door na sluitingstijd (%s).', to_char(v_close, 'HH24:MI')), true;
    elsif s.buffer_must_fit_before_close and v_buffer > 0
          and (v_local_end + make_interval(mins => v_buffer))::time > v_close
          and (v_local_end + make_interval(mins => v_buffer))::date = v_date then
      return query select 'buffer_na_sluiting'::text,
        format('De buffer van %s min na deze afspraak valt na sluitingstijd (%s).', v_buffer, to_char(v_close, 'HH24:MI')), true;
    end if;

    if s.breaks_block_appointments and not v_ignore_breaks then
      for r in
        select b.label, b.start_time, b.end_time from public.recurring_breaks b
        where b.active and (b.weekday is null or b.weekday = extract(isodow from v_date)::smallint)
          and b.start_time < v_limit_end and v_local_start::time < b.end_time
        order by b.start_time
      loop
        return query select 'pauze'::text,
          format('Overlapt met %s (%s–%s).', lower(r.label), to_char(r.start_time, 'HH24:MI'), to_char(r.end_time, 'HH24:MI')), true;
      end loop;
    end if;
  end if;

  -- Blokkades en afwezigheid
  for r in
    select b.* from public.blocks b
    where b.starts_at < v_ends and p_starts_at < b.ends_at
      and (
        (b.team_id is null and b.workstation_id is null and b.profile_id is null)
        or (b.team_id is not null and b.team_id = p_team_id)
        or (b.workstation_id is not null and b.workstation_id = p_workstation_id)
        or (b.profile_id is not null and b.profile_id = p_assignee_id)
      )
  loop
    return query select case when r.kind = 'afwezigheid' then 'afwezig' else 'blokkade' end,
      format('%s: %s', case when r.kind = 'afwezigheid' then 'Afwezigheid' else 'Blokkade' end, r.reason), true;
  end loop;

  -- Toegewezen partij / medewerker / werkplek moeten actief zijn
  if p_team_id is not null and not exists (select 1 from public.teams t where t.id = p_team_id and t.active) then
    return query select 'partij_inactief'::text, 'De gekozen uitvoerende partij is niet actief.'::text, false;
  end if;
  if p_assignee_id is not null and not exists (select 1 from public.profiles p where p.id = p_assignee_id and p.active) then
    return query select 'medewerker_inactief'::text, 'De gekozen medewerker is niet actief.'::text, false;
  end if;
  if p_workstation_id is not null and not exists (select 1 from public.workstations w where w.id = p_workstation_id and w.active) then
    return query select 'werkplek_inactief'::text, 'De gekozen werkplek is niet actief.'::text, false;
  end if;

  -- Bezetting: [start, einde + buffer) van beide afspraken mag niet overlappen op dezelfde resource.
  if p_workstation_id is not null and exists (
    select 1 from public.occupying_overlaps(p_starts_at, v_ends + make_interval(mins => v_buffer), p_exclude_id) o
    where o.workstation_id = p_workstation_id
  ) then
    return query select 'werkplek_bezet'::text, 'Deze werkplek is op dat moment al bezet (inclusief buffer).'::text, false;
  end if;
  if p_assignee_id is not null and exists (
    select 1 from public.occupying_overlaps(p_starts_at, v_ends + make_interval(mins => v_buffer), p_exclude_id) o
    where o.assignee_id = p_assignee_id
  ) then
    return query select 'medewerker_bezet'::text, 'Deze medewerker heeft op dat moment al een afspraak (inclusief buffer).'::text, false;
  end if;

  -- Maximale gelijktijdigheid binnen het interval: tel op elk beginpunt.
  with ov as (
    select * from public.occupying_overlaps(p_starts_at, v_ends + make_interval(mins => v_buffer), p_exclude_id)
  )
  select coalesce(max((select count(*) from ov o where o.starts_at <= t.pt and t.pt < o.occ_end)), 0) into v_max
  from (select p_starts_at as pt union select ov.starts_at from ov where ov.starts_at > p_starts_at) t;
  if v_max + 1 > s.max_parallel_appointments then
    return query select 'capaciteit'::text,
      format('Capaciteit vol: maximaal %s afspra%s tegelijk (inclusief buffer).',
             s.max_parallel_appointments, case when s.max_parallel_appointments = 1 then 'ak' else 'ken' end),
      false;
  end if;

  if p_team_id is not null then
    select t.max_parallel into v_team_max from public.teams t where t.id = p_team_id;
    if v_team_max is not null then
      with ov as (
        select * from public.occupying_overlaps(p_starts_at, v_ends + make_interval(mins => v_buffer), p_exclude_id) o
        where o.team_id = p_team_id
      )
      select coalesce(max((select count(*) from ov o where o.starts_at <= t.pt and t.pt < o.occ_end)), 0) into v_max
      from (select p_starts_at as pt union select ov.starts_at from ov where ov.starts_at > p_starts_at) t;
      if v_max + 1 > v_team_max then
        return query select 'capaciteit_partij'::text,
          format('Deze uitvoerende partij heeft al het maximum van %s gelijktijdige afspra%s.', v_team_max,
                 case when v_team_max = 1 then 'ak' else 'ken' end),
          false;
      end if;
    end if;
  end if;
end $$;

revoke all on function public.booking_problems(timestamptz, integer, integer, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.booking_problems(timestamptz, integer, integer, uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Beschikbare starttijden op een dag (op het ingestelde rooster).
-- ---------------------------------------------------------------------------
create or replace function public.available_starts(
  p_date date,
  p_duration_min integer,
  p_buffer_min integer default null,
  p_team_id uuid default null,
  p_assignee_id uuid default null,
  p_workstation_id uuid default null,
  p_exclude_id uuid default null
) returns setof timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.company_settings;
  v_open time;
  v_close time;
  v_closed boolean;
  v_t time;
  v_start timestamptz;
  o public.date_overrides;
  h public.opening_hours;
begin
  if not public.is_active_member() then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  select * into s from public.company_settings where id = 1;

  select * into o from public.date_overrides where date = p_date;
  if found then
    v_closed := o.is_closed; v_open := o.open_time; v_close := o.close_time;
  else
    select * into h from public.opening_hours where weekday = extract(isodow from p_date)::smallint;
    if not found then return; end if;
    v_closed := h.is_closed; v_open := h.open_time; v_close := h.close_time;
  end if;
  if v_closed then return; end if;

  v_t := v_open;
  while v_t < v_close loop
    v_start := (p_date + v_t) at time zone s.timezone;
    if not exists (
      select 1 from public.booking_problems(v_start, p_duration_min, p_buffer_min, p_team_id, p_assignee_id, p_workstation_id, p_exclude_id)
    ) then
      return next v_start;
    end if;
    exit when v_t + make_interval(mins => s.slot_interval_min) <= v_t; -- overloop na middernacht
    v_t := v_t + make_interval(mins => s.slot_interval_min);
  end loop;
end $$;

revoke all on function public.available_starts(date, integer, integer, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.available_starts(date, integer, integer, uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Afspraak opslaan (nieuw of wijzigen). Eén transactie, server-side validatie,
-- idempotent via client_request_id, optimistische vergrendeling via version.
-- ---------------------------------------------------------------------------
create or replace function public.save_appointment(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_old public.appointments;
  v_new public.appointments;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_req uuid := nullif(p ->> 'client_request_id', '')::uuid;
  v_starts timestamptz := (p ->> 'starts_at')::timestamptz;
  v_duration integer := (p ->> 'duration_min')::integer;
  v_buffer integer;
  v_team uuid := nullif(p ->> 'team_id', '')::uuid;
  v_assignee uuid := nullif(p ->> 'assignee_id', '')::uuid;
  v_ws uuid := nullif(p ->> 'workstation_id', '')::uuid;
  v_status public.appointment_status := coalesce(nullif(p ->> 'status', ''), 'ingepland')::public.appointment_status;
  v_force boolean := coalesce((p ->> 'force')::boolean, false);
  v_problems jsonb;
  v_blocking jsonb;
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_item jsonb;
  v_pos integer := 0;
  v_total integer := 0;
  v_discount integer := 0;
  v_complete boolean := true;
  v_deviates boolean := false;
  v_changes jsonb := '{}'::jsonb;
  v_action text;
begin
  select * into v_me from public.profiles where id = v_uid;
  if v_me.id is null or not v_me.active then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if v_starts is null then raise exception 'Starttijd ontbreekt'; end if;
  if nullif(trim(p ->> 'customer_name'), '') is null then raise exception 'Klantnaam ontbreekt'; end if;

  select default_buffer_min into v_buffer from public.company_settings where id = 1;
  v_buffer := coalesce((p ->> 'buffer_min')::integer, v_buffer, 0);

  -- Alle boekingen worden geserialiseerd; voor een klein team is dit ruim snel genoeg
  -- en het sluit gelijktijdige dubbele boekingen volledig uit.
  perform pg_advisory_xact_lock(hashtext('blindeer_go_booking'));

  if v_id is null then
    if v_req is null then raise exception 'client_request_id ontbreekt'; end if;
    select * into v_old from public.appointments where client_request_id = v_req;
    if found then
      -- Zelfde verzoek opnieuw verstuurd (bv. dubbel tikken / netwerk-retry): geef bestaande terug.
      return jsonb_build_object('appointment', to_jsonb(v_old), 'duplicate', true);
    end if;
  else
    select * into v_old from public.appointments where id = v_id for update;
    if not found then raise exception 'Afspraak niet gevonden'; end if;
    if (p ->> 'expected_version')::integer is distinct from v_old.version then
      raise exception 'VERSIE_CONFLICT'
        using detail = jsonb_build_object('current_version', v_old.version, 'updated_by_name', v_old.updated_by_name, 'updated_at', v_old.updated_at)::text,
              hint = 'Deze afspraak is intussen door iemand anders gewijzigd. Herlaad en probeer opnieuw.';
    end if;
  end if;

  if v_force and v_me.role <> 'owner' then
    raise exception 'Alleen de eigenaar mag bedrijfsregels bewust negeren' using errcode = '42501';
  end if;

  if public.status_occupies(v_status) then
    select coalesce(jsonb_agg(to_jsonb(bp)), '[]'::jsonb) into v_problems
    from public.booking_problems(v_starts, v_duration, v_buffer, v_team, v_assignee, v_ws, v_id) bp;
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_blocking
    from jsonb_array_elements(v_problems) e
    where not (v_force and (e ->> 'overridable')::boolean);
    if jsonb_array_length(v_blocking) > 0 then
      raise exception 'BOEKING_NIET_MOGELIJK'
        using detail = v_blocking::text,
              hint = (select string_agg(e ->> 'message', ' ') from jsonb_array_elements(v_blocking) e);
    end if;
  else
    v_problems := '[]'::jsonb;
  end if;

  -- Totalen worden op de server opnieuw berekend uit de regels.
  for v_item in select * from jsonb_array_elements(v_items) loop
    if v_item ->> 'price_cents' is null then
      v_complete := false;
    else
      v_total := v_total + (v_item ->> 'price_cents')::integer - coalesce((v_item ->> 'discount_cents')::integer, 0);
    end if;
    v_discount := v_discount + coalesce((v_item ->> 'discount_cents')::integer, 0);
    if coalesce((v_item ->> 'price_overridden')::boolean, false) or coalesce((v_item ->> 'duration_overridden')::boolean, false) then
      v_deviates := true;
    end if;
  end loop;
  if jsonb_array_length(v_items) = 0 then v_complete := false; end if;
  v_deviates := v_deviates or coalesce((p ->> 'duration_overridden')::boolean, false);

  if v_id is null then
    insert into public.appointments (
      client_request_id, customer_id, vehicle_id, customer_name, customer_phone, customer_email, vehicle,
      starts_at, ends_at, duration_min, buffer_min, team_id, assignee_id, workstation_id, status, status_reason,
      price_total_cents, price_complete, discount_total_cents, deviates_from_standard, internal_notes,
      rules_overridden, override_reason, created_by, created_by_name, updated_by, updated_by_name
    ) values (
      v_req, nullif(p ->> 'customer_id', '')::uuid, nullif(p ->> 'vehicle_id', '')::uuid,
      trim(p ->> 'customer_name'), nullif(trim(p ->> 'customer_phone'), ''), nullif(trim(p ->> 'customer_email'), ''),
      coalesce(p -> 'vehicle', '{}'::jsonb),
      v_starts, v_starts + make_interval(mins => v_duration), v_duration, v_buffer, v_team, v_assignee, v_ws,
      v_status, nullif(p ->> 'status_reason', ''),
      case when v_complete then v_total end, v_complete, v_discount, v_deviates, nullif(p ->> 'internal_notes', ''),
      v_force and jsonb_array_length(v_problems) > 0, case when v_force then nullif(p ->> 'override_reason', '') end,
      v_uid, v_me.display_name, v_uid, v_me.display_name
    ) returning * into v_new;
    v_action := 'aangemaakt';
    v_changes := jsonb_build_object('starts_at', v_new.starts_at, 'team_id', v_new.team_id, 'status', v_new.status);
  else
    update public.appointments set
      customer_id = nullif(p ->> 'customer_id', '')::uuid,
      vehicle_id = nullif(p ->> 'vehicle_id', '')::uuid,
      customer_name = trim(p ->> 'customer_name'),
      customer_phone = nullif(trim(p ->> 'customer_phone'), ''),
      customer_email = nullif(trim(p ->> 'customer_email'), ''),
      vehicle = coalesce(p -> 'vehicle', '{}'::jsonb),
      starts_at = v_starts,
      ends_at = v_starts + make_interval(mins => v_duration),
      duration_min = v_duration,
      buffer_min = v_buffer,
      team_id = v_team,
      assignee_id = v_assignee,
      workstation_id = v_ws,
      status = v_status,
      status_reason = nullif(p ->> 'status_reason', ''),
      price_total_cents = case when v_complete then v_total end,
      price_complete = v_complete,
      discount_total_cents = v_discount,
      deviates_from_standard = v_deviates,
      internal_notes = nullif(p ->> 'internal_notes', ''),
      rules_overridden = v_force and jsonb_array_length(v_problems) > 0,
      override_reason = case when v_force then nullif(p ->> 'override_reason', '') end,
      updated_by = v_uid,
      updated_by_name = v_me.display_name,
      updated_at = now(),
      version = version + 1
    where id = v_id
    returning * into v_new;

    if v_new.starts_at <> v_old.starts_at or v_new.duration_min <> v_old.duration_min then
      v_changes := v_changes || jsonb_build_object('van', jsonb_build_object('starts_at', v_old.starts_at, 'ends_at', v_old.ends_at),
                                                   'naar', jsonb_build_object('starts_at', v_new.starts_at, 'ends_at', v_new.ends_at));
    end if;
    if v_new.team_id is distinct from v_old.team_id then
      v_changes := v_changes || jsonb_build_object('team_van', v_old.team_id, 'team_naar', v_new.team_id);
    end if;
    if v_new.status <> v_old.status then
      v_changes := v_changes || jsonb_build_object('status_van', v_old.status, 'status_naar', v_new.status);
    end if;
    if v_new.price_total_cents is distinct from v_old.price_total_cents then
      v_changes := v_changes || jsonb_build_object('prijs_van', v_old.price_total_cents, 'prijs_naar', v_new.price_total_cents);
    end if;
    v_action := case when v_new.starts_at <> v_old.starts_at then 'verplaatst' else 'gewijzigd' end;
    delete from public.appointment_items where appointment_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    insert into public.appointment_items (
      appointment_id, position, service_id, service_name, price_rule_label, model_exception_id, model_exception_label,
      bundle_id, bundle_label, film_brand, film_kind, film_percentage, film_color, measured_vlt,
      standard_price_cents, price_cents, standard_duration_min, duration_min, discount_cents, discount_label,
      discount_rule_id, price_overridden, duration_overridden, note
    ) values (
      v_new.id, v_pos,
      nullif(v_item ->> 'service_id', '')::uuid,
      coalesce(nullif(trim(v_item ->> 'service_name'), ''), 'Onbekende behandeling'),
      nullif(v_item ->> 'price_rule_label', ''),
      nullif(v_item ->> 'model_exception_id', '')::uuid,
      nullif(v_item ->> 'model_exception_label', ''),
      nullif(v_item ->> 'bundle_id', '')::uuid,
      nullif(v_item ->> 'bundle_label', ''),
      nullif(v_item ->> 'film_brand', ''),
      nullif(v_item ->> 'film_kind', ''),
      (v_item ->> 'film_percentage')::integer,
      nullif(v_item ->> 'film_color', ''),
      (v_item ->> 'measured_vlt')::numeric,
      (v_item ->> 'standard_price_cents')::integer,
      (v_item ->> 'price_cents')::integer,
      (v_item ->> 'standard_duration_min')::integer,
      (v_item ->> 'duration_min')::integer,
      coalesce((v_item ->> 'discount_cents')::integer, 0),
      nullif(v_item ->> 'discount_label', ''),
      nullif(v_item ->> 'discount_rule_id', '')::uuid,
      coalesce((v_item ->> 'price_overridden')::boolean, false),
      coalesce((v_item ->> 'duration_overridden')::boolean, false),
      nullif(v_item ->> 'note', '')
    );
    v_pos := v_pos + 1;
  end loop;

  if v_new.rules_overridden then
    v_changes := v_changes || jsonb_build_object('regels_genegeerd', v_problems, 'reden', v_new.override_reason);
  end if;

  insert into public.appointment_events (appointment_id, actor_id, actor_name, action, details)
  values (v_new.id, v_uid, v_me.display_name, v_action, v_changes);

  return jsonb_build_object('appointment', to_jsonb(v_new), 'duplicate', false, 'warnings', v_problems);
end $$;

revoke all on function public.save_appointment(jsonb) from public, anon;
grant execute on function public.save_appointment(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Status wijzigen (incl. annuleren — de afspraak blijft bewaard).
-- ---------------------------------------------------------------------------
create or replace function public.set_appointment_status(
  p_id uuid,
  p_status public.appointment_status,
  p_expected_version integer,
  p_reason text default null
) returns public.appointments
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_old public.appointments;
  v_new public.appointments;
  v_problems text;
begin
  select * into v_me from public.profiles where id = v_uid;
  if v_me.id is null or not v_me.active then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('blindeer_go_booking'));
  select * into v_old from public.appointments where id = p_id for update;
  if not found then raise exception 'Afspraak niet gevonden'; end if;
  if p_expected_version is distinct from v_old.version then
    raise exception 'VERSIE_CONFLICT'
      using detail = jsonb_build_object('current_version', v_old.version, 'updated_by_name', v_old.updated_by_name)::text,
            hint = 'Deze afspraak is intussen door iemand anders gewijzigd. Herlaad en probeer opnieuw.';
  end if;
  if v_old.status = p_status then
    return v_old;
  end if;

  -- Terugzetten van geannuleerd/niet verschenen naar een actieve status vraagt opnieuw om vrije capaciteit.
  if public.status_occupies(p_status) and not public.status_occupies(v_old.status) then
    select string_agg(bp.message, ' ') into v_problems
    from public.booking_problems(v_old.starts_at, v_old.duration_min, v_old.buffer_min, v_old.team_id,
                                 v_old.assignee_id, v_old.workstation_id, v_old.id) bp
    where not bp.overridable or not v_old.rules_overridden;
    if v_problems is not null then
      raise exception 'BOEKING_NIET_MOGELIJK' using hint = v_problems;
    end if;
  end if;

  update public.appointments set
    status = p_status,
    status_reason = nullif(trim(p_reason), ''),
    updated_by = v_uid,
    updated_by_name = v_me.display_name,
    updated_at = now(),
    version = version + 1
  where id = p_id
  returning * into v_new;

  insert into public.appointment_events (appointment_id, actor_id, actor_name, action, details)
  values (p_id, v_uid, v_me.display_name,
          case p_status when 'geannuleerd' then 'geannuleerd' else 'status' end,
          jsonb_build_object('status_van', v_old.status, 'status_naar', p_status, 'reden', nullif(trim(p_reason), '')));
  return v_new;
end $$;

revoke all on function public.set_appointment_status(uuid, public.appointment_status, integer, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, public.appointment_status, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: wijzigingen direct naar collega's (respecteert RLS).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.appointments, public.blocks, public.customers, public.vehicles, public.profiles, public.teams,
      public.company_settings, public.opening_hours, public.recurring_breaks, public.date_overrides;
  end if;
end $$;
