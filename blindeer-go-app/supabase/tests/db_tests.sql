-- Databasetests: rechten, uitschakelen, boekingsregels, tijdzone, idempotentie, versieconflicten.
-- Draait als superuser en wisselt per test naar de Supabase-rol "authenticated" met een gebruikers-id.
\set QUIET on
\pset tuples_only on

create schema t;
grant usage on schema t to public;

create function t.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'TEST MISLUKT: %', p_name; end if;
  raise notice 'ok - %', p_name;
end $$;

create function t.expect_error(p_sql text, p_like text, p_name text) returns void language plpgsql as $$
declare
  v_msg text; v_hint text; v_detail text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    if (v_msg || ' ' || coalesce(v_hint, '') || ' ' || coalesce(v_detail, '')) ilike p_like then
      raise notice 'ok - % (fout: %)', p_name, v_msg;
      return;
    end if;
    raise exception 'TEST MISLUKT: %, onverwachte fout: % / % / %', p_name, v_msg, v_hint, v_detail;
  end;
  raise exception 'TEST MISLUKT: %, fout bleef uit', p_name;
end $$;

-- Afspraak-payload helper (lokale tijd in Europe/Amsterdam)
create function t.appt(p_req uuid, p_local timestamp, p_dur int, p_team text default null, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object(
    'client_request_id', p_req,
    'customer_name', 'Testklant',
    'customer_phone', '0612345678',
    'starts_at', (p_local at time zone 'Europe/Amsterdam'),
    'duration_min', p_dur,
    'team_id', (select id from public.teams where name = p_team),
    'items', jsonb_build_array(jsonb_build_object('service_name', 'Blinderen vanaf de B-stijl', 'price_cents', 12000, 'duration_min', p_dur))
  ) || p_extra
$$;

create function t.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
$$;

grant execute on all functions in schema t to public;

-- ---------------------------------------------------------------------------
-- Accounts (zoals ze via uitnodigingen binnenkomen)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'eigenaar@test.invalid', '{"display_name":"Rayan (Blindeer & Go)"}', '{"role":"owner"}'),
  ('00000000-0000-0000-0000-00000000000b', 'collega1@test.invalid', '{"display_name":"Pro TintMaster","role":"owner"}',
     jsonb_build_object('role', 'colleague', 'team_id', (select id from public.teams where name = 'Pro TintMaster'))),
  ('00000000-0000-0000-0000-00000000000c', 'collega2@test.invalid', '{"display_name":"TintserviceNL"}',
     jsonb_build_object('team_id', (select id from public.teams where name = 'TintserviceNL')));

