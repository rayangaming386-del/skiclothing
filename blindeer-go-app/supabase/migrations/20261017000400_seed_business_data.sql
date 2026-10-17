-- Startgegevens uit de briefing van Blindeer & Go (aanpasbaar via de beheeromgeving in de app).
-- Dit zijn echte bedrijfsinstellingen, géén demogegevens. Ontbrekende gegevens blijven leeg.
-- Punten die nog bevestigd moeten worden staan inactief of met een notitie "Te bevestigen".

insert into public.company_settings (
  id, company_name, former_name, activity, address_line, postal_code, city, directions, phone,
  timezone, currency, slot_interval_min, default_buffer_min, buffer_must_fit_before_close,
  breaks_block_appointments, max_parallel_appointments
) values (
  1, 'Blindeer & Go', 'Blindeer Reus',
  'Autoruiten tinten/blinderen en aanverwante foliewerkzaamheden',
  'Binckhorstlaan 293c', '2516 BC', 'Den Haag',
  'Eerste etage, via de oprit naar boven rijden.',
  '06 47 47 47 75',
  'Europe/Amsterdam', 'EUR', 15, 15, false, true, 1
);

insert into public.teams (name, color, sort_order) values
  ('Blindeer & Go', '#3B82F6', 1),
  ('Pro TintMaster', '#F59E0B', 2),
  ('TintserviceNL', '#D946EF', 3);

insert into public.opening_hours (weekday, is_closed, open_time, close_time) values
  (1, false, '10:00', '22:00'),
  (2, false, '10:00', '22:00'),
  (3, false, '10:00', '22:00'),
  (4, false, '10:00', '22:00'),
  (5, false, '10:00', '22:00'),
  (6, false, '10:00', '22:00'),
  (7, false, '12:00', '20:00');

-- Te bevestigen: geldt de pauze 12:00–13:00 ook op zondag? Nu wel (eerste start zondag dus 13:00).
insert into public.recurring_breaks (weekday, start_time, end_time, label) values
  (null, '12:00', '13:00', 'Pauze'),
  (null, '16:00', '17:00', 'Pauze');

-- ---------------------------------------------------------------------------
-- Diensten
-- ---------------------------------------------------------------------------
insert into public.services (code, name, sort_order, is_windshield, price_on_sight, film_kind, film_brands, film_percentages, film_colors, notes) values
  ('bstijl', 'Blinderen vanaf de B-stijl', 10, false, false, null, '{SunTek,3M}', null, null,
   'Ramen moeten vrij zijn van oude folie en lijmresten. Controleer welke percentages per raam beschikbaar zijn.'),
  ('voorportieren', 'Voorportieren tinten', 20, false, false, null, '{SunTek,3M}', null, null,
   'Controleer welke percentages beschikbaar zijn.'),
  ('kameleon_voorruit', 'Kameleonfolie op de voorruit', 30, true, false, 'kameleon', null, '{}', '{Blauw,Rood,Groen,Paars}', null),
  ('keramisch_voorruit', 'Zwarte keramische folie op de voorruit', 40, true, false, 'keramisch', null, null, null,
   'Onder andere 60% genoemd. Behandelduur nog niet vastgelegd.'),
  ('complete_auto', 'Complete auto tinten', 50, false, false, null, '{SunTek,3M}', null, null,
   'Te bevestigen: exacte samenstelling en prijs. Prijs nog te bepalen.'),
  ('panoramadak', 'Panoramadak / glazen dak', 60, false, true, null, '{SunTek,3M}', null, null,
   'Normaal prijs op zicht, behalve bij een expliciet ingesteld pakket.'),
  ('achterlichten', 'Achterlichten smoken', 70, false, false, null, null, '{}', null,
   'Nog geen vaste prijs of tijd vastgelegd.');

