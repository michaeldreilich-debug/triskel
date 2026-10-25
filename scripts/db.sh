#!/bin/bash
# ---------------------------------------------------------------
# Migrationen anwenden bzw. Typen erzeugen – immer mit expliziter DB-URL.
#   bash scripts/db.sh push test [--dry-run]   → .env.test.local (Testprojekt)
#   bash scripts/db.sh push prod [--dry-run]   → .env.local (Prod; erst nach grünen Tests im Testprojekt)
#   bash scripts/db.sh types                   → src/lib/supabase/database.types.ts (aus dem Testprojekt)
# Gibt keine Zugangsdaten aus. Reihenfolge laut Plan: erst test, Integrationstests grün, dann prod.
# ---------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

SUPABASE_CLI="npx -y supabase@2.120.0"

val() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
# Passwort nie in die Befehlszeile (per `ps` lesbar, T-9): die CLI nimmt es aus PGPASSWORD,
# die URL geht ohne Passwort hinein. Die Werte gehen nur über die Umgebung an node.
pw_of() { DB="$1" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB).password))'; }
nopw() { DB="$1" node -e 'const u = new URL(process.env.DB); u.password = ""; process.stdout.write(u.toString())'; }
ref_of_db() { echo "$1" | sed -nE 's#^postgres(ql)?://[^.:@/]+\.([a-z0-9]+)[:@].*#\2#p; s#.*@db\.([a-z0-9]+)\.supabase\.co.*#\1#p' | head -1; }

TEST_DB="$(val .env.test.local SUPABASE_DB_URL)"
PROD_DB="$(val .env.local SUPABASE_DB_URL)"

guard_test() {
  [ -n "$TEST_DB" ] || { echo "✗ SUPABASE_DB_URL in .env.test.local ist leer."; exit 1; }
  if [ -n "$PROD_DB" ]; then
    [ "$TEST_DB" != "$PROD_DB" ] || { echo "✗ Test-DB-URL ist die Prod-DB-URL."; exit 1; }
    local t p; t="$(ref_of_db "$TEST_DB")"; p="$(ref_of_db "$PROD_DB")"
    if [ -n "$t" ] && [ "$t" = "$p" ]; then echo "✗ Test-DB gehört zum Prod-Projekt."; exit 1; fi
  fi
}

case "${1:-} ${2:-}" in
  "push test")
    guard_test
    shift 2
    PGPASSWORD="$(pw_of "$TEST_DB")" $SUPABASE_CLI db push --db-url "$(nopw "$TEST_DB")" "$@"
    ;;
  "push prod")
    [ -n "$PROD_DB" ] || { echo "✗ SUPABASE_DB_URL in .env.local ist leer."; exit 1; }
    shift 2
    # Schutz gegen Aussperren (B16): Die MFA-Pflicht (Migration 13) erst, wenn jeder Nutzer einen
    # bestätigten TOTP-Faktor hat. Bewusst ohne Faktor einspielen: ALLOW_MFA_LOCKOUT=1 davor setzen.
    PROD_PW="$(pw_of "$PROD_DB")"; PROD_NOPW="$(nopw "$PROD_DB")"
    pending="$(PGPASSWORD="$PROD_PW" $SUPABASE_CLI db push --db-url "$PROD_NOPW" --dry-run 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<db-url>#g')"
    if echo "$pending" | grep -q "_13_mfa_enforce.sql" && [ "${ALLOW_MFA_LOCKOUT:-}" != "1" ]; then
      if ! node scripts/check-mfa.mjs prod; then
        echo "✗ Migration 13 (MFA-Pflicht) steht aus, aber nicht jeder Nutzer hat TOTP eingerichtet."
        echo "  Erst auf der Live-URL anmelden und den zweiten Faktor einrichten (README „Zweiter Faktor“)."
        exit 1
      fi
    fi
    PGPASSWORD="$PROD_PW" $SUPABASE_CLI db push --db-url "$PROD_NOPW" "$@"
    ;;
  "types "*)
    guard_test
    PGPASSWORD="$(pw_of "$TEST_DB")" $SUPABASE_CLI gen types typescript --db-url "$(nopw "$TEST_DB")" --schema public > src/lib/supabase/database.types.ts
    echo "✓ src/lib/supabase/database.types.ts erzeugt"
    ;;
  *)
    echo "Aufruf: bash scripts/db.sh push test|prod [--dry-run]  |  bash scripts/db.sh types"
    exit 2
    ;;
esac