select t.ok((select role from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'owner', 'eigenaar krijgt rol uit app_metadata');
select t.ok((select role from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'colleague',
            'rol in user_metadata (door gebruiker te beïnvloeden) wordt genegeerd');
select t.ok((select t2.name from public.profiles p join public.teams t2 on t2.id = p.team_id where p.id = '00000000-0000-0000-0000-00000000000c') = 'TintserviceNL',
            'partij uit uitnodiging wordt gekoppeld');
select t.ok((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'Pro TintMaster', 'weergavenaam uit uitnodiging');

-- ---------------------------------------------------------------------------
-- Anonieme toegang
-- ---------------------------------------------------------------------------
set role anon;
select t.expect_error('select count(*) from public.appointments', '%permission denied%', 'anoniem kan geen afspraken lezen');
select t.expect_error('select count(*) from public.customers', '%permission denied%', 'anoniem kan geen klanten lezen');
select t.expect_error($$select public.save_appointment('{}'::jsonb)$$, '%permission denied%', 'anoniem kan geen afspraak opslaan');
reset role;

-- ---------------------------------------------------------------------------
-- Rechten collega
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');
select t.ok((select count(*) from public.teams) = 3, 'collega ziet uitvoerende partijen');
update public.company_settings set default_buffer_min = 0;
select t.ok((select default_buffer_min from public.company_settings) = 15, 'collega kan bedrijfsregels niet wijzigen');
update public.service_prices set price_cents = 1;
select t.ok((select count(*) from public.service_prices where price_cents = 1) = 0, 'collega kan prijzen niet wijzigen');
select t.expect_error($$insert into public.services (name) values ('Nep')$$, '%row-level security%', 'collega kan geen dienst toevoegen');
select t.expect_error($$update public.profiles set role = 'owner' where id = auth.uid()$$, '%permission denied%', 'collega kan eigen rol niet verhogen');
select t.expect_error($$update public.profiles set active = true where id = auth.uid()$$, '%permission denied%', 'collega kan eigen actief-status niet wijzigen');
update public.profiles set phone = '0611111111' where id = auth.uid();
select t.ok((select phone from public.profiles where id = auth.uid()) = '0611111111', 'collega kan eigen telefoonnummer wijzigen');
update public.profiles set phone = '0699999999' where id = '00000000-0000-0000-0000-00000000000c';
select t.ok((select phone from public.profiles where id = '00000000-0000-0000-0000-00000000000c') is null, 'collega kan profiel van ander niet wijzigen');
select t.expect_error($$select public.admin_update_member('00000000-0000-0000-0000-00000000000c', p_active => false)$$,
                      '%Alleen de eigenaar%', 'collega kan geen accounts uitschakelen');
select t.expect_error($$insert into public.appointments (client_request_id, customer_name, starts_at, ends_at, duration_min, created_by, created_by_name)
                        values (gen_random_uuid(), 'x', now(), now() + interval '1 hour', 60, auth.uid(), 'x')$$,
                      '%permission denied%', 'afspraken kunnen niet buiten de servercontroles om worden geschreven');
insert into public.customers (name, phone) values ('Jan Klant', '06-12 34 56 78');
select t.ok((select phone_digits from public.customers where name = 'Jan Klant') = '0612345678', 'collega kan klant toevoegen; telefoon doorzoekbaar');
select t.expect_error($$delete from public.customers$$, '%permission denied%', 'klanten kunnen niet verwijderd worden (historie)');
insert into public.vehicles (customer_id, plate, make, model, body_type, rear_window_count)
  select id, 'ab-123-c', 'Volkswagen', 'Golf 5', 'hatchback', 5 from public.customers where name = 'Jan Klant';
select t.ok((select plate_norm from public.vehicles limit 1) = 'AB123C', 'kenteken genormaliseerd voor zoeken');
insert into public.blocks (starts_at, ends_at, reason, profile_id, kind)
  values ('2026-10-30 08:00Z', '2026-10-30 20:00Z', 'Vrij', auth.uid(), 'afwezigheid');
select t.ok((select count(*) from public.blocks) = 1, 'collega kan afwezigheid registreren');
reset role;

-- ---------------------------------------------------------------------------
-- Rechten eigenaar
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
update public.company_settings set slot_interval_min = 15;
select t.ok((select updated_at > now() - interval '1 minute' from public.company_settings), 'eigenaar kan instellingen wijzigen');
select t.expect_error($$select public.admin_update_member('00000000-0000-0000-0000-00000000000a', p_role => 'colleague')$$,
                      '%minimaal één actieve eigenaar%', 'laatste eigenaar kan zichzelf niet degraderen');
select t.expect_error($$update public.company_settings set timezone = 'Mars/Olympus'$$, '%time zone%', 'ongeldige tijdzone geweigerd');
reset role;

-- ---------------------------------------------------------------------------
-- Boeken: openingstijden, pauzes, buffers, capaciteit
-- Maandag 19-10-2026 (zomertijd, UTC+2)
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');

create temp table r (k text primary key, v jsonb);
grant all on r to public;

insert into r select 'a1', public.save_appointment(t.appt('10000000-0000-0000-0000-000000000001', '2026-10-19 10:00', 60, 'Pro TintMaster'));
select t.ok((select (v -> 'appointment' ->> 'starts_at')::timestamptz = '2026-10-19 08:00Z' from r where k = 'a1'),
            'maandag 10:00 Nederlandse tijd = 08:00 UTC (zomertijd)');
select t.ok((select v -> 'appointment' ->> 'created_by_name' = 'Pro TintMaster' from r where k = 'a1'), 'maker wordt vastgelegd');
select t.ok((select (v -> 'appointment' ->> 'price_total_cents')::int = 12000 from r where k = 'a1'), 'totaalprijs op server berekend');

-- dubbel tikken: zelfde client_request_id
insert into r select 'a1dup', public.save_appointment(t.appt('10000000-0000-0000-0000-000000000001', '2026-10-19 10:00', 60, 'Pro TintMaster'));
select t.ok((select (v ->> 'duplicate')::boolean from r where k = 'a1dup'), 'herhaald opslaan geeft bestaande afspraak terug');
select t.ok((select count(*) from public.appointments) = 1, 'geen dubbele afspraak na herhaald opslaan');

select t.login('00000000-0000-0000-0000-00000000000c');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-19 10:30', 60, 'TintserviceNL'))$$,
                      '%Capaciteit vol%', 'overlappende afspraak geweigerd bij capaciteit 1');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-19 11:00', 30, 'TintserviceNL'))$$,
                      '%Capaciteit vol%', 'buffer van 15 min na vorige afspraak afgedwongen');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-19 11:15', 60, 'TintserviceNL'))$$,
                      '%pauze (12:00–13:00)%', 'afspraak over de pauze heen geweigerd');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-19 09:30', 30, 'TintserviceNL'))$$,
                      '%vóór opening%', 'start vóór opening geweigerd');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-19 21:15', 60, 'TintserviceNL'))$$,
                      '%na sluitingstijd%', 'afspraak na sluiting geweigerd');