-- Prijsregels (meest specifieke passende regel wint)
insert into public.service_prices (service_id, label, body_type, passenger_car_only, high_entry, door_count, rear_window_count, front_window_count, price_cents, duration_min, sort_order)
select s.id, v.label, v.body_type::public.body_type, v.pco, v.he, v.doors, v.rear, v.front, v.price, v.dur, v.ord
from public.services s
join (values
  ('bstijl', 'Hatchback, standaard vijf achterramen', 'hatchback', false, null::boolean, null::smallint, 5::smallint, null::smallint, 12000, 60, 1),
  ('bstijl', 'Hatchback, driedeurs met drie achterramen', 'hatchback', false, null, 3::smallint, 3::smallint, null, 8000, 60, 2),
  ('bstijl', 'Hatchback, vijfdeurs met drie achterramen', 'hatchback', false, null, 5::smallint, 3::smallint, null, 9000, 60, 3),
  ('bstijl', 'Station, vijf achterramen', 'station', false, null, null, 5::smallint, null, 13000, 60, 4),
  ('bstijl', 'Station, zeven achterramen', 'station', false, null, null, 7::smallint, null, 15000, 60, 5),
  ('bstijl', 'Sedan, vijf achterramen', 'sedan', false, null, null, 5::smallint, null, 14000, 60, 6),
  ('bstijl', 'Coupé, drie achterramen', 'coupe', false, null, null, 3::smallint, null, 12000, 60, 7),
  ('bstijl', 'SUV, vijf achterramen', 'suv', false, null, null, 5::smallint, null, 13000, 60, 8),
  ('bstijl', 'SUV, zeven achterramen', 'suv', false, null, null, 7::smallint, null, 15000, 60, 9),
  ('bstijl', 'Bus, drie achterramen', 'bus', false, null, null, 3::smallint, null, 11000, 60, 10),
  ('bstijl', 'Bus, vijf achterramen', 'bus', false, null, null, 5::smallint, null, 15000, 60, 11),
  ('voorportieren', 'Personenauto', null, true, null, null, null, null, 7000, 45, 1),
  ('voorportieren', 'Bus, standaardvariant', 'bus', false, null, null, null, null, 8000, 45, 2),
  ('voorportieren', 'Bus, vier ramen', 'bus', false, null, null, null, 4::smallint, 9000, 45, 3),
  ('kameleon_voorruit', 'Personenauto / lage SUV', null, false, false, null, null, null, 13000, 60, 1),
  ('kameleon_voorruit', 'Hoge instap / grote SUV / bus', null, false, true, null, null, null, 15000, 60, 2),
  ('keramisch_voorruit', 'Personenauto / lage SUV', null, false, false, null, null, null, 12000, null, 1),
  ('keramisch_voorruit', 'Hoge instap / grote SUV / bus', null, false, true, null, null, null, 14000, null, 2),
  ('complete_auto', 'Complete auto', null, false, null, null, null, null, null, 150, 1)
) as v(code, label, body_type, pco, he, doors, rear, front, price, dur, ord) on v.code = s.code;

-- Modeluitzonderingen: vervangen de basisprijs/-duur (niet optellen).
insert into public.model_exceptions (label, service_id, make, match_terms, body_type, year_from, year_to, price_cents, duration_min, active, notes)
select v.label, s.id, v.make, v.terms, v.body::public.body_type, v.yf, v.yt, v.price, v.dur, v.active, v.notes
from public.services s
join (values
  ('Volkswagen Golf 5, B-stijl', 'bstijl', 'Volkswagen', '{golf 5,golf v,golf mk5}'::text[], null, null::int, null::int, 15000, 90, true, null),
  ('Volkswagen Golf 6, B-stijl', 'bstijl', 'Volkswagen', '{golf 6,golf vi,golf mk6}'::text[], null, null, null, 15000, 90, true, null),
  ('Nissan Micra 2003, B-stijl', 'bstijl', 'Nissan', '{micra}'::text[], null, 2003, 2003, 15000, 90, true, null),
  ('Peugeot 307 station, B-stijl', 'bstijl', 'Peugeot', '{307}'::text[], 'station', null, null, 25000, 120, true, null),
  ('Tesla Model 3, achterruit/sedanvariant', 'bstijl', 'Tesla', '{model 3}'::text[], null, null, null, 14000, null, false,
   'Te bevestigen: exacte ramen van dit pakket.')
) as v(label, code, make, terms, body, yf, yt, price, dur, active, notes) on v.code = s.code;

insert into public.bundles (name, service_ids, make, match_terms, price_cents, duration_min, active, notes) values
  ('Standaard B-stijl + kameleon voorruit',
   array[(select id from public.services where code = 'bstijl'), (select id from public.services where code = 'kameleon_voorruit')],
   null, '{}', null, 120, true,
   'Alleen de duur is als pakket vastgelegd; prijs = som van de onderdelen. Geldt niet bij een modeluitzondering.'),
  ('Tesla Model 3, volledig glazen dak plus achterramen/B-stijl',
   array[(select id from public.services where code = 'bstijl'), (select id from public.services where code = 'panoramadak')],
   'Tesla', '{model 3}', 35000, 180, false,
   'Te bevestigen: exacte ramen van dit pakket. Totaalprijs €350.');

insert into public.discount_rules (name, target_service_id, required_any_service_ids, body_types, amount_cents, active, notes) values
  ('Combinatiekorting voorportieren',
   (select id from public.services where code = 'voorportieren'),
   array[(select id from public.services where code = 'bstijl'),
         (select id from public.services where code = 'kameleon_voorruit'),
         (select id from public.services where code = 'keramisch_voorruit')],
   '{hatchback,station,sedan,coupe,suv}', 1000, false,
   'Te bevestigen: voor welke combinaties en busvarianten geldt deze korting? Staat uit tot bevestiging.');

insert into public.vehicle_model_hints (make, model, high_entry, notes) values
  ('BMW', 'X3', true, 'Grote SUV'),
  ('Audi', 'Q7', true, 'Grote SUV'),
  ('Volkswagen', 'T-Roc', false, null),
  ('Audi', 'Q2', false, null),
  ('Nissan', 'Juke', false, null);
