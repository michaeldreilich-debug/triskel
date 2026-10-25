#!/bin/bash
# ---------------------------------------------------------------
# Nächtliche Sicherung (E32) auf dem Mac ein- oder ausschalten (launchd, nur für diesen Nutzer).
#   bash scripts/backup-install.sh            → Job „com.triskel.schaltzentrale-backup“ anlegen
#   bash scripts/backup-install.sh --entfernen → Job entfernen (Sicherungen bleiben liegen)
#   bash scripts/backup-install.sh --status    → läuft der Job? letzter Lauf?
#   bash scripts/backup-install.sh --pruefen   → plist nur erzeugen und prüfen (lädt nichts)
# Der Job startet stündlich um :07 `node scripts/backup-nightly.mts prod --nachts`; das Skript
# sichert nur, wenn seit der letzten Nachtgrenze (02:00) noch keine Sicherung geklappt hat. Hat
# der Mac geschlafen, holt launchd den Aufruf beim Aufwachen nach.
# Gibt keine Zugangsdaten aus.
# ---------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

LABEL="com.triskel.schaltzentrale-backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
LOGDIR="$REPO/.backups/nachts/prod"
DOMAIN="gui/$(id -u)"

status() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    echo "✓ Job $LABEL ist geladen."
  else
    echo "– Job $LABEL ist nicht geladen."
  fi
  if [ -f "$LOGDIR/zustand.json" ]; then
    echo "  Zustand: $(tr -d '\n' < "$LOGDIR/zustand.json" | tr -s ' ')"
  fi
  [ -f "$LOGDIR/lauf.log" ] && { echo "  Letzte Zeilen aus lauf.log:"; tail -5 "$LOGDIR/lauf.log" | sed 's/^/    /'; }
  return 0
}

case "${1:-}" in
  --status)
    status
    exit 0
    ;;
  --entfernen)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✓ Job entfernt. Die Sicherungen in .backups/nachts/ und auf Drive bleiben."
    exit 0
    ;;
  --pruefen)
    PLIST="$(mktemp -d)/$LABEL.plist"
    CHECK_ONLY=1
    ;;
  "") ;;
  *)
    echo "Aufruf: bash scripts/backup-install.sh [--status|--entfernen|--pruefen]"
    exit 2
    ;;
esac

[ -x "$NODE" ] || { echo "✗ node fehlt"; exit 1; }
for var in SUPABASE_DB_URL; do
  if ! grep -qE "^$var=.+" .env.local; then
    echo "✗ $var fehlt in .env.local (siehe .env.example)"
    [ "${CHECK_ONLY:-}" = "1" ] || exit 1
  fi
done
# Dateien kommen aus R2 (E41); der Supabase-S3-Schlüssel ist nur noch Übergang
for var in R2_ACCOUNT_ID R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY; do
  grep -qE "^$var=.+" .env.local || echo "! $var fehlt in .env.local – Dateien kommen dann nur aus dem Supabase-Storage"
done
rclone listremotes 2>/dev/null | grep -q '^gdrive:$' || { echo "✗ rclone-Verbindung gdrive: fehlt"; exit 1; }

mkdir -p "$LOGDIR" "$(dirname "$PLIST")"
chmod 700 "$REPO/.backups" "$REPO/.backups/nachts" "$LOGDIR"

# stündlich um :07 (00:07 … 23:07) – das Skript entscheidet, ob etwas fällig ist
INTERVALS=""
for hour in $(seq 0 23); do
  INTERVALS+="        <dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>7</integer></dict>
"
done

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Angelegt von $REPO/scripts/backup-install.sh – nicht von Hand ändern -->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE</string>
        <string>$REPO/scripts/backup-nightly.mts</string>
        <string>prod</string>
        <string>--nachts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>StartCalendarInterval</key>
    <array>
$INTERVALS    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>LowPriorityIO</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOGDIR/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>$LOGDIR/launchd.log</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null
if [ "${CHECK_ONLY:-}" = "1" ]; then
  echo "✓ plist geprüft (nicht geladen): $PLIST"
  exit 0
fi

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "✓ Job $LABEL angelegt: stündlich um :07, sichert einmal je Nacht (ab 02:00)."
echo "  Sofort einmal sichern: node scripts/backup-nightly.mts prod --jetzt"
status
