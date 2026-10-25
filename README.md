# Triskel

Persönliche Schaltzentrale für eine Person: Wissensspeicher, Projektsteuerung und Rückblicke.
Läuft im Browser und als App auf dem Home-Bildschirm des Handys.

> **Einmaliger Stand vom 25.10.2026 – wird nicht gepflegt.** Es gibt keine Updates und keinen
> Support, Issues und Pull Requests werden nicht beantwortet. Das Repo ist eine Kopie zum
> Anschauen und Selberbauen. Wer etwas ändern will, arbeitet in einer eigenen Kopie weiter.

## Was drin ist

- **Bereiche** (zum Start „Beruf“ und „Privat“) filtern die ganze App.
- **Projekte** mit Steckbrief, Ergebnis-Checkliste, nummerierten Meilensteinen (Fahrplan),
  nächstem Schritt und Abschluss-Ritual. Dazu ein Zeitstrahl über alle Projekte.
- **Aufgaben** mit Wiederholung, „Blockiert durch“, Checkliste, Notiz, Priorität und Fälligkeit.
  Ansichten als Liste, Tabelle und Board, gespeicherte Ansichten, Spalten per Ziehen.
- **Wissen:** Notizen als Gliederung (Outliner) mit `[[Verweisen]]`, Rückverweisen, `#tags`,
  Themen und Notiz-Typen. Bilder, PDFs, Dateien und Mermaid-Diagramme lassen sich einbetten.
- **Inbox** mit Schnellerfassung (`#bereich`, `@Projekt`, `#notiz`, ⌘K) und **Heute** mit Fokus,
  Fälligem, Tagesablauf und Abendplanung. Am Handy gibt es die Leiste unten mit ＋ „Festhalten“.
- **Woche/Kalender:** Google-Kalender lesen (geheime iCal-Adresse) oder bearbeiten (OAuth),
  Aufgaben per „Einplanen“ in die Woche ziehen, Termine mit Notizen verknüpfen.
- **Rückblicke** für Woche und Monat mit Leitfragen, Zahlen und Tagesverlauf.
- **Suche** über alles (⌘K), Reiter, **Papierkorb** mit ⌘Z, **Export** als Obsidian-Vault (ZIP).
- **Notiz öffentlich per Link** freigeben.
- **KI-Zugang** per MCP (`/api/mcp`): Claude und ChatGPT können suchen, lesen, anlegen und ändern.
  Jede Änderung steht im KI-Protokoll mit „Rückgängig“.
- **Sicherheit:** Anmeldung nur mit zweitem Faktor (TOTP), RLS auf jeder Tabelle, CSP mit Nonce.
- **Startbild:** einmal am Tag ein kurzes Video mit eigenen Leitsätzen (abschaltbar).

**Technik:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres,
Auth, RLS), Tiptap (Editor), Cloudflare R2 (Dateien), Vercel. Geprüft wird mit Biome (Lint und
Format), Vitest (Unit, Migrationen, Integration) und Playwright (E2E, Desktop 1440 px und Handy
390 px).

## Einrichten von null

**Voraussetzungen:** Node.js ≥ 24 (siehe `.nvmrc`), npm, ein GitHub-Konto und je ein kostenloses
Konto bei Supabase und Vercel. Optional: Cloudflare (R2, für Bilder und Dateien) und Google Cloud
(Kalender bearbeiten). Docker braucht es nicht.

1. **Code holen:** Das Repo forken oder als ZIP laden und in ein eigenes, gern privates
   GitHub-Repo legen. Danach klonen und `npm install` ausführen.
2. **Supabase-Projekt anlegen,** am besten in der Region Frankfurt. Falls Supabase beim Anlegen
   fragt: Neue Tabellen nicht automatisch freigeben, das erledigen die Migrationen (Rechte und
   RLS-Policies je Tabelle). Dann `cp .env.example .env.local` und drei Werte eintragen:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` und `SUPABASE_DB_URL`
   (Session Pooler, Hinweise stehen in der Vorlage). Die übrigen Zeilen sind optional.
3. **Schema einspielen:** `npm run db:push:prod` legt alle Tabellen, Policies und Funktionen aus
   `supabase/migrations/` an.
4. **Konto anlegen:** Supabase › Authentication › Users › „Add user“ mit E-Mail und Passwort,
   „Auto Confirm User“ an. Das Konto bekommt dabei automatisch die Startdaten (Bereiche,
   Vorlagen, Notiz-Typen). Danach unter Authentication die Registrierung neuer Nutzer
   ausschalten. Die App ist für genau eine Person gebaut.
5. **Vercel:** Neues Projekt aus dem eigenen GitHub-Repo anlegen (Next.js wird erkannt). Unter
   Environment Variables `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   eintragen und dann deployen. Die Funktionen laufen in Frankfurt (`vercel.json`).
6. **Adresse bei Supabase eintragen:** Authentication › URL Configuration › Site URL = die
   Vercel-Adresse.
7. **Anmelden:** Die Vercel-Adresse öffnen, anmelden und den zweiten Faktor mit einer
   Authenticator-App einrichten (siehe „Zweiter Faktor“). Ohne TOTP kommt niemand in die App.
8. **Eigene Adresse im Code:** `APP_PRODUCTION_ORIGIN` in
   `src/features/calendar/google/config.ts` auf die eigene Vercel-Adresse setzen. Das ist nur
   nötig, wenn Google-Kalender bearbeitet werden sollen (siehe unten).
9. **Eigene Leitsätze:** Die Texte des Startbilds stehen in `src/features/intro/model.ts`
   (`INTRO_TEXT`, Beispielsätze). Ausschalten geht unter Einstellungen › Startbild.

**Optional:** Bilder und Dateien über Cloudflare R2 (ohne R2 zeigt die App „Dateien sind hier
nicht verfügbar“), Google-Kalender, KI-Zugang, die nächtliche Sicherung am Mac und die Tests mit
einem zweiten Supabase-Projekt. Die Anleitungen dazu stehen in den Abschnitten unten.

**Tests einrichten:** ein zweites Supabase-Projekt als Testprojekt, Schema mit
`npm run db:push:test`, dort zwei Testnutzer A und B anlegen und `.env.test.example` nach
`.env.test.local` kopieren und ausfüllen. Danach:

```bash
npx playwright install chromium        # einmalig für die E2E-Tests
node scripts/test-totp.mjs             # TOTP für Testnutzer A und B (Geheimnisse → .env.test.local)
bash scripts/preflight.sh              # prüft beide Projekte, gibt keine Geheimnisse aus
```

Die `.env`-Dateien werden nie committet. Einen `service_role`-Key braucht es nirgends.

**Mit Claude Code weiterbauen:** `CLAUDE.md` enthält die Regeln, nach denen die App gebaut wurde.
`docs/02-design.md` beschreibt das Design mit seinen Tokens, `docs/03-architektur.md` das
Datenmodell und die Sicherheit. Die Kommentare im Code verweisen oft auf Nummern wie `#64`,
`E41` oder `B16`. Das sind Rückmeldungen, Entscheidungen und Bausteine aus der Entstehung, die
zugehörigen Notizen sind nicht Teil dieser Kopie.

## Start

```bash
npm run dev        # http://localhost:3000 – nutzt .env.local (Prod-Projekt)
```

Anmelden mit dem eigenen Konto (die Registrierung ist gesperrt), danach mit dem Code aus der
Authenticator-App (beim ersten Mal: Einrichtung, siehe unten). Danach öffnet sich „Heute“
(Fokus, Fälliges, Tagesablauf, ab 19:00 die Abendplanung für morgen). Schnell erfassen oben auf
Heute, in der Inbox oder mit ⌘K: `#job` / `#privat` ordnen dem Bereich zu, `@Projekt` dem Projekt,
ohne Kürzel landet der Eintrag in der Inbox. Notizen und Themen liegen unter „Wissen“, Aufgaben,
Projekte und Notizen als Datenbank (Liste, Tabelle, Board) unter „Datenbanken“. Eine Aufgabe
öffnet sich als Panel rechts (Adresse `?aufgabe=…`). Gelöschtes liegt im „Papierkorb“ (unten in
der Seitenleiste) und lässt sich zurückholen; ⌘Z nimmt die letzte Aktion zurück. Am Handy:
Zeile nach links wischen = Papierkorb, nach rechts = erledigt.