insert into r select 'a2', public.save_appointment(t.appt('10000000-0000-0000-0000-000000000002', '2026-10-19 11:15', 45, 'TintserviceNL'));
select t.ok(true, '11:15–12:00 past precies tussen buffer en pauze');
insert into r select 'a3', public.save_appointment(t.appt('10000000-0000-0000-0000-000000000003', '2026-10-19 21:00', 60, null));
select t.ok((select v -> 'appointment' ->> 'team_id' is null from r where k = 'a3'), 'laatste start 21:00 (60 min) toegestaan; niet toegewezen mogelijk');
reset role;

update public.company_settings set buffer_must_fit_before_close = true;
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000c');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-20 21:00', 60))$$,
                      '%buffer van 15 min%', 'instelling: buffer moet vóór sluiting vallen');
reset role;
update public.company_settings set buffer_must_fit_before_close = false;

-- ---------------------------------------------------------------------------
-- Tijdzone: zondag 25-10-2026 is de overgang naar wintertijd (UTC+1)
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
insert into r select 'w1', public.save_appointment(t.appt('10000000-0000-0000-0000-000000000004', '2026-10-25 12:00', 60));
select t.ok((select (v -> 'appointment' ->> 'starts_at')::timestamptz = '2026-10-25 11:00Z' from r where k = 'w1'),
            'zondag 25-10 12:00 (geen zondagpauze) = 11:00 UTC (wintertijd)');
select t.ok((select min(x) = '2026-11-01 11:00Z' and max(x) = '2026-11-01 18:00Z' and count(*) = 29
             from public.available_starts('2026-11-01', 60) x),
            'zondag zonder pauzes: eerste start 12:00, laatste start 19:00 voor 60 min (29 opties)');
select t.ok(not exists (select 1 from public.available_starts('2026-11-02', 60) x
                        where (x at time zone 'Europe/Amsterdam')::time in ('11:30', '12:00', '12:30', '15:30', '16:00')),
            'maandag: pauzes 12:00–13:00 en 16:00–17:00 blijven gelden');
select t.ok((select max(x) = '2026-10-20 19:00Z' from public.available_starts('2026-10-20', 60) x),
            'dinsdag zomertijd: laatste start 21:00 = 19:00 UTC');
select t.ok((select max(x) = '2026-11-03 20:00Z' from public.available_starts('2026-11-03', 60) x),
            'dinsdag wintertijd: laatste start 21:00 = 20:00 UTC');
select t.ok((select max(x) = '2026-11-03 18:30Z' from public.available_starts('2026-11-03', 150) x),
            'langere behandeling (150 min) moet eerder starten: laatste start 19:30');
