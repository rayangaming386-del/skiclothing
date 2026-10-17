#!/usr/bin/env bash
# Extra back-up van de planningsdatabase (naast de dagelijkse back-ups van Supabase Pro).
# Gebruik: SUPABASE_DB_URL="postgresql://postgres.<ref>:<wachtwoord>@<host>:5432/postgres" ./scripts/backup.sh
# De verbindingsgegevens staan in Supabase → Project Settings → Database. Bewaar het bestand op een veilige,
# versleutelde plek: het bevat klantgegevens.
set -euo pipefail
: "${SUPABASE_DB_URL:?zet SUPABASE_DB_URL}"
OUT="backup-blindeer-go-$(date +%Y%m%d-%H%M).dump"
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --schema=public --schema=auth --file="$OUT"
echo "Back-up geschreven naar $OUT"
echo "Terugzetten (naar een LEGE database): pg_restore --no-owner --dbname=\"\$DOEL_DB_URL\" $OUT"
