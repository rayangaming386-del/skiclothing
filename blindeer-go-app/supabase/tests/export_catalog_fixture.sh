#!/usr/bin/env bash
# Exporteert de catalogus uit de testdatabase (na migraties) naar een JSON-fixture voor de prijs-unit-tests,
# zodat de tests exact de startgegevens uit de migratie gebruiken.
set -euo pipefail
DB="${TEST_DB:-blindeer_test}"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/src/lib/__tests__/catalog.fixture.json"
psql -X -At -d "$DB" -c "
select jsonb_pretty(jsonb_build_object(
  'services', (select jsonb_agg(to_jsonb(s) order by s.sort_order) from public.services s),
  'prices', (select jsonb_agg(to_jsonb(p) order by p.service_id, p.sort_order) from public.service_prices p),
  'exceptions', (select jsonb_agg(to_jsonb(e) order by e.label) from public.model_exceptions e),
  'bundles', (select jsonb_agg(to_jsonb(b) order by b.name) from public.bundles b),
  'discounts', (select jsonb_agg(to_jsonb(d) order by d.name) from public.discount_rules d),
  'hints', (select jsonb_agg(to_jsonb(h) order by h.make, h.model) from public.vehicle_model_hints h)
))" > "$OUT"
echo "geschreven: $OUT"
