#!/usr/bin/env bash
# Start een lokale mini-Supabase (Auth/GoTrue + PostgREST + Edge Function + mail-opvang) voor end-to-end tests.
# Vereist: PostgreSQL (lokaal, superuser via `sudo -u postgres` of PGUSER), Node, Deno (npx deno), Python 3,
# en in $BIN_DIR: `auth/auth` (Supabase Auth release) en `postgrest`.
# Gebruik: BIN_DIR=/pad/naar/binaries ./start_stack.sh   (stoppen: ./stop_stack.sh)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"   # supabase/
RUN="${RUN_DIR:-$HERE/.run}"
DB="${E2E_DB:-blindeer_e2e}"
BIN_DIR="${BIN_DIR:?zet BIN_DIR}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres)
export PGPASSWORD="${PGPASSWORD:-postgres}"
mkdir -p "$RUN"; : > "$RUN/mails.jsonl"

JWT_SECRET="e2e-super-secret-jwt-token-with-at-least-32-characters"
sign() { node -e '
const c=require("crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({role:process.argv[1],iss:"supabase",iat:1700000000,exp:2000000000});
process.stdout.write(h+"."+p+"."+c.createHmac("sha256",process.argv[2]).update(h+"."+p).digest("base64url"))' "$1" "$JWT_SECRET"; }
ANON_KEY="$(sign anon)"; SERVICE_KEY="$(sign service_role)"
cat > "$RUN/env" <<ENV
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
MAIL_LOG=$RUN/mails.jsonl
DB=$DB
ENV

"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
"${PSQL[@]}" -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'authpw'; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login createrole password 'authpw'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
alter role supabase_auth_admin set search_path = auth;
create schema auth authorization supabase_auth_admin;
grant create on database blindeer_e2e to supabase_auth_admin;
SQL

MAIL_LOG="$RUN/mails.jsonl" python3 "$HERE/mailsink.py" > "$RUN/mailsink.log" 2>&1 & echo $! > "$RUN/mailsink.pid"
TEMPLATES_DIR="$ROOT/templates" node "$HERE/gateway.mjs" > "$RUN/gateway.log" 2>&1 & echo $! > "$RUN/gateway.pid"
sleep 1

T="http://127.0.0.1:54321/templates"
env -i PATH="$PATH" \
  API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
  GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:authpw@127.0.0.1:5432/$DB?sslmode=disable" \
  GOTRUE_DB_MIGRATIONS_PATH="$BIN_DIR/auth/migrations" \
  GOTRUE_SITE_URL=blindeergo://auth GOTRUE_URI_ALLOW_LIST="blindeergo://**" \
  GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED=true \
  GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=true \
  GOTRUE_PASSWORD_MIN_LENGTH=10 \
  GOTRUE_MAILER_OTP_LENGTH=6 GOTRUE_MAILER_OTP_EXP=3600 \
  GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=2500 GOTRUE_SMTP_ADMIN_EMAIL=planning@test.invalid \
  GOTRUE_SMTP_SENDER_NAME="Blindeer & Go Planning" GOTRUE_SMTP_MAX_FREQUENCY=1s \
  GOTRUE_RATE_LIMIT_EMAIL_SENT=10000 GOTRUE_RATE_LIMIT_VERIFY=10000 GOTRUE_RATE_LIMIT_TOKEN_REFRESH=10000 GOTRUE_RATE_LIMIT_OTP=10000 \
  GOTRUE_MAILER_TEMPLATES_INVITE="$T/invite.html" GOTRUE_MAILER_TEMPLATES_RECOVERY="$T/recovery.html" \
  GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE="$T/email_change.html" GOTRUE_MAILER_TEMPLATES_REAUTHENTICATION="$T/reauthentication.html" \
  GOTRUE_MAILER_TEMPLATES_MAGIC_LINK="$T/magic_link.html" \
  GOTRUE_MAILER_SUBJECTS_INVITE="Uitnodiging Blindeer & Go Planning" GOTRUE_MAILER_SUBJECTS_RECOVERY="Wachtwoord herstellen" \
  GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE="Bevestig je nieuwe e-mailadres" GOTRUE_MAILER_SUBJECTS_REAUTHENTICATION="Bevestigingscode" \
  GOTRUE_LOG_LEVEL=info \
  "$BIN_DIR/auth/auth" > "$RUN/gotrue.log" 2>&1 & echo $! > "$RUN/gotrue.pid"

for i in $(seq 1 60); do curl -sf http://127.0.0.1:9999/health >/dev/null && break; sleep 0.5; done
curl -sf http://127.0.0.1:9999/health >/dev/null || { echo "GoTrue start niet"; tail -30 "$RUN/gotrue.log"; exit 1; }

# Supabase-standaardrechten, daarna de eigen migraties
"${PSQL[@]}" -d "$DB" <<'SQL'
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
for f in "$ROOT"/migrations/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null; done
"${PSQL[@]}" -d "$DB" -c "notify pgrst, 'reload schema'"

cat > "$RUN/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authpw@127.0.0.1:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3000
CONF
"$BIN_DIR/postgrest" "$RUN/postgrest.conf" > "$RUN/postgrest.log" 2>&1 & echo $! > "$RUN/postgrest.pid"

( cd "$ROOT/functions/admin-users" && SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" \
  npx --yes deno run --allow-net --allow-env --allow-read index.ts > "$RUN/function.log" 2>&1 & echo $! > "$RUN/function.pid" )

for i in $(seq 1 60); do curl -sf http://127.0.0.1:3000/ >/dev/null && break; sleep 0.5; done
for i in $(seq 1 120); do curl -s -o /dev/null http://127.0.0.1:8000/ && break; sleep 0.5; done
echo "stack draait (gegevens in $RUN/env)"
