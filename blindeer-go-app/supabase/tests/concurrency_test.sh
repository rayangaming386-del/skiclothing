#!/usr/bin/env bash
# Gelijktijdig boeken: 8 parallelle sessies proberen exact hetzelfde tijdslot te boeken
# (bedrijfscapaciteit 1). Precies één boeking mag slagen.
set -euo pipefail
DB="$1"
psql -X -q -d "$DB" -c "update public.company_settings set max_parallel_appointments = 1; update public.teams set max_parallel = null;"
OUT="$(mktemp -d)"
for i in $(seq 1 8); do
  uid="00000000-0000-0000-0000-00000000000$([ $((i % 2)) -eq 0 ] && echo b || echo c)"
  psql -X -q -d "$DB" -v ON_ERROR_STOP=1 > "$OUT/$i.log" 2>&1 <<SQL &
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"$uid"}', false);
begin;
select pg_sleep(0.2); -- zorg dat alle sessies tegelijk beginnen
select public.save_appointment(jsonb_build_object(
  'client_request_id', gen_random_uuid(), 'customer_name', 'Race $i',
  'starts_at', '2026-11-10 14:00 Europe/Amsterdam', 'duration_min', 60,
  'items', '[]'::jsonb));
select pg_sleep(0.3); -- houd de transactie even open
commit;
SQL
done
wait || true
ok=$(psql -X -At -d "$DB" -c "select count(*) from public.appointments where customer_name like 'Race %'")
fails=$( (grep -l "Capaciteit vol" "$OUT"/*.log || true) | wc -l)
echo "gelijktijdig boeken: $ok geslaagd, $fails geweigerd wegens capaciteit"
rm -rf "$OUT"
if [ "$ok" != "1" ] || [ "$fails" != "7" ]; then
  echo "TEST MISLUKT: gelijktijdig boeken"; exit 1
fi
echo "ok - gelijktijdig boeken: precies één boeking geaccepteerd"