select t.ok(not exists (select 1 from public.available_starts('2026-11-03', 150) x
                        where (x at time zone 'Europe/Amsterdam')::time < '13:00'),
            '150 min past niet in 10:00–12:00 of over de pauze');
reset role;

-- ---------------------------------------------------------------------------
-- Wijzigen, verplaatsen, versieconflict, annuleren
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000c');
select t.expect_error(format($$select public.save_appointment(%L::jsonb)$$,
    t.appt(null, '2026-10-19 13:00', 60) || jsonb_build_object('id', (select v -> 'appointment' ->> 'id' from r where k = 'a1'), 'expected_version', 99)),
  '%VERSIE_CONFLICT%', 'wijziging met verouderde versie wordt geweigerd (geen stil overschrijven)');
insert into r select 'a1moved', public.save_appointment(
  t.appt(null, '2026-10-19 13:00', 60, 'Pro TintMaster') || jsonb_build_object('id', (select v -> 'appointment' ->> 'id' from r where k = 'a1'), 'expected_version', 1));
select t.ok((select (v -> 'appointment' ->> 'version')::int = 2 and v -> 'appointment' ->> 'updated_by_name' = 'TintserviceNL' from r where k = 'a1moved'),
            'verplaatsen door collega: versie +1, wijziger vastgelegd');
select t.ok((select action = 'verplaatst' from public.appointment_events
             where appointment_id = (select (v -> 'appointment' ->> 'id')::uuid from r where k = 'a1') order by id desc limit 1),
            'wijzigingshistorie: verplaatsing gelogd');
-- 10:00 is nu vrij
insert into r select 'a5', public.save_appointment(t.appt('10000000-0000-0000-0000-000000000005', '2026-10-19 10:00', 60, 'TintserviceNL'));
select t.ok(true, 'oude tijd is weer vrij na verplaatsen');
-- annuleren
select public.set_appointment_status((select (v -> 'appointment' ->> 'id')::uuid from r where k = 'a5'), 'geannuleerd', 1, 'Klant belde af');
select t.ok((select status = 'geannuleerd' and status_reason = 'Klant belde af' from public.appointments
             where id = (select (v -> 'appointment' ->> 'id')::uuid from r where k = 'a5')), 'annuleren bewaart de afspraak');
insert into r select 'a6', public.save_appointment(t.appt('10000000-0000-0000-0000-000000000006', '2026-10-19 10:00', 60, 'Pro TintMaster'));
select t.ok(true, 'geannuleerde afspraak geeft capaciteit vrij');
select t.expect_error(format($$select public.set_appointment_status(%L, 'ingepland', 2)$$, (select v -> 'appointment' ->> 'id' from r where k = 'a5')),
                      '%Capaciteit vol%', 'heractiveren van geannuleerde afspraak controleert capaciteit');
select public.set_appointment_status((select (v -> 'appointment' ->> 'id')::uuid from r where k = 'a6'), 'bezig', 1);
select public.set_appointment_status((select (v -> 'appointment' ->> 'id')::uuid from r where k = 'a6'), 'afgerond', 2);
select t.ok((select status = 'afgerond' and version = 3 from public.appointments where id = (select (v -> 'appointment' ->> 'id')::uuid from r where k = 'a6')),
            'status bezig → afgerond');
reset role;

-- ---------------------------------------------------------------------------
-- Capaciteit 2, partijcapaciteit, werkplek en medewerker
-- ---------------------------------------------------------------------------
update public.company_settings set max_parallel_appointments = 2;
insert into public.workstations (name) values ('Werkplek 1'), ('Werkplek 2');
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-21 14:00', 60, 'Pro TintMaster',
  jsonb_build_object('workstation_id', (select id from public.workstations where name = 'Werkplek 1'))));
select t.expect_error(format($$select public.save_appointment(%L::jsonb)$$, t.appt(gen_random_uuid(), '2026-10-21 14:30', 60, 'TintserviceNL',
  jsonb_build_object('workstation_id', (select id from public.workstations where name = 'Werkplek 1')))),
  '%werkplek is op dat moment al bezet%', 'werkplek kan niet dubbel geboekt worden');
