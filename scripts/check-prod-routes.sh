#!/bin/bash
# ---------------------------------------------------------------
# Prüft einen Produktions-Build: Die Entwickler-Seiten /dev/* müssen 404 liefern,
# die Login-Seite muss erreichbar sein. Voraussetzung: `npm run build` ist gelaufen.
# Aufruf:  bash scripts/check-prod-routes.sh
# ---------------------------------------------------------------
set -u
cd "$(dirname "$0")/.." || exit 1

PORT=3199
NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="" \
  npx next start --port "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$PORT/login" && break
  sleep 1
done

FAIL=0
expect_status() {
  local path="$1" want="$2" got
  got="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$path")"
  if [ "$got" = "$want" ]; then echo "  ✓ $path → $got"; else echo "  ✗ $path → $got (erwartet $want)"; FAIL=1; fi
}

for path in $(cat scripts/prod-routes.txt 2>/dev/null); do
  expect_status "${path%%=*}" "${path##*=}"
done

[ $FAIL -eq 0 ] && echo "PROD-ROUTEN OK" || echo "PROD-ROUTEN MIT FEHLERN"
exit $FAIL
