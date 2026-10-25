#!/bin/bash
# ---------------------------------------------------------------
# Sicherung der Prod-Datenbank vor einer Migration (pg_dump, Schema public = App-Daten).
#   bash scripts/backup-prod.sh   → .backups/prod-JJJJ-MM-TT-HHMM.dump (gitignored)
# Gibt keine Zugangsdaten und keine Inhalte aus, nur Dateiname und Größe. Das Passwort geht über
# PGPASSWORD an pg_dump, nie in die Befehlszeile (sonst per `ps` lesbar).
# Wiederherstellen (nur nach Rücksprache mit dem Nutzer): NIE `pg_restore --clean` – der Dump ist
# ohne Rechte (--no-privileges), danach fehlten alle Grants und die App meldete „permission
# denied“. Stattdessen nur die Daten in das per Migrationen angelegte Schema, in einer
# Transaktion: README › Sichern und Export › Wiederherstellen (scripts/backup-restore.mts, dort
# `pg_restore --data-only` + Zeilenprüfung).
# ---------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

PG_DUMP="$(command -v pg_dump || echo /opt/homebrew/opt/libpq/bin/pg_dump)"
[ -x "$PG_DUMP" ] || { echo "✗ pg_dump fehlt (brew install libpq)"; exit 1; }

DB="$(grep -E '^SUPABASE_DB_URL=' .env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
[ -n "$DB" ] || { echo "✗ SUPABASE_DB_URL in .env.local ist leer."; exit 1; }

# Passwort aus der URL in PGPASSWORD, URL ohne Passwort (Werte nur über die Umgebung an node)
export PGPASSWORD="$(DB="$DB" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB).password))')"
DB_NOPW="$(DB="$DB" node -e 'const u = new URL(process.env.DB); u.password = ""; process.stdout.write(u.toString())')"

mkdir -p .backups
chmod 700 .backups
FILE=".backups/prod-$(date +%Y-%m-%d-%H%M).dump"
# nur die App-Daten (Schema public); Auth verwaltet Supabase selbst
"$PG_DUMP" --dbname="$DB_NOPW" --schema=public --format=custom --no-owner --no-privileges --file="$FILE" 2>&1 \
  | sed -E 's#postgres(ql)?://[^ ]*#<db-url>#g'
chmod 600 "$FILE"
echo "✓ Sicherung: $FILE ($(du -h "$FILE" | cut -f1))"