select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-21 14:30', 60, 'TintserviceNL',
  jsonb_build_object('workstation_id', (select id from public.workstations where name = 'Werkplek 2'))));
select t.ok(true, 'capaciteit 2: twee auto''s tegelijk op verschillende werkplekken');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-21 14:45', 30, 'Blindeer & Go'))$$,
                      '%maximaal 2 afspraken%', 'derde gelijktijdige afspraak geweigerd bij capaciteit 2');
select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-21 18:00', 60, null,
  jsonb_build_object('assignee_id', '00000000-0000-0000-0000-00000000000b')));
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-21 18:30', 60, null,
  jsonb_build_object('assignee_id', '00000000-0000-0000-0000-00000000000b')))$$,
  '%medewerker heeft op dat moment al%', 'medewerker kan niet op twee plekken tegelijk');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-30 14:00', 60, null,
  jsonb_build_object('assignee_id', '00000000-0000-0000-0000-00000000000b')))$$,
  '%Afwezigheid: Vrij%', 'afwezige medewerker kan niet ingepland worden');
reset role;
update public.teams set max_parallel = 1 where name = 'Pro TintMaster';
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-22 14:00', 60, 'Pro TintMaster'));
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-22 14:00', 60, 'Pro TintMaster'))$$,
                      '%uitvoerende partij heeft al het maximum%', 'capaciteit per uitvoerende partij');
select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-22 14:00', 60, 'TintserviceNL'));
select t.ok(true, 'andere partij kan wel tegelijk (bedrijfscapaciteit 2)');
reset role;

-- ---------------------------------------------------------------------------
-- Blokkades, afwijkende dagen en bewust negeren door eigenaar
-- ---------------------------------------------------------------------------
insert into public.date_overrides (date, is_closed, note) values ('2026-12-25', true, 'Kerst');
insert into public.date_overrides (date, open_time, close_time, ignore_breaks) values ('2026-12-24', '10:00', '16:00', true);
insert into public.blocks (starts_at, ends_at, reason) values ('2026-10-23 12:00Z', '2026-10-23 14:00Z', 'Onderhoud hal');
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-12-25 11:00', 60))$$, '%gesloten (Kerst)%', 'gesloten dag');
select public.save_appointment(t.appt(gen_random_uuid(), '2026-12-24 12:00', 60));
select t.ok(true, 'afwijkende dag zonder pauzes: 12:00 toegestaan');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-12-24 15:30', 60))$$, '%16:00%', 'afwijkende sluitingstijd');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-23 14:30', 60))$$, '%Blokkade: Onderhoud hal%', 'blokkade');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-23 14:30', 60, null, '{"force":true}'))$$,
                      '%Alleen de eigenaar%', 'collega kan regels niet negeren');
select t.login('00000000-0000-0000-0000-00000000000a');
create temp table forced as select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-23 14:30', 60, null,
  '{"force":true,"override_reason":"Spoedklus"}')) v;
select t.ok((select (v -> 'appointment' ->> 'rules_overridden')::boolean from forced), 'eigenaar kan blokkade bewust negeren (gelogd)');
select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-23 14:30', 60, null, '{"force":true}'));
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-23 14:30', 60, null, '{"force":true}'))$$,
                      '%maximaal 2%' , 'ook eigenaar kan capaciteit niet negeren');
reset role;

-- ---------------------------------------------------------------------------
-- Naam wijzigen behoudt historische identiteit
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');
update public.profiles set display_name = 'Pro TintMaster (nieuw)' where id = auth.uid();
select t.ok((select created_by_name = 'Pro TintMaster' and created_by = '00000000-0000-0000-0000-00000000000b'
             from public.appointments where client_request_id = '10000000-0000-0000-0000-000000000001'),
            'naam maker blijft historisch bewaard, gekoppeld aan vaste gebruikers-id');
reset role;