**Reiter** (#63): Oben steht jede offene Seite als Reiter (Desktop ab 1024 px). Klick in der
Seitenleiste oder auf einen Link öffnet im aktuellen Reiter, **⌘-Klick oder Mittelklick** in einem
neuen (⌘⇧-Klick: Browser-Tab), ✕ oder Mittelklick schließt, **⌃⌥← / ⌃⌥→** wechselt, ⌘K „Neuer
Reiter“/„Reiter schließen“; höchstens 8. Ein Reiter macht dort weiter, wo er aufgehört hat
(Adresse, offene Aufgabe, Scroll-Stelle). Am Handy zeigt der Zähler oben die offenen Seiten;
„In neuem Reiter öffnen“ steht in den Rechtsklick- bzw. Halten-Menüs. Gemerkt je Fenster/Gerät.

**Umwandeln** (#65): Rechtsklick bzw. ⋯ › „In Notiz umwandeln“ (Aufgabe) oder „In Aufgabe
umwandeln“ (Notiz): Titel, Inhalt, Bilder/Dateien, Bereich und Projekt gehen mit, das Original
kommt in den Papierkorb; die Meldung nennt, was nicht mitgeht, „Rückgängig“/⌘Z tauscht zurück.

### Auf dem Handy

Einfach die Live-URL öffnen (https). Das ist jetzt der normale Weg, auch für „Zum
Home-Bildschirm“. Es sind die echten Daten.

Lokale Änderungen vor dem Push am Handy prüfen (im selben WLAN, ohne https):

```bash
npm run build
npm run start -- -H 0.0.0.0 -p 3001   # dann am Handy: http://<IP des Macs>:3001
ipconfig getifaddr en0                # zeigt die IP des Macs
```

Nicht `npm run dev` nehmen: Next.js blockiert im Entwicklungsmodus Seitenaufrufe von anderen
Geräten. Ohne https ist die Seite kein „sicherer Kontext“; die App kommt damit zurecht (IDs über
`src/lib/id.ts`, der Kopier-Knopf der MFA-Einrichtung fehlt dann).

## Zweiter Faktor (MFA)

Seit B16 gilt: **In die App kommt nur, wer nach dem Passwort einen Code aus der
Authenticator-App eingibt** (Supabase-Stufe `aal2`). Ohne eingerichteten Faktor führt jeder Weg
zur Einrichtung (`/mfa/einrichten`), mit Faktor zur Abfrage (`/mfa`). Der Routenschutz sitzt in
`src/proxy.ts`; die Datenbank erzwingt dasselbe per restriktiver RLS-Policy auf allen Tabellen
(Migration 13, E17), auch für direkte API-Aufrufe.

**Einrichten (einmalig):** Live-URL öffnen → anmelden → QR-Code mit der Authenticator-App
scannen (oder den Schlüssel abtippen) → den angezeigten 6-stelligen Code eingeben. Tipp: Den
Schlüssel zusätzlich im Passwort-Manager speichern (die meisten können TOTP), dann ist ein
verlorenes Handy kein Problem. Neu laden erzeugt einen neuen QR-Code; den alten Eintrag in der
App dann löschen. Eine Bestätigung beendet andere, noch nicht bestätigte Anmeldungen desselben
Kontos (Supabase), dort einfach neu anmelden.

**Wiederherstellung (Handy weg, kein Backup des Schlüssels):**
1. Supabase-Dashboard → eigenes Projekt → Authentication → Users → eigenes Konto öffnen →
   unten „Remove MFA factors“ (o. ä., im Bereich „Danger zone“).
   Falls die Oberfläche das nicht anbietet: SQL Editor →
   `delete from auth.mfa_factors where user_id = (select id from auth.users where email = '<deine E-Mail>');`
2. In der App neu anmelden: Ohne Faktor führt die Anmeldung zur Einrichtung, neuen QR-Code
   scannen. Die Daten bleiben unangetastet (nur der Faktor wird entfernt).

Der Supabase-Zugang selbst (Dashboard-Login) hängt nicht an diesem Faktor.

## KI-Zugang (Claude, ChatGPT)

Claude und ChatGPT arbeiten über die MCP-Schnittstelle `/api/mcp` mit Triskel:
suchen, lesen, anlegen, ändern und – nur nach Rückfrage – in den Papierkorb legen. Werkzeuge:
`overview`, `search`, `fetch`, `list_tasks|notes|projects|recaps`, `create_/update_note|task|project|recap`,
`capture`, `attach_file`, `prepare_upload`, `get_attachment`, `convert` (Aufgabe ↔ Notiz, nur nach
Rückfrage), `trash` und für Google-Termine (nach „Mit Google
verbinden“ in Einstellungen › Kalender) `list_events`, `create_event`, `update_event`,
`delete_event` – Löschen eines Termins wie der Papierkorb nur nach Rückfrage im Chat; bei
„Termin löschen“ die Freigabe ebenfalls auf „jedes Mal fragen“ lassen. Termine mit Notizen und
Aufgaben verknüpfen: `link_event`, `unlink_event`, „termin“ bei `create_note`/`create_task` (#68).
Aufgaben haben „zustaendig“ (`ich` Standard, `ki` nur für eigene Arbeitsschritte der KI – die
stehen nur im Projekt, #77). Jede Änderung steht im
KI-Protokoll (Einstellungen › KI-Zugänge) mit „Rückgängig“. Auf einen
Eintrag zeigen: in der App „Link kopieren“ (…-Menü oder Rechtsklick) und den Link in den Chat
legen – die Werkzeuge nehmen ihn statt einer ID. **Endgültig
löschen** geht nur in der App. Details: `docs/03-architektur.md`
(„KI-Schnittstelle“).

**Einmal je Supabase-Projekt einrichten** (Dashboard, kein Schema – deshalb keine Migration):
1. Authentication › **OAuth Server** einschalten, **Authorization Path:** `/ki-zugang`.
2. **Dynamic Client Registration** („Allow dynamic OAuth apps“): **in Prod aus**. Im Testprojekt
   an – nur dort registrieren die Tests ihre Clients selbst.
3. Authentication › URL Configuration › **Site URL** = Adresse der App (Prod: die Vercel-URL).
   Die JWT-Schlüssel sind schon asymmetrisch (ES256), daran ist nichts zu tun.
4. **Prod:** Authentication › OAuth Apps › je KI eine App anlegen: „Public Client“ **aus**
   (vertraulich, mit Client-Secret), **Token Endpoint Auth Method `client_secret_post`** (so
   schickt Claude das Secret; Supabase lehnt eine andere Methode ab – Symptom: „Autorisierung
   fehlgeschlagen“ nach dem Erlauben). Supabase zeigt Client-ID und Client-Secret – das Secret
   direkt in die KI kopieren, nirgends sonst ablegen (verloren → in Supabase neu erzeugen).
   Redirect-URI je App:
   - **Claude** (Web, Desktop, iPhone): `https://claude.ai/api/mcp/auth_callback`
   - **ChatGPT:** die Rücksprung-Adresse, die ChatGPT beim Anlegen anzeigt
     (`https://chatgpt.com/connector/oauth/…`) – nachträglich in der Supabase-App eintragen.
   - **Claude Code:** `http://localhost:8080/callback`

**Verbinden** (Adresse und Anleitung auch unter Einstellungen › KI-Zugänge):
- **Claude:** Einstellungen › Konnektoren › „Eigenen Konnektor hinzufügen“ → Name
  „Triskel“, Adresse `https://<app>/api/mcp`, bei „OAuth client“ **„Use your own OAuth
  client“** mit Client-ID und Client-Secret → „Verbinden“. Es öffnet sich `/ki-zugang`: anmelden
  (Passwort + TOTP), „Erlauben“. Danach beim Konnektor die Werkzeuge „In den Papierkorb legen“,
  „Termin löschen“ und „Aufgabe oder Notiz umwandeln“ auf „jedes Mal fragen“ lassen.
- **ChatGPT** (Web): [chatgpt.com/plugins](https://chatgpt.com/plugins) › „+“ › „Add custom MCP
  server“ (bei älterer Oberfläche: Einstellungen › Apps › Erweitert › Entwicklermodus, dann App
  erstellen) → Name, Beschreibung, Adresse, Anmeldung OAuth mit Client-ID und Client-Secret. Die
  angezeigte Rücksprung-Adresse in der Supabase-App „ChatGPT“ eintragen (sonst „invalid
  redirect_uri“; steht auch in der Adresszeile der Fehlerseite). ChatGPT schickt das Secret wie
  Claude im Formular (`client_secret_post`, 17.10. so verbunden). Ob ChatGPT auch schreiben darf,
  hängt vom Abo ab. Achtung: Die MCP-Einstellungen von **Codex** (STDIO/Bearer-Token-Felder) sind
  nicht der ChatGPT-Chat – Codex bräuchte Selbst-Registrierung, die in Prod aus ist.
- **Claude Code:** `claude mcp add --transport http --client-id <Client-ID> --client-secret
  --callback-port 8080 schaltzentrale https://<app>/api/mcp` (fragt das Secret verdeckt ab).

**Trennen:** Einstellungen › KI-Zugänge › „Trennen“ – nimmt die Freigabe zurück und trennt den
Zugang beim Auth-Server; gesperrt ist sofort, auch ein schon ausgestelltes Token.
**Was hat die KI geändert?** Ebenda „Zuletzt durch KI geändert“, mit Link und „Rückgängig“
(Inhalt ersetzt/angehängt, Felder geändert, erledigt).

**Sicherheit (E28):** Supabase gibt KI-Tokens nur die Stufe „Passwort“ (`aal1`) und lässt das
Erlauben schon mit dem Passwort zu. Daten sieht ein Token deshalb nur mit **Freigabe**: Die trägt
`/ki-zugang` beim „Erlauben“ ein, und das geht nur mit TOTP (`ai_clients`, Migration 21). Dazu
muss der Client vertraulich sein (ohne Secret kein Token) und seine Sitzung noch bestehen.
Einstellungen, Vorlagen und gespeicherte Ansichten bleiben für die KI zu. Ein Zugang ohne Freigabe
steht in den Einstellungen mit Hinweis – dann trennen. Geprüft von
`tests/integration/oauth.test.ts` und der Migrations-Simulation. Kein service_role-Schlüssel.
`attach_file` lädt Dateien von Notion-Download-Links (bis 50 MB: Laden und Schreiben nach R2 laufen
in einer Funktion mit 60 s) oder nimmt eine Datei, die die KI vorher mit `prepare_upload`
hochgeladen hat (signierter R2-Link für genau einen Pfad, **genau die angegebene `groesse` in Bytes**
und den Typ aus der Endung, 1 Stunde gültig, PUT mit dem Dateiinhalt; bis 100 MB, Bilder bis 10 MB;
#51, E33, E41). Die Dateien liegen in R2; die KI braucht dafür die Freigabe (`ai_client_allowed()`),
liest und schreibt nur im eigenen Ordner, **löscht und listet nie**. `get_attachment` liest Text nur
bis 25 MB, darüber kommt ein Hinweis. **Bilder und Dateien im Chat (#71, E37):** `fetch`
liefert die Bilder einer Notiz, Aufgabe oder eines Projekt-Freitexts als Bild mit (verkleinert auf
1600 px, höchstens 5 bzw. 3,5 MB je Antwort), `get_attachment` holt einzelne Bilder, den Text von
PDFs (bis 50 Seiten) und Textdateien – nur Dateien, die im Eintrag stehen, aus dem eigenen Ordner.
Eine Datei aus dem Chat hängt `attach_file` mit `inhalt_base64` an (bis 2,5 MB; der Inhalt steht im
Aufruf, also eher kleine Dateien). Der Hochlade-Link geht an den R2-Host (`<konto>.eu.r2.cloudflarestorage.com`);
aus Claudes Cloud-Umgebung kann er gesperrt sein – dort `inhalt_base64`. Alles mit dem Token des Nutzers; die
Grenzen kommen von Vercel (4,5 MB je Anfrage und Antwort) und dem MCP-SDK (4 MiB je Anfrage). HEIC
kann der Server nicht umwandeln (Hinweis statt Bild). Schreibt die KI einen Inhalt mit „ersetzen“
neu, bleiben Bilder und Dateien erhalten, deren Verweise (`![[…]]`, `[[…]]` aus `fetch`) im neuen
Text stehen. Aufgaben, die die KI anlegt, tragen „von KI angelegt“ (`tasks.created_by`, gesetzt
von der Datenbank, Migration 40) – filterbar in Einplanen und der Aufgaben-Datenbank. Nach dem
Update die Verbindung in Claude/ChatGPT neu laden, damit neue Werkzeuge erscheinen. Die Tests registrieren je Lauf
OAuth-Clients im Testprojekt; die Liste unter Authentication › OAuth Apps gelegentlich leeren.

### Triskel-Ablage (Dateien vom Mac, #76)

Kleines MCP-Programm am Mac (`scripts/triskel-ablage.mts`), damit Claude Code und die
Claude-Desktop-App Dateien vom Rechner in Triskel ablegen – direkt vom Mac zum Speicher (bis
100 MB), der Inhalt läuft nicht durch den Chat. Ablauf: `datei_vorbereiten` (Fotos auf 2000 px,
HEIC → JPEG; liefert `name` und `bytes`) → Triskel `prepare_upload` (mit `groesse` = `bytes`) →
`datei_hochladen` → Triskel `attach_file`; dazu `dateien_suchen`. Liest nur aus Downloads,
Schreibtisch, Dokumente und iCloud Drive (keine versteckten Dateien), kennt keine Zugangsdaten (der
Hochlade-Link aus `prepare_upload` gilt 1 Stunde für einen Pfad und genau eine Größe und nimmt
nur eine Datei an – `datei_hochladen` sendet dazu `If-None-Match: *`, ein zweiter Versuch
überschreibt nichts). Gesendet wird
nur an `https://<eigenes Konto>.eu.r2.cloudflarestorage.com/triskel-dateien/…` mit Signatur
(`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Expires`). Das Konto kommt aus `TRISKEL_R2_ACCOUNT_ID`,
sonst aus der Zeile `R2_ACCOUNT_ID` der `.env.local` im Repo (nur diese Zeile wird gelesen) –
solange die `.env.local` im Arbeitsordner liegt. Nur für die
Tests gibt es `TRISKEL_R2_BUCKET` (Test-Bucket, genau dieser Name).

Einrichten (einmalig, Node mit vollem Pfad – die Desktop-App kennt den Shell-`PATH` nicht):

```bash
# Claude Code
claude mcp add triskel-ablage --scope user \
  -- /opt/homebrew/bin/node <Pfad zum Repo>/scripts/triskel-ablage.mts
```

Claude-Desktop-App: in `~/Library/Application Support/Claude/claude_desktop_config.json` unter
`mcpServers` denselben Eintrag (`command`, `args`, `env`), danach die App neu starten. Beim ersten
Zugriff fragt macOS je Ordner (Downloads, Schreibtisch, Dokumente) – erlauben. Das Programm läuft
aus dem Arbeitsordner: Ist ein Branch ohne die Datei ausgecheckt, startet es nicht. Geprüft von
`tests/unit/ablage.test.ts` und `tests/integration/triskel-ablage.test.ts`.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver (Prod-Daten aus `.env.local`) |
| `npm run lint` / `npm run format` | Biome prüfen / automatisch korrigieren |
| `npm run typecheck` | Routen-Typen erzeugen + TypeScript prüfen |
| `npm run test` | Vitest: Unit, Migrations-Audit (PGlite) **und** Integration gegen das Testprojekt |
| `npm run test:unit` / `test:migrations` / `test:integration` | einzelne Vitest-Projekte |
| `npm run test:e2e` | Playwright gegen das Testprojekt, Desktop 1440 px + Mobil 390 px |
| `npm run test:e2e:build` | Smoke-Test gegen `next build && next start` (Prod-CSP ohne `unsafe-eval`, Mermaid, PDF, HEIC; Build zeigt aufs Testprojekt, nie auf Prod) – vor jedem PR, nicht gleichzeitig mit `test:e2e` |
| `npm run build` | Produktions-Build |
| `npm run db:push:test` | Migrationen ins **Testprojekt** (immer zuerst) |
| `npm run db:push:prod` | Migrationen ins Prod-Projekt (erst nach grünen Integrationstests) |
| `npm run db:types` | `src/lib/supabase/database.types.ts` aus dem Testprojekt erzeugen |
| `npm run db:check:test` / `db:check:prod` | Seeds je Nutzer prüfen (nur Zählwerte) |
| `bash scripts/backup-prod.sh` | Sicherung der Prod-Daten nach `.backups/` (vor jeder Prod-Migration) |
| `node scripts/backup-nightly.mts prod --jetzt` | Nächtliche Sicherung sofort: Datenbank + Dateien nach `.backups/nachts/prod/` und Google Drive |
| `node scripts/backup-restore.mts test\|prod [Stand]` | Aus der nächtlichen Sicherung wiederherstellen (siehe unten; Prod nur mit `--ja-prod`) |
| `bash scripts/backup-install.sh [--status\|--entfernen]` | Nächtliche Sicherung auf dem Mac ein-/ausschalten (launchd) |
| `npm run db:mfa:test` / `db:mfa:prod` | Haben alle Nutzer einen bestätigten TOTP-Faktor? (nur Zählwerte; `db:push:prod` prüft das vor Migration 13 selbst) |
| `node scripts/test-totp.mjs` | TOTP für die Testnutzer A/B im Testprojekt einrichten bzw. prüfen (Geheimnisse nur in `.env.test.local`) |

Reihenfolge bei einer neuen Migration: `db:push:test` → `npm run test:integration` →
`bash scripts/backup-prod.sh` → `db:push:prod` → `db:check:prod` → `db:types`.

## Dateien in Cloudflare R2 (E41)

Bilder und Dateien liegen in einem privaten R2-Bucket in der EU (Aufbau: `docs/03-architektur.md` ›
Sicherheit). Grenzen: Dateien bis 100 MB, Bilder bis 10 MB.

### Einrichtung (einmalig, Cloudflare-Dashboard › R2)

1. Buckets `triskel-dateien` und `triskel-dateien-test`, Gerichtsbarkeit **EU**, mit
   CORS-Richtlinie (Prod: die Vercel-Adresse; Test: `http://localhost:3100`,
   `http://127.0.0.1:3100`; Methoden `GET`, `PUT`, `HEAD`, Header `content-type` und
   `if-none-match`). Wortlaut für den Prod-Bucket:

   ```json
   [{ "AllowedOrigins": ["https://deine-app.vercel.app"],
      "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["content-type", "if-none-match"],
      "MaxAgeSeconds": 3600 }]
   ```

   Test-Bucket: `"AllowedOrigins": ["http://localhost:3100", "http://127.0.0.1:3100"]`.
   **Nachtrag R-5 (Review Teil B):** Der Hochlade-Link der App nimmt nur noch genau einen PUT
   an, sobald in Vercel (Production) `R2_EXCLUSIVE_UPLOADS=1` steht. Reihenfolge: zuerst in
   **beiden** Buckets `if-none-match` zu `AllowedHeaders` hinzufügen (sonst scheitert jedes
   Hochladen im Browser am CORS-Vorabcheck), dann die Variable setzen und neu deployen, dann ein
   Bild und eine Datei in der App hochladen. Für die E2E-Tests dieselbe Variable in
   `.env.test.local` (Test-Bucket ebenfalls mit dem Header).
2. API-Tokens, je nur für den genannten Bucket. Das Geheimnis zeigt Cloudflare nur einmal –
   direkt eintragen, nie in Chat oder Repo. Nur die **Namen** der Werte:

   | Token | Recht | Werte | Wo |
   |---|---|---|---|
   | App | lesen & schreiben, `triskel-dateien` | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Vercel › Environment Variables (nur **Production**) |
   | Test | lesen & schreiben, `triskel-dateien-test` | dieselben vier Namen, `R2_BUCKET=triskel-dateien-test` | `.env.test.local` |
   | Sicherung | **nur lesen**, `triskel-dateien` | `R2_ACCOUNT_ID`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` | `.env.local` |

   Vorlagen: `.env.example`, `.env.test.example`. Ohne die vier App-Werte antworten die Routen
   `/api/dateien/*` mit 503, die App zeigt „Dateien sind hier nicht verfügbar“.
3. **Lokaler `npm run dev`** (Prod-Daten) bekommt bewusst keinen App-Token (CLAUDE.md Regel 3):
   Bilder und Dateien erscheinen dort als „nicht verfügbar“. Mit Dateien arbeiten geht über den
   Testserver (`npm run test:e2e`, Test-Bucket) oder die Vercel-Adresse.
4. Optional: Cloudflare › Abrechnung › Benachrichtigungen (Mail ab 1 $; R2 kennt keine harte
   Kostengrenze). 10 GB sind gratis, danach 0,015 $/GB und Monat, Herunterladen kostenlos.

Die Tests laufen nur gegen `triskel-dateien-test`: `readR2Config` und `assertR2TestBucket`
(`tests/guard.ts`) brechen ab, wenn `R2_BUCKET` der Prod-Bucket ist.


## Sichern und Export

Im Gratis-Tarif von Supabase gibt es **keine automatischen Backups**. Deshalb sichert der Mac
jede Nacht selbst (E32):

### Nächtliche Sicherung

- **Was:** die Datenbank (Schema `public` = alle App-Daten, `pg_dump`) **und** alle Dateien
  (`note-images`, `attachments`). Die Dateien liegen seit E41 in Cloudflare R2 (Bucket
  `triskel-dateien`, Schlüssel `<bucket>/<pfad>`). Zugang: `SUPABASE_DB_URL` und der
  **Nur-Lesen-Token** `R2_BACKUP_ACCESS_KEY_ID`/`R2_BACKUP_SECRET_ACCESS_KEY` (plus `R2_ACCOUNT_ID`),
  alles nur in `.env.local` (CLAUDE.md Regel 3). Der Bucket steht fest im Skript (nicht aus
  `R2_BUCKET`); das Testziel liest `triskel-dateien-test` mit `R2_ACCESS_KEY_ID`/… aus
  `.env.test.local`, prod nie den Test-Bucket und umgekehrt.
- **Wann:** launchd startet stündlich um :07 `scripts/backup-nightly.mts prod --nachts`; gesichert
  wird einmal je Nacht ab 02:00. Hat der Mac geschlafen, holt der erste Aufruf nach dem Aufwachen
  nach. Ein- und ausschalten: `bash scripts/backup-install.sh` (`--status`, `--entfernen`).
- **Wohin:** `.backups/nachts/prod/` auf dem Mac und Google Drive
  `Triskel-Backup/` (über rclone, Verbindung `gdrive:`). Je Lauf ein Stand
  `sicherungen/JJJJ-MM-TT-HHMM/` mit `db.dump`, `info.json` (Zeilen je Tabelle, Migration,
  Konten) und `dateien.json` (Datei-Liste); die Dateien selbst liegen einmal in `dateien/<bucket>/`
  und kommen nur neu hinzu – auch in Prod gelöschte bleiben erhalten.
- **Aufbewahrung:** alle Stände der letzten 30 Tage, davor der erste Stand je Monat für
  12 Monate, die neuesten 7 immer. Aufgeräumt werden nur Stände (auf Drive in den Papierkorb),
  nie Dateien, nie etwas in Prod.
- **Kontrolle:** Jeder Erfolg steht in der App unter Einstellungen › Sicherung. Ist die letzte
  Sicherung älter als 36 Stunden (oder gab es nie eine), zeigt **Heute** einen Hinweis – das fällt
  auch auf, wenn der Mac aus war. Fehler melden sich zusätzlich als Mac-Mitteilung (höchstens alle
  6 Stunden). Log: `.backups/nachts/prod/lauf.log`. Scheitert nur Drive, bleibt der Stand auf
  dem Mac, und der nächste stündliche Lauf derselben Nacht reicht ihn nach (kein neuer Dump).
  Eine Sperre (`.lauf.lock`) nach einem Absturz gilt als verwaist, sobald ihr Prozess kein
  Sicherungs-Lauf mehr ist, spätestens nach 3 Stunden; hält ein Lauf sie über eine Stunde, meldet
  sich das als Fehler.

### Verschlüsselung der Stände (age, Review Teil B R-3)

Der Dump eines Stands enthält alle Inhalte samt geheimer iCal-Adressen und Freigabe-Token. Mit
age-Schlüssel geht deshalb **nur die verschlüsselte Fassung** nach Drive (`db.dump.age`,
`info.json.age`, `dateien.json.age`); der Klartext bleibt in `.backups/nachts/` auf dem Mac
(außerhalb des Drive-Spiegels). Die Dateien in `dateien/<bucket>/` bleiben unverschlüsselt
(Bilder und Dokumente, kein Token). Einrichten (einmalig):

1. `brew install age`
2. `age-keygen` ausführen – es erscheinen zwei Zeilen: `# public key: age1…` und
   `AGE-SECRET-KEY-1…`. Beide **nicht** in Chat oder Repo.
3. In `.env.local`: `BACKUP_AGE_RECIPIENT=age1…` (Empfänger) und `BACKUP_AGE_IDENTITY=AGE-SECRET-KEY-1…`
   (privater Schlüssel, nur fürs Wiederherstellen). Den privaten Schlüssel **zusätzlich im
   Passwort-Manager** ablegen – ohne ihn ist kein Stand von Drive lesbar („Mac weg“).
4. Probelauf: `node scripts/backup-nightly.mts prod --jetzt` – im Log steht
   „verschlüsselt (age): db.dump, info.json, dateien.json“, auf Drive liegen im Stand nur `.age`-Dateien.
5. Alte Stände auf Drive (vor der Einrichtung, Klartext) verschwinden über die Aufbewahrung nach
   30 Tagen; wer früher aufräumen will: `Triskel-Backup/sicherungen/`
   in Drive durchsehen (Papierkorb, nichts auf dem Mac löschen).

Wiederherstellen (`backup-restore.mts`) entschlüsselt einen nur verschlüsselt vorliegenden Stand
von selbst (`--von-drive`); der private Schlüssel geht dabei nur über eine kurzlebige Datei
(0600) an `age`, nie über die Befehlszeile. Falsch geformte `BACKUP_AGE_*`-Werte brechen den Lauf
ab, statt Klartext hochzuladen.

### Wiederherstellen

Immer zuerst prüfen, dann einspielen. Das Skript legt vorher einen Sicherheits-Dump des Ziels nach
`.backups/vor-wiederherstellung/`, spielt die Datenbank in **einer** Transaktion ein (prüft die
Zeilen je Tabelle vor dem Abschluss, sonst bleibt alles wie vorher) und lädt fehlende Dateien
nach **R2** hoch (`<bucket>/<pfad>`, nur kopieren, vorhandene bleiben, nie löschen). Danach die App
in jedem Browser neu laden.

**Schreib-Token für Prod (nur im Ernstfall anlegen):** Der Sicherungs-Token darf nur lesen. Fürs
Wiederherstellen in Prod in Cloudflare (R2 › Manage API Tokens) einen Token „Objekt lesen &
schreiben“ **nur für den Bucket `triskel-dateien`** anlegen, als `R2_RESTORE_ACCESS_KEY_ID` und
`R2_RESTORE_SECRET_ACCESS_KEY` in `.env.local` eintragen und **nach der Wiederherstellung
widerrufen** (Zeilen wieder entfernen). Fehlt er, bricht das Skript vor jeder Änderung ab und
nennt `--ohne-dateien` (nur Datenbank). Das Testziel schreibt mit `R2_ACCESS_KEY_ID` in den
Test-Bucket.

```bash
node scripts/backup-restore.mts prod --pruefen              # passt der neueste Stand? ändert nichts
node scripts/backup-restore.mts prod 2026-10-18-0207 --ja-prod
```

- **Daten in Prod kaputt** (häufigster Fall): wie oben, mit dem letzten guten Stand.
- **Mac weg:** Repo klonen, `.env.local` neu füllen, rclone mit `gdrive:` einrichten, dann
  `… --von-drive` – holt Stand und Dateien zuerst von Drive.
- **Projekt weg (neues Supabase-Projekt):** `.env.local` auf das neue Projekt zeigen lassen
  (URL, Keys, DB-URL), Schema mit `npm run db:push:prod` anlegen (die Dateien liegen in R2 und
  bleiben, ein neuer Supabase-S3-Schlüssel ist nur für die Altbuckets nötig),
  das Konto im Dashboard anlegen (Authentication › Add user, „Auto Confirm“), in der App anmelden
  und TOTP einrichten. Die neue Nutzer-ID steht im Dashboard, die alte in `info.json` › `nutzer`. Dann `… --nutzer <ALT>=<NEU> --ja-prod` – schreibt IDs in Daten und
  Datei-Pfaden um. Ist das neue Schema neuer als der Stand: `--trotzdem` – dann werden auch
  Tabellen geleert, die der Stand noch nicht kennt (das Skript nennt sie).
- **Probe:** `RESTORE_DRILL=1 npx vitest run --project integration
  tests/integration/backup-restore.test.ts` setzt das **Testprojekt** auf eine frische Sicherung
  zurück und prüft, dass nach einem „Unfall“ alles genau so wiederkommt (nicht parallel zu anderen
  Tests laufen lassen).

### Export

- **Einstellungen › Export** erstellt im Browser ein ZIP: ein Obsidian-Vault (Projekte mit
  Fahrplan, Aufgaben, Notizen, Rückblicke als Markdown mit Frontmatter, Verweise als `[[…]]`) und
  `export.json` mit allen Zeilen aller Tabellen, auch dem Papierkorb. In Obsidian: „Ordner als
  Vault öffnen“. Der abgeschlossene Wochenrückblick erinnert daran und nennt den letzten Export.
- Für Claude: Der Abschnitt „Fahrplan“ jeder Projektdatei nummeriert die Meilensteine, darunter
  stehen ihre Aufgaben als Checkliste; `naechster_meilenstein` im Kopf nennt den nächsten Schritt.
- Vor jeder Prod-Migration zusätzlich `bash scripts/backup-prod.sh` (Datenbank-Dump) – oder
  `node scripts/backup-nightly.mts prod --jetzt` (mit Dateien).

## Kalender einrichten (Google, lesend)

Die App liest Google-Kalender über die **geheime Adresse im iCal-Format** (Stufe 2, S2a) – ohne
Google-Konto-Freigabe, ohne OAuth:

1. Google Kalender am Computer › Einstellungen › links den Kalender wählen › „Kalender
   integrieren“ › **„Geheime Adresse im iCal-Format“** kopieren.
2. In der App: **Einstellungen › Kalender** › Adresse einfügen › „Prüfen“ (zeigt Name und die
   nächsten Termine) › Name und Farbe wählen › „Kalender hinzufügen“. Beliebig viele Kalender,
   jeder einzeln ein- und ausschaltbar; „Probe-Abruf“ in der Zeile prüft die Verbindung.
3. Die Adresse ist ein Geheimnis: Wer sie kennt, kann den Kalender lesen. Sie bleibt in der
   Datenbank (nur mit zweitem Faktor lesbar, nie für KI-Zugänge), erscheint nur in den
   Einstellungen (verborgen, auf Wunsch sichtbar), fehlt im Export und steht in keinem Log.
   In Google lässt sie sich jederzeit zurücksetzen („Zurücksetzen“ neben der Adresse) – dann in
   der App die neue einfügen.
4. Termine liest nur der Server (`GET /api/kalender?von=…&bis=…`, Sitzung des Nutzers), nur von
   `https://calendar.google.com/calendar/ical/…`, mit 5 Minuten Zwischenspeicher. Nichts davon
   wird gespeichert. Tests nutzen die eigene ICS unter `/dev/ics` (nie einen echten Kalender;
   `CALENDAR_ALLOWED_ORIGINS` in `playwright.config.ts`, wirkt nie in Produktion).

## Google-Kalender bearbeiten einrichten (#64, einmalig)

Damit die App (und die KI) Google-Termine anlegen, verschieben, ändern und löschen kann, braucht
sie einen eigenen Google-Zugang. Einmal am Mac,
~15 Minuten, mit dem Google-Konto, dessen Kalender du nutzt. Die Google-Seiten können deutsch
oder englisch sein – beide Bezeichnungen stehen dabei.

**Vorher:** zwei Browser-Tabs öffnen – Tab 1 https://console.cloud.google.com, Tab 2
https://vercel.com (Projekt `second-brain-app` › **Settings** › **Environment Variables**). Den
Clientschlüssel zeigt Google nur **einmal** beim Anlegen – er wandert direkt von Tab 1 in Tab 2,
nie in Chat, Notiz oder eine Datei.

**A. Projekt anlegen (Tab 1)**
1. Oben links neben „Google Cloud“ auf die **Projektauswahl** klicken › **„Neues Projekt“**
   („New project“).
2. Projektname `Schaltzentrale`, Organisation/Speicherort so lassen › **„Erstellen“**.
3. Nach ein paar Sekunden oben in der Projektauswahl **`Schaltzentrale`** wählen (muss oben
   stehen, sonst landet alles im falschen Projekt).

**B. Google Calendar API einschalten**
4. Oben im Suchfeld `Google Calendar API` eingeben › Treffer unter „Marketplace“/„APIs“ öffnen ›
   **„Aktivieren“** („Enable“).

**C. Anmeldeseite einrichten (Google Auth Platform)**
5. Oben im Suchfeld `Google Auth Platform` eingeben und öffnen (heißt auch
   „OAuth-Zustimmungsbildschirm“ / „OAuth consent screen“). Steht dort „noch nicht konfiguriert“,
   auf **„Jetzt starten“** („Get started“).
6. **App-Informationen:** App-Name `Schaltzentrale`, Nutzer-Support-E-Mail = deine Gmail-Adresse
   › Weiter.
7. **Zielgruppe** („Audience“): **„Extern“** („External“) › Weiter.
8. **Kontaktdaten:** deine Gmail-Adresse › Weiter › Richtlinie anhaken › **„Erstellen“**.
9. Links **„Datenzugriff“** („Data Access“) › **„Bereiche hinzufügen oder entfernen“** („Add or
   remove scopes“) › im Filter `calendar.events` eingeben › die Zeile
   `…/auth/calendar.events` anhaken (nicht „readonly“); dann im Filter `calendarlist` eingeben ›
   `…/auth/calendar.calendarlist.readonly` anhaken (Liste der Kalender – die App findet sie damit
   selbst) › **„Aktualisieren“** („Update“) › unten **„Speichern“** („Save“).
10. Links **„Zielgruppe“** („Audience“) › bei „Veröffentlichungsstatus: Test“ auf **„App
    veröffentlichen“** („Publish app“) › bestätigen. Status ist danach **„In Produktion“**.
    Wichtig: Im Status „Test“ läuft die Anmeldung alle 7 Tage ab. Eine Überprüfung durch Google
    brauchst du nicht – beim späteren Verbinden zeigt Google einmal „Diese App wurde nicht von
    Google überprüft“ › „Erweitert“ › „Weiter zu Schaltzentrale“.

**D. Zugang anlegen (Client)**
11. Links **„Clients“** › **„Client erstellen“** („Create client“).
12. Anwendungstyp **„Webanwendung“** („Web application“), Name `Schaltzentrale Web`.
13. Unter **„Autorisierte Weiterleitungs-URIs“** („Authorized redirect URIs“) › **„URI
    hinzufügen“** › genau diese Adresse eintragen:
    `https://deine-app.vercel.app/api/google/callback`
    (die eigene Vercel-Adresse, dieselbe wie `APP_PRODUCTION_ORIGIN` in
    `src/features/calendar/google/config.ts`; „Autorisierte JavaScript-Quellen“ leer lassen.) › **„Erstellen“**.
14. Es erscheint ein Fenster mit **Client-ID** und **Clientschlüssel** („Client secret“).
    **Fenster offen lassen** und mit Teil E weitermachen.

**E. In Vercel eintragen (Tab 2)** – je Wert: **„Add New“** › Key und Value eintragen › bei
Environments **nur „Production“** angehakt lassen (Preview und Development abhaken) ›
**„Sensitive“** einschalten › **„Save“**.
15. Key `GOOGLE_CLIENT_ID` – Value: die Client-ID aus Schritt 14 (Kopier-Symbol daneben).
16. Key `GOOGLE_CLIENT_SECRET` – Value: der Clientschlüssel aus Schritt 14 (Kopier-Symbol).
17. Key `GOOGLE_TOKEN_KEY` – Value: ein neuer Zufallsschlüssel. Dazu im Terminal am Mac
    `openssl rand -base64 32 | pbcopy` eingeben und Enter drücken (der Schlüssel landet ohne
    Anzeige in der Zwischenablage) › in Vercel einfügen.
18. Erst jetzt das Google-Fenster aus Schritt 14 mit **„OK“** schließen. Danach in Vercel neu
    bereitstellen (Deployments › Redeploy).

**Danach:** App › Einstellungen › Kalender ›
„Mit Google verbinden“ (nur mit zweitem Faktor; der Rücksprung ist fest die Adresse aus Schritt 13 –
ist die App über eine andere Vercel-Adresse geöffnet, wechselt „Verbinden“ zuerst dorthin, ggf. mit
neuer Anmeldung). Bei Google beide Häkchen setzen
(Termine, Kalenderliste). Danach erscheinen die Google-Kalender in den Einstellungen – je
Kalender „anzeigen“ und Farbe. Fehlt ein Wert in Vercel oder ist `GOOGLE_TOKEN_KEY` kein
32-Byte-Schlüssel, nennt Einstellungen › Kalender den Namen der Variable. Geht etwas schief (Clientschlüssel verloren o. Ä.): in „Clients“ beim
Zugang einen neuen Schlüssel erzeugen und in Vercel ersetzen. Auf dem Mac liegt keiner der Werte
(Regel 3); lokal und in Tests ersetzt `/dev/google` Google.

## Tests und Sicherheit

- Tests laufen nie gegen echte Daten. Der Schutzschalter (`tests/guard.ts`) bricht ab, wenn die
  Test-URL leer ist oder auf Prod zeigt; für Dateien bricht `readR2Config` bei `NODE_ENV=test` ab,
  wenn `R2_BUCKET` der Prod-Bucket ist (Tests nur gegen `triskel-dateien-test`). Der E2E-Testserver läuft mit `NODE_ENV=test` und lädt
  nur `.env.test.local`, nie `.env.local`.
- Integrationstests melden A und B einmal je Lauf an und räumen ihre Daten selbst auf.
- E2E: `tests/e2e/auth.setup.ts` meldet Testnutzer A per API an, mit Passwort und TOTP-Code
  (das Passwort erscheint nie im Browser, in Reports oder Traces). Nach dem Lauf löscht der
  Teardown alle Daten mit `E2E-`-Präfix und die gespeicherte Sitzung (`playwright/.auth/`,
  gitignored). Den Login über das Formular samt TOTP-Abfrage prüft `auth-flow.spec.ts` (einmal je
  Lauf, Desktop + 390 px); die Einrichtung zeigt die Vorschau `/dev/mfa` (nur Entwicklung).
- Testnutzer A und B haben einen TOTP-Faktor mit bekanntem Geheimnis (`.env.test.local`,
  `E2E_USER_<A|B>_TOTP_SECRET`); `otpauth` erzeugt die Codes. Supabase akzeptiert denselben Code
  mehrfach, beendet aber nach jeder Bestätigung andere aal1-Sitzungen desselben Nutzers.
- Sicherheits-Header: CSP mit Nonce je Anfrage aus `src/proxy.ts` (`src/lib/security/headers.ts`),
  feste Header (HSTS, nosniff, X-Frame-Options, Referrer- und Permissions-Policy) aus
  `next.config.ts`; Region `fra1` in `vercel.json`.
- Abschluss-Prüfung (B15, `tests/e2e/abschluss.spec.ts`): jede Hauptansicht in beiden Themes
  bei 1440 px und 390 px ohne axe-Verstöße (WCAG 2.1 AA inkl. Kontrast) und ohne Überlauf, dazu
  die Sicherheits-Header.
- Die CI (GitHub Actions) läuft ohne Zugangsdaten: Lint, Typecheck, Unit, Migrations-Audit,
  Build, Prod-Routen. Integration und E2E laufen lokal.


## Inhalt

| Datei | Zweck |
|---|---|
| `CLAUDE.md` | Feste Regeln für Claude Code in diesem Repo |
| `AGENTS.md` | Hinweis von Next.js für KI-Agenten (wird von `next dev` gepflegt) |
| `docs/02-design.md` | Design: Tokens, Muster, Ansichten |
| `docs/03-architektur.md` | Tech-Stack, Datenmodell, Sicherheit, KI-Schnittstelle, Backup |
| `supabase/migrations/` | Datenbankschema (nur über Migrationen ändern) |
| `src/` | App (Next.js), `src/features/` je Bereich der App |
| `tests/` | Unit-, Migrations-, Integrations- und E2E-Tests |
| `scripts/` | Migrationen, Prüfungen, Sicherung, Triskel-Ablage |

## Quellen

Das Video im Startbild („Supernova“) stammt von ESA/Hubble (L. Calçada) und steht laut
esahubble.org unter CC BY 4.0. Die Quellenangabe steht auch in der App (Einstellungen ›
Startbild).
