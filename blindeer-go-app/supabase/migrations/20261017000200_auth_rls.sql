-- Accounts, rollen en Row Level Security.
-- Rechten worden in de database afgedwongen; de app verbergt knoppen alleen voor het gemak.

-- ---------------------------------------------------------------------------
-- Hulpfuncties
-- ---------------------------------------------------------------------------
create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active);
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'owner');
$$;

revoke all on function public.is_active_member() from public;
revoke all on function public.is_owner() from public;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.is_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Profiel automatisch aanmaken bij een nieuw (uitgenodigd) account.
-- Rol en partij komen uit app_metadata, die alleen de server (service role) kan zetten.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role := 'colleague';
  v_team uuid;
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

  insert into public.profiles (id, email, display_name, role, team_id)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'gebruiker'), '@', 1)),
    v_role,
    v_team
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- E-mailadres in profiel bijwerken zodra een nieuw adres in auth daadwerkelijk is bevestigd.
create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Eerste beheerder aanmaken (alleen via SQL editor / service role uit te voeren).
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_owner(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then
    raise exception 'Geen account gevonden met e-mailadres %', p_email;
  end if;
  update public.profiles set role = 'owner', active = true where id = v_id;
end $$;
revoke all on function public.promote_to_owner(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Beheer van teamleden door eigenaar
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_member(
  p_user_id uuid,
  p_role public.user_role default null,
  p_team_id uuid default null,
  p_clear_team boolean default false,
  p_active boolean default null,
  p_display_name text default null
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

  -- Er moet altijd minimaal één actieve eigenaar overblijven.
  if (p_role is not null and p_role <> 'owner') or p_active = false then
    if v_row.role = 'owner' and v_row.active then
      select count(*) into v_owner_count from public.profiles where role = 'owner' and active and id <> p_user_id;
      if v_owner_count = 0 then
        raise exception 'Er moet minimaal één actieve eigenaar blijven';
      end if;
    end if;
  end if;

  update public.profiles set
    role = coalesce(p_role, role),
    team_id = case when p_clear_team then null else coalesce(p_team_id, team_id) end,
    active = coalesce(p_active, active),
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name)
  where id = p_user_id
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.admin_update_member(uuid, public.user_role, uuid, boolean, boolean, text) from public, anon;
grant execute on function public.admin_update_member(uuid, public.user_role, uuid, boolean, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.company_settings enable row level security;
alter table public.teams enable row level security;
alter table public.workstations enable row level security;
alter table public.profiles enable row level security;
alter table public.opening_hours enable row level security;
alter table public.recurring_breaks enable row level security;
alter table public.date_overrides enable row level security;
alter table public.blocks enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.services enable row level security;
alter table public.service_prices enable row level security;
alter table public.model_exceptions enable row level security;
alter table public.bundles enable row level security;
alter table public.discount_rules enable row level security;
alter table public.vehicle_model_hints enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_items enable row level security;
alter table public.appointment_events enable row level security;
alter table public.appointment_photos enable row level security;

-- Anonieme gebruikers krijgen nergens toegang toe.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- Leesrecht voor actieve teamleden, schrijfrecht voor eigenaar (bedrijfsregels en catalogus).
do $$
declare
  t text;
begin
  foreach t in array array[
    'company_settings', 'teams', 'workstations', 'opening_hours', 'recurring_breaks', 'date_overrides',
    'services', 'service_prices', 'model_exceptions', 'bundles', 'discount_rules', 'vehicle_model_hints'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_member())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_owner())', t || '_insert_owner', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_owner()) with check (public.is_owner())', t || '_update_owner', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_owner())', t || '_delete_owner', t);
  end loop;
end $$;
-- De instellingenrij kan niet verwijderd worden.
drop policy company_settings_delete_owner on public.company_settings;

-- Profielen: iedereen in het team ziet namen; je eigen profiel zie je altijd (ook als je bent uitgeschakeld).
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active_member() or id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_member())
  with check (id = auth.uid());
-- Alleen deze kolommen mag een gebruiker zelf wijzigen; rol/actief/partij lopen via admin_update_member.
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name, phone, avatar_path, notification_prefs) on public.profiles to authenticated;

-- Blokkades en afwezigheid: planning, dus door alle actieve teamleden te beheren.
create policy blocks_select on public.blocks for select to authenticated using (public.is_active_member());
create policy blocks_insert on public.blocks for insert to authenticated with check (public.is_active_member());
create policy blocks_update on public.blocks for update to authenticated using (public.is_active_member()) with check (public.is_active_member());
create policy blocks_delete on public.blocks for delete to authenticated using (public.is_active_member());

-- Klanten en voertuigen: lezen, toevoegen, wijzigen. Niet verwijderen (archiveren via archived_at).
create policy customers_select on public.customers for select to authenticated using (public.is_active_member());
create policy customers_insert on public.customers for insert to authenticated with check (public.is_active_member());
create policy customers_update on public.customers for update to authenticated using (public.is_active_member()) with check (public.is_active_member());
create policy vehicles_select on public.vehicles for select to authenticated using (public.is_active_member());
create policy vehicles_insert on public.vehicles for insert to authenticated with check (public.is_active_member());
create policy vehicles_update on public.vehicles for update to authenticated using (public.is_active_member()) with check (public.is_active_member());
revoke delete on public.customers, public.vehicles from authenticated;

-- Afspraken: alleen lezen via tabellen; schrijven uitsluitend via save_appointment / set_appointment_status.
create policy appointments_select on public.appointments for select to authenticated using (public.is_active_member());
create policy appointment_items_select on public.appointment_items for select to authenticated using (public.is_active_member());
create policy appointment_events_select on public.appointment_events for select to authenticated using (public.is_active_member());
revoke insert, update, delete on public.appointments, public.appointment_items, public.appointment_events from authenticated;

create policy appointment_photos_select on public.appointment_photos for select to authenticated using (public.is_active_member());
create policy appointment_photos_insert on public.appointment_photos for insert to authenticated
  with check (public.is_active_member() and uploaded_by = auth.uid());
create policy appointment_photos_delete on public.appointment_photos for delete to authenticated
  using (public.is_active_member() and (uploaded_by = auth.uid() or public.is_owner()));
revoke update on public.appointment_photos from authenticated;