-- ---------------------------------------------------------------------------
-- Account uitschakelen: directe toegangsverlies, ook met nog geldige sessie
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
select public.admin_update_member('00000000-0000-0000-0000-00000000000c', p_active => false);
select t.login('00000000-0000-0000-0000-00000000000c');
select t.ok((select count(*) from public.appointments) = 0, 'uitgeschakeld account ziet geen afspraken meer');
select t.ok((select count(*) from public.customers) = 0, 'uitgeschakeld account ziet geen klanten meer');
select t.ok((select count(*) from public.profiles) = 1 and (select not active from public.profiles), 'uitgeschakeld account ziet alleen eigen (inactief) profiel');
select t.expect_error($$select public.save_appointment(t.appt(gen_random_uuid(), '2026-10-26 14:00', 60))$$, '%Geen toegang%', 'uitgeschakeld account kan niet boeken');
select t.expect_error($$select * from public.available_starts('2026-10-26', 60)$$, '%Geen toegang%', 'uitgeschakeld account kan beschikbaarheid niet opvragen');
select t.expect_error($$insert into public.customers (name) values ('Hacker')$$, '%row-level security%', 'uitgeschakeld account kan geen klant toevoegen');
update public.profiles set phone = '1' where id = auth.uid();
reset role;
select t.ok((select phone from public.profiles where id = '00000000-0000-0000-0000-00000000000c') is null, 'uitgeschakeld account kan profiel niet wijzigen');
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
select public.admin_update_member('00000000-0000-0000-0000-00000000000c', p_active => true);
select t.login('00000000-0000-0000-0000-00000000000c');
select t.ok((select count(*) from public.appointments) > 0, 'heractiveerd account heeft weer toegang');
reset role;


-- ---------------------------------------------------------------------------
-- Antwoorden 18-10: werkplek, korting, compleet-pakketten
-- ---------------------------------------------------------------------------
select t.ok((select count(*) = 1 from public.workstations where name = 'Binckhorst' and active), 'werkplek Binckhorst bestaat');
select t.ok((select active and requires_any_other and body_types is null and amount_cents = 1000 from public.discount_rules where name = 'Combinatiekorting voorportieren'),
            'combinatiekorting €10 actief bij elke combinatie');
select t.ok((select count(*) = 8 from public.bundles where name like 'Compleet %' and active and duration_min = 150), '8 compleet-pakketten actief (150 min)');
select t.ok((select price_cents = 29000 from public.bundles where name = 'Compleet hatchback met kameleon voorruit'), 'compleet hatchback kameleon €290');
select t.ok((select price_cents = 28000 from public.bundles where name = 'Compleet hatchback met zwarte voorruit'), 'compleet hatchback zwart €280');
select t.ok((select price_cents = 32000 from public.bundles where name = 'Compleet sedan met kameleon voorruit'), 'compleet sedan kameleon €320');
select t.ok((select price_cents = 30000 from public.bundles where name = 'Compleet sedan met zwarte voorruit'), 'compleet sedan zwart €300');
select t.ok((select bool_and(price_cents = 33000 and rear_window_count = 7) from public.bundles where name like 'Compleet station (7 ramen)%'), 'compleet station 7 ramen €330');
select t.ok((select bool_and(price_cents = 30000 and rear_window_count = 5) from public.bundles where name like 'Compleet station (5 ramen)%'), 'compleet station 5 ramen €300');
select t.ok((select not active from public.services where code = 'complete_auto'), 'losse dienst "complete auto" vervangen door pakketten');
select t.ok((select count(*) = 12 from public.recurring_breaks where active and weekday between 1 and 6)
            and not exists (select 1 from public.recurring_breaks where active and (weekday is null or weekday = 7)),
            'pauzes alleen maandag t/m zaterdag');

-- ---------------------------------------------------------------------------
-- Gebruikersnaam
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
select public.admin_update_member('00000000-0000-0000-0000-00000000000a', p_username => 'BlindeerReus');
select public.admin_update_member('00000000-0000-0000-0000-00000000000b', p_username => 'ProTintMaster');
select t.expect_error($$select public.admin_update_member('00000000-0000-0000-0000-00000000000c', p_username => 'blindeerreus')$$,
                      '%al in gebruik%', 'gebruikersnaam is uniek (hoofdletterongevoelig)');
select t.expect_error($$select public.admin_update_member('00000000-0000-0000-0000-00000000000c', p_username => 'met spatie')$$,
                      '%Gebruikersnaam%', 'ongeldige gebruikersnaam geweigerd');
