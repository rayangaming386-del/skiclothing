#!/usr/bin/env bash
# Voert alle migraties uit op een lege lokale PostgreSQL-database en draait de tests.
# Gebruik: PGUSER=postgres ./supabase/tests/run_db_tests.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DB:-blindeer_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
dropdb --if-exists "$DB"
createdb "$DB"
"${PSQL[@]}" -d "$DB" -f "$DIR/tests/supabase_stubs.sql"
for f in "$DIR"/migrations/*.sql; do
  echo "migratie: $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done
"${PSQL[@]}" -d "$DB" -f "$DIR/tests/db_tests.sql"
if [ "${SKIP_CONCURRENCY:-0}" != "1" ]; then
  "$DIR/tests/concurrency_test.sh" "$DB"
fi
echo "ALLE DATABASETESTS GESLAAGD"
