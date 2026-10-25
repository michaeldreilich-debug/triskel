#!/bin/bash
# ---------------------------------------------------------------
# Vorab-Check vor einem (autonomen) Lauf: Sind beide Supabase-Projekte
# erreichbar, Zugangsdaten vollständig, Testnutzer anmeldbar, DB-Verbindung ok?
# Liest .env.local (Prod) und .env.test.local (Test). Gibt NIE Geheimnisse aus.
# Ändert nichts (nur lesende Abfragen, Migrations-Check als --dry-run).
# Aufruf:  bash scripts/preflight.sh
# ---------------------------------------------------------------
set -u
cd "$(dirname "$0")/.." || exit 1

FAIL=0
ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
bad()  { echo "  ✗ $*"; FAIL=1; }

# Wert aus einer env-Datei lesen, ohne sie auszuführen
val() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

host_of() { echo "$1" | sed -E 's#^[a-z]+://[^@]*@##; s#[:/].*$##'; }

# Migrationsstand gegen den echten Ordner supabase/migrations prüfen (seit B1 liegen 01–09 in
# beiden Projekten; ein leerer Ordner meldete dann fälschlich einen Verbindungsfehler)
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

check_project() {
  local file="$1" label="$2"
  echo "== $label ($file)"
  if [ ! -f "$file" ]; then bad "Datei fehlt"; return; fi

  local url key db
  url="$(val "$file" NEXT_PUBLIC_SUPABASE_URL)"
  key="$(val "$file" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
  db="$(val "$file" SUPABASE_DB_URL)"
  [ -n "$url" ] && ok "URL gesetzt" || bad "NEXT_PUBLIC_SUPABASE_URL leer"
  [ -n "$key" ] && ok "Publishable Key gesetzt" || bad "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY leer"
  [ -n "$db" ]  && ok "DB-URL gesetzt" || bad "SUPABASE_DB_URL leer"
  [ -z "$url" ] || [ -z "$key" ] && return

  # Auth-Einstellungen (öffentlicher Endpunkt)
  local settings code
  settings="$(curl -s -w '\n%{http_code}' -H "apikey: $key" "$url/auth/v1/settings")"
  code="$(echo "$settings" | tail -1)"
  if [ "$code" = "200" ]; then
    ok "Projekt erreichbar, Key gültig"
    local signup
    signup="$(echo "$settings" | sed '$d' | jq -r '.disable_signup')"
    echo "    Registrierung gesperrt: $signup"
    eval "${label}_SIGNUP_DISABLED=$signup"
  else
    bad "Auth-Settings HTTP $code (URL oder Key falsch?)"
  fi

  # Datenbank-Verbindung (ändert nichts)
  if [ -n "$db" ]; then
    local h; h="$(host_of "$db")"
    case "$h" in
      *pooler.supabase.com) ok "Session-Pooler-Host ($h)";;
      db.*.supabase.co)     warn "Direktverbindung ($h) – im Gratis-Tarif nur IPv6, besser Session Pooler";;
      *)                    warn "Unbekannter DB-Host ($h)";;
    esac
    case "$h" in *eu-*) ok "Region EU";; *) warn "Region im Host nicht als EU erkennbar";; esac
    local out
    # Passwort über PGPASSWORD statt in der Befehlszeile (T-9)
    local pw nopw
    pw="$(DB="$db" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB).password))')"
    nopw="$(DB="$db" node -e 'const u = new URL(process.env.DB); u.password = ""; process.stdout.write(u.toString())')"
    out="$(PGPASSWORD="$pw" npx -y supabase@2.120.0 --workdir "$REPO_DIR" db push --db-url "$nopw" --dry-run 2>&1)"
    if [ $? -eq 0 ]; then
      if echo "$out" | grep -qi "up to date"; then ok "DB-Verbindung ok, Migrationen aktuell (dry-run)"
      else warn "DB-Verbindung ok, Migrationen ausstehend: $(echo "$out" | grep -oE '[0-9]{14}_[A-Za-z0-9_]+\.sql' | tr '\n' ' ')"
      fi
    else bad "DB-Verbindung fehlgeschlagen: $( (echo "$out" | grep -o '"message":"[^"]*"' || echo "$out" | grep -i -E 'error|failed') | sed -E 's#postgres(ql)?://[^ ]*#<db-url>#g' | head -1)"
    fi
  fi
}

login_test_user() {
  local file="$1" which="$2" url key email pw
  url="$(val "$file" NEXT_PUBLIC_SUPABASE_URL)"; key="$(val "$file" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
  email="$(val "$file" "E2E_USER_${which}_EMAIL")"; pw="$(val "$file" "E2E_USER_${which}_PASSWORD")"
  if [ -z "$email" ] || [ -z "$pw" ]; then bad "Testnutzer $which: E-Mail/Passwort leer"; return; fi
  local body resp code
  body="$(jq -n --arg e "$email" --arg p "$pw" '{email:$e,password:$p}')"
  resp="$(curl -s -w '\n%{http_code}' -X POST -H "apikey: $key" -H 'Content-Type: application/json' \
          -d "$body" "$url/auth/v1/token?grant_type=password")"
  code="$(echo "$resp" | tail -1)"
  if [ "$code" = "200" ]; then
    ok "Testnutzer $which kann sich anmelden"
    eval "USER_${which}_ID=$(echo "$resp" | sed '$d' | jq -r '.user.id')"
  else
    bad "Testnutzer $which: HTTP $code ($(echo "$resp" | sed '$d' | jq -r '.error_code // .msg // .error // "?"'))"
  fi
}

check_project ".env.local" "PROD"
check_project ".env.test.local" "TEST"

echo "== Testnutzer (TEST)"
USER_A_ID=""; USER_B_ID=""
login_test_user ".env.test.local" A
login_test_user ".env.test.local" B
if [ -n "$USER_A_ID" ] && [ -n "$USER_B_ID" ]; then
  [ "$USER_A_ID" != "$USER_B_ID" ] && ok "A und B sind verschiedene Nutzer" || bad "A und B sind derselbe Nutzer"
fi

echo "== Trennung Prod/Test"
P_URL="$(val .env.local NEXT_PUBLIC_SUPABASE_URL)"; T_URL="$(val .env.test.local NEXT_PUBLIC_SUPABASE_URL)"
if [ -n "$P_URL" ] && [ -n "$T_URL" ]; then
  [ "$P_URL" != "$T_URL" ] && ok "Prod- und Test-URL unterscheiden sich" || bad "Prod- und Test-URL sind gleich!"
fi
[ "${TEST_SIGNUP_DISABLED:-}" = "true" ] && ok "Test: Registrierung gesperrt"
[ "${TEST_SIGNUP_DISABLED:-}" = "false" ] && warn "Test: Registrierung ist offen (empfohlen: sperren)"
# Das eigene Konto ist angelegt – Prod bleibt gesperrt (Single-User)
[ "${PROD_SIGNUP_DISABLED:-}" = "true" ] && ok "Prod: Registrierung gesperrt"
[ "${PROD_SIGNUP_DISABLED:-}" = "false" ] && warn "Prod: Registrierung ist offen (empfohlen: sperren)"

echo "== Git/GitHub"
git config --global --get-all credential.https://github.com.helper >/dev/null && ok "Git nutzt gh für GitHub (kein Passwort-Prompt)" || bad "Kein Credential-Helper für GitHub (gh auth setup-git)"

echo
[ $FAIL -eq 0 ] && echo "PREFLIGHT OK" || echo "PREFLIGHT MIT FEHLERN (siehe ✗)"
exit $FAIL