select t.login('00000000-0000-0000-0000-00000000000b');
select t.expect_error($$update public.profiles set username = 'Baas' where id = auth.uid()$$, '%permission denied%', 'collega kan eigen gebruikersnaam niet zelf wijzigen');
reset role;
set role anon;
select t.ok(public.login_email_for('blindeerreus') = 'eigenaar@test.invalid', 'inloggen met gebruikersnaam (hoofdletterongevoelig) vindt het account');
select t.ok(public.login_email_for('  ProTintMaster ') = 'collega1@test.invalid', 'spaties rond gebruikersnaam genegeerd');
select t.ok(public.login_email_for('bestaatniet') is null, 'onbekende gebruikersnaam geeft niets');
reset role;
update public.profiles set active = false where username = 'ProTintMaster';
set role anon;
select t.ok(public.login_email_for('ProTintMaster') is null, 'uitgeschakeld account niet te vinden via gebruikersnaam');
reset role;
update public.profiles set active = true where username = 'ProTintMaster';
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000000d', 'nieuw@test.invalid', '{"display_name":"Nieuw"}', '{"role":"colleague","username":"Nieuweling"}');
select t.ok((select username = 'Nieuweling' from public.profiles where id = '00000000-0000-0000-0000-00000000000d'), 'gebruikersnaam uit app_metadata bij aanmaken account');

-- ---------------------------------------------------------------------------
-- Overzicht / statistieken
-- ---------------------------------------------------------------------------
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');
create temp table s as select public.appointment_stats(null, null, 'month') v;
select t.ok((select (v ->> 'planned')::int = (select count(*) from public.appointments where status in ('ingepland','bezig','afgerond'))
                and (v ->> 'cancelled')::int = (select count(*) from public.appointments where status = 'geannuleerd')
                and (v ->> 'completed')::int = (select count(*) from public.appointments where status = 'afgerond') from s),
            'overzicht alle tijd: aantallen kloppen met de afspraken');
select t.ok((select (v ->> 'revenue_planned_cents')::bigint = (select coalesce(sum(price_total_cents),0) from public.appointments
                where status in ('ingepland','bezig','afgerond') and price_complete) from s), 'overzicht: geplande omzet klopt');
select t.ok((select (select sum((b ->> 'planned')::int) from jsonb_array_elements(v -> 'buckets') b) = (v ->> 'planned')::int from s),
            'overzicht: som van de maanden = totaal');
select t.ok((select jsonb_array_length(v -> 'buckets') = 3 and v -> 'buckets' -> 0 ->> 'start' = '2026-10-01' from s),
            'overzicht per maand: okt t/m dec 2026 (lege maanden inbegrepen)');
create temp table w as select public.appointment_stats('2026-10-19 00:00 Europe/Amsterdam', '2026-10-26 00:00 Europe/Amsterdam', 'day') v;
select t.ok((select jsonb_array_length(v -> 'buckets') = 7 and v -> 'buckets' -> 0 ->> 'start' = '2026-10-19'
                    and (v ->> 'planned')::int = (select count(*) from public.appointments where status in ('ingepland','bezig','afgerond')
                         and starts_at >= '2026-10-19 00:00 Europe/Amsterdam' and starts_at < '2026-10-26 00:00 Europe/Amsterdam') from w),
            'overzicht week (ma–zo, 7 dagen, ook over wintertijdgrens)');
select t.ok((select (v ->> 'planned')::int >= 0 from (select public.appointment_stats(null, null, 'year', p_unassigned => true) v) x), 'overzicht filter niet toegewezen');
reset role;
update public.profiles set active = false where id = '00000000-0000-0000-0000-00000000000c';
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000c');
select t.expect_error($$select public.appointment_stats()$$, '%Geen toegang%', 'uitgeschakeld account kan overzicht niet zien');
reset role;
set role anon;
select t.expect_error($$select public.appointment_stats()$$, '%permission denied%', 'anoniem geen overzicht');
reset role;
update public.profiles set active = true where id = '00000000-0000-0000-0000-00000000000c';

\echo 'db_tests.sql: alle tests geslaagd'
