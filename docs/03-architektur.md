# Architektur

## Entscheidung: Hosting

**Supabase (EU, Frankfurt) + Vercel**, beide im kostenlosen Tarif.

| Kriterium | Supabase + Vercel (gewählt) | Uberspace / eigener Server |
|---|---|---|
| Wartung | Minimal, Updates macht der Anbieter | Du bist Admin |
| Login, Sicherheit | Fertig (Auth, MFA, Row Level Security) | Selbst bauen = Risiko |
| Handy / Web | Von überall erreichbar | Ebenfalls, mehr Aufwand |
| Datenhoheit | EU-Region, Export jederzeit | Maximal |
| Kosten | 0 € (später ggf. Supabase Pro ca. 25 $/Monat) | ca. 5–10 €/Monat |

Bekannte Grenzen des Gratis-Tarifs: Supabase pausiert Projekte nach 7 Tagen ohne Nutzung
(bei täglicher Nutzung kein Thema) und hat keine automatischen Backups. Deshalb eigenes
Backup (siehe unten). Ein Umzug auf eigenen Server bleibt möglich, weil es Standard-Postgres ist.

## Stack

- **Next.js** (App Router) + **TypeScript** + **Tailwind CSS** (Tokens als CSS-Variablen)
- **Supabase:** Postgres, Auth (E-Mail + Passwort, TOTP-MFA), Row Level Security, Realtime
- **TanStack Query** für Daten-Cache und optimistische Updates
- **dnd-kit** für Drag & Drop (Maus und Touch)
- **Editor:** TipTap 3 (WYSIWYG), ein Editor je Notiz mit eigenem Outline-Schema; gespeichert
  wird je Block (`note_blocks`) per Diff. Begründung und Details: `docs/plan-phase-1.md`, Abschnitt 1
- **PWA:** Manifest + Service Worker, installierbar auf iOS/Android
- **Qualität:** Biome (Lint/Format), Vitest, Playwright (Desktop + Mobil-Viewport 390 px)
- Aktuelle stabile Versionen verwenden.

## Datenmodell

Alle Tabellen: `id uuid`, `user_id`, `created_at`, `updated_at`, `deleted_at` (Soft-Delete),
RLS-Policy `user_id = auth.uid()`.

Stand nach Planfreigabe 10.10.2026 (Details und Migrationsdateien: `docs/plan-phase-1.md`, Abschnitt 2):

```
user_settings    theme, active_area_id, evening_time (Standard 20:00), last_export_at (B14)
areas            name, color (Token-Schlüssel orange|blue), sort     -- Beruf, Privat
topics           area_id, name, sort, archived_at                   -- Wissensthemen (dauerhaft)
projects         area_id, title, status, priority, start_date, target_date, time_budget_weeks (nur DB, E24),
                 why, outcome (jsonb Checkliste), links (jsonb [{id,name,url}], Migration 22),
                 body (jsonb TipTap) + body_text (Freitext im Reiter Übersicht, Migration 24),
                 next_task_id, last_activity_at, closing_reflection (jsonb), sort
milestones       project_id, title, due_date, done_at, sort
tasks            area_id (nur in der Inbox leer), project_id?, milestone_id?, title,
                 body (jsonb TipTap) + body_text, status, priority, due_date, scheduled_at,
                 duration_min, recurrence (RRULE), recurrence_source_id, focus_date,
                 in_inbox, completed_at, sort, edited_at (nur Titel/Notiz, Trigger, Migration 23)
task_dependencies task_id, blocked_by_task_id                       -- „Blockiert durch“, zyklenfrei
notes            area_id, topic_id?, project_id?, task_id?, type (Schlüssel aus note_types), title,
                 tags text[], reviewed_at, archived_at
note_types       key (fest, z. B. protokoll), name, sort  -- eigene Notiz-Typen (#34, Migration 25),
                 „idee“ = Standard (Migration 26, auch Spalten-Standard von notes.type);
                 Löschen per RPC delete_note_type (Zieltyp), restore_note_type
note_blocks      note_id, parent_id, content (jsonb TipTap) + content_text, sort, collapsed,
                 task_id?                                            -- Outliner-Baum
links            source_note_id, source_block_id, target_note_id    -- per Trigger aus noteLink-Knoten
task_note_links  task_id, target_note_id                            -- per Trigger aus noteLink in tasks.body
recaps           kind (woche|monat), period_start, period_end, mood, energy, sport, relations,
                 learning, answers (jsonb), focus_next (jsonb), themes text[],
                 questions (jsonb, Leitfragen-Schnappschuss, B12), stats (jsonb Snapshot), closed_at
templates        kind (projekt|notiz|rueckblick), note_type?, name, body (jsonb)
saved_views      entity (tasks|projects|notes), area_id?, name, view_type, config (jsonb)
ai_activity      client_id, tool, entity, entity_id, summary, undo (jsonb), undone_at  -- KI-Protokoll (#33)
ai_clients       client_id (uuid), name, revoked_at  -- freigegebene KI-Zugänge, nur aal2 (E28)
calendar_sources kind (ical|google, Migration 36), name, url (geheime iCal-Adresse, nur bei ical),
                 google_calendar_id (nur bei google, je Nutzer einmal ohne Papierkorb; Zurückholen
                 aus dem Papierkorb gewinnt, Migration 38), color
                 (Token-Schlüssel), enabled, sort  -- Kalender (Migration 30), nur aal2, nicht für KI
google_accounts  email (= ID des primären Kalenders), refresh_token_enc (AES-256-GCM, null nach
                 Trennen), scope, connected_at  -- eine Zeile je Nutzer (#64, Migration 36), KI liest nur
dateien (R2)     Cloudflare R2, Bucket triskel-dateien (privat, EU), Schlüssel
                 <alter bucket>/<user_id>/<owner_id>/<uuid>.<ext> mit <alter bucket> = note-images
                 (Bilder ≤ 10 MB, PNG/JPEG/WebP/GIF) oder attachments (alle Typen ≤ 100 MB);
                 <owner_id> = Notiz, Aufgabe, Projekt (Freitext, Migration 24) oder Vorlage
storage          Altbestand bis zum Live-Gang (E41): Supabase-Buckets note-images und attachments
                 mit denselben Pfaden <user_id>/<owner_id>/<datei>; seit Migration 44 nur noch
                 lesbar (Schreib-Policies gedroppt), werden nach 2 Wochen mit Rückfrage geleert
```

- `sort` ist Text (Fractional Indexing): Beim Verschieben ändert sich nur eine Zeile.
- Statuswerte als `text` + `check`, keine Postgres-Enums.
- Fällig- und Fokus-Tag als `date`, Zeitpunkte als `timestamptz`, Rechnen in `Europe/Berlin`.
- Volltextsuche über Postgres `tsvector` (Konfiguration `german`) auf Aufgaben, Notizen, Blöcken,
  Projekten (Titel, Warum, Link-Namen und -Adressen seit Migration 22, Freitext seit 24), Rückblicken; dazu
  `pg_trgm` für Teilwörter (Komposita).
- Wiederkehrende Aufgaben: Beim Erledigen (RPC `complete_task`) wird die nächste Instanz aus der
  RRULE erzeugt.
- Fortschritt Projekt = erledigte ÷ alle Aufgaben, berechnet in der View `v_projects`.
- `stats` im Rückblick wird beim Abschließen als Snapshot gespeichert, damit der Verlauf stabil bleibt
  (seit Migration 14 samt Tagesverlauf `activity` je Tag). Abschließen läuft als `rpc:close_recap`
  über die Speicher-Warteschlange.
- Bilder und Mermaid-Diagramme (E24/E25) sind atomare Knoten im Absatz eines Blocks (`noteImage
  {path, alt, width}`, `mermaid {code}`); `content_text` enthält Alternativtext bzw. Code (durchsuchbar).
- Dateien (#27, E26): `noteFile {path, name, size, mime, view: tile|full}`, Suchtext „[Datei: Name]“.
  Bilder und Dateien gibt es auch in der Aufgaben-Notiz (`tasks.body`), Ordner je Aufgabe.
  `width` am Bild = Prozent der Zeile (#28); Zuschneiden legt eine neue Datei an.
- Formatierung (#40, E31): Absatzart als `attrs.kind` am Absatz (`h1|h2|h3|quote|callout|divider`),
  Textfarbe (`textColor {color}`) und Marker (`marker {color}`) als Markierungen mit Token-Schlüsseln –
  in `note_blocks.content`, `tasks.body` und `projects.body` gleich.
- `custom_fields` entfällt vorerst.
- Seed-Daten (Bereiche, Vorlagen, Notiz-Typen seit Migration 25) legt ein Trigger auf `auth.users`
  beim Registrieren an.

## Supabase-Projekteinstellungen (bereits so angelegt)

- **„Automatically expose new tables“ ist AUS.** Jede Migration muss für neue Tabellen
  ausdrücklich `grant select, insert, update, delete on <tabelle> to authenticated;` setzen
  (kein Zugriff für `anon`).
- **„Automatic RLS“ ist AN.** Trotzdem in jeder Migration RLS explizit aktivieren und Policies schreiben.
- Region: EU.
- **Zwei Projekte:** `second-brain` (echte Daten) und `second-brain-test` (gleiche Einstellungen,
  zwei Testnutzer). Migrationen laufen immer zuerst im Testprojekt, Tests nie gegen echte Daten.

## Sicherheit

- Single-User: Nach Anlegen des eigenen Kontos werden Registrierungen in Supabase **deaktiviert**.
- Login mit E-Mail + Passwort, **TOTP-MFA** aktiv (Stufe 1, Baustein B16, seit 15.10.2026).
  Erzwungen dreifach: `src/proxy.ts` lässt nur `aal2` in die App (ohne Faktor → `/mfa/einrichten`,
  mit Faktor → `/mfa`), das App-Layout prüft `aal2` auf dem Server, und Migration 13 setzt eine
  restriktive RLS-Policy (`aal2`) auf alle Tabellen, auch für direkte API-Aufrufe (in Prod erst,
  wenn das eigene TOTP läuft; `db:push:prod` prüft das). Wiederherstellung: README „Zweiter Faktor“.
- Nur der *publishable/anon key* im Client; *service_role* nur in Vercel-/GitHub-Secrets.
- **Dateien in Cloudflare R2 (E41):** Bilder und Dateien liegen in einem privaten R2-Bucket
  (`triskel-dateien`, Gerichtsbarkeit EU; Tests `triskel-dateien-test`). Schlüssel
  `<alter bucket>/<user_id>/<owner_id>/<uuid>.<ext>`, die Pfade in den Inhalten
  (`noteImage`/`noteFile`) blieben beim Umzug unverändert. R2 kennt kein RLS, deshalb liegen
  **alle Prüfungen an einer Stelle: `src/features/storage/`** – `paths.ts` (eigener Pfad
  `isOwnPath`, Typ, Grenzen, `planUpload`), `config.ts` (Konfiguration, Prod-Schutz der Tests),
  `signing.ts` (S3-Signaturen mit `aws4fetch`), `client.ts` (HEAD/GET/PUT/Liste/Löschen vom
  Server), `access.ts` (Sitzung, Besitzer), `handlers.ts` (die fünf Routen). Der Browser
  spricht nur mit `POST /api/dateien/{links,hochladen,vorhanden,liste,loeschen}` (nur Sitzung
  `aal2` und eigene Origin, `cache-control: private, no-store`; ohne R2-Werte 503
  „Dateien sind hier nicht verfügbar“; Client `notes/media-api.ts`, Links gebündelt).
  *Ansehen:* kurzlebiger signierter GET-Link (5 min), der Browser holt die Datei direkt bei R2
  und macht daraus einen Blob (`BucketCache`, kein Link bleibt im DOM). *Hochladen:* die Route
  prüft Besitzer (Notiz/Aufgabe/Projekt/Vorlage gehört dem Nutzer, per RLS mit dem Token des
  Nutzers gelesen), Typ und Größe und gibt einen signierten PUT-Link (5 min, KI 1 h), der
  **genau diese Größe und diesen Typ** erlaubt – R2 lehnt alles andere ab (Integrationstest). Der
  Pfad kommt vom Server; die UUID darf der Client vorgeben (der Editor setzt den Pfad vor dem
  Hochladen in den Inhalt). **Hochladen überschreibt nie** (wie `upsert: false` bei Supabase):
  liegt unter dem Pfad schon eine Datei, gibt es keinen Link (409); Server-PUTs der KI und ihre
  Hochlade-Links tragen `if-none-match: *` (R2 lehnt einen vorhandenen Schlüssel mit 412 ab, ein
  KI-Link nimmt genau eine Datei an). Restrisiko nur in der App: ein zweiter PUT an denselben
  Link innerhalb von 5 min (der Browser darf den Kopf wegen CORS nicht senden). *Löschen* (`liste`/`loeschen`, Papierkorb endgültig leeren,
  `removeUnusedMedia`) nur aus der App mit aal2 – **die KI löscht und listet nie**
  (`actor: "ai"` wird mit 403 abgewiesen, es gibt kein Löschwerkzeug). Nie `service_role`.
  KI und Export lesen/schreiben über den Server (`ai/server/r2.ts`: `authorizeAi` =
  `ai_client_allowed()`, `isOwnPath`, Besitzerprüfung). **CSP:** `connect-src` um genau den
  R2-Ursprung `https://<konto>.eu.r2.cloudflarestorage.com` (`r2ConnectOrigin()`); `img-src`
  bleibt `blob:`. **Grenzen:** Dateien 100 MB, Bilder 10 MB (nach dem Verkleinern auf 2000 px),
  KI-Upload per Chat (`inhalt_base64`) 2,5 MB (Vercel-Anfragegrenze), `get_attachment` liest
  PDF-Text nur bis 25 MB (darüber ein Hinweis), Notion-Download der KI bis 50 MB (Funktion mit
  `maxDuration` 60 s, Datei im Speicher). **Lokaler `npm run dev`** (Prod-Daten) bekommt keinen
  R2-Schlüssel (Regel 3): Dateien erscheinen als „nicht verfügbar“, Arbeit an Dateien läuft
  über den Testserver. **Umzug und Altbestand:** `scripts/r2-umzug.mts` kopiert die Supabase-
  Buckets nach R2 (`--ignore-existing`, danach Prüfung, nie löschen); Migration 44 schließt die
  Schreib-Policies der alten Buckets (Lesen bleibt, damit ein alter Tab weiter anzeigt, nichts
  landet an zwei Orten). **Sicherung/Wiederherstellen:** siehe „Backup und Export“.
- *Altbestand bis zum Live-Gang (Storage in Supabase, Bilder Migration 18, Dateien Migration 19):*
  private Buckets, Policies nur für den eigenen
  Ordner (`storage.foldername(name)[1] = auth.uid()`) plus restriktive aal2-Policy – gilt für das
  Lesen der Altdateien weiter, Schreiben ist seit Migration 44 zu. Die App lädt
  Bilder und Dateien als Blob (CSP `img-src blob:`), es gibt keine öffentlichen Links.
  Im Browser geöffnet werden nur PDFs (Blob-Typ fest `application/pdf`); alle
  anderen Dateien werden heruntergeladen, damit z. B. HTML/SVG nie als Seite im eigenen Ursprung
  läuft. pdf.js zeichnet PDFs in einem Worker (CSP `worker-src 'self'`). iPhone-Fotos (HEIC, #39)
  wandelt der Browser beim Einfügen in JPEG: Safari selbst, sonst `heic-to/csp` (libheif als
  JavaScript, ohne eval und WebAssembly, erst beim ersten HEIC geladen) – sein Worker kommt aus
  einem Blob, deshalb `worker-src 'self' blob:`.
- Projekt-Links (Migration 22): App und KI-Werkzeuge nehmen nur http(s) und mailto an
  (`normalizeLinkUrl`), die Ansicht prüft beim Anzeigen erneut – `javascript:` wird nie ein Link.
- Sicherheits-Header: CSP mit Nonce je Anfrage aus `src/proxy.ts` (`'strict-dynamic'`, Styles
  `'unsafe-inline'`, `connect-src` nur Supabase, `frame-ancestors 'none'`), feste Header (HSTS,
  nosniff, X-Frame-Options, Referrer-/Permissions-Policy) aus `next.config.ts`.
- Google-Kalender (#64, Migration 36): Refresh-Token nur verschlüsselt (AES-256-GCM,
  `GOOGLE_TOKEN_KEY` nur in Vercel), Anmeldung mit state + PKCE im httpOnly-Cookie, feste
  Google-Adressen, KI nur lesend – Abschnitt „Google-Kalender“ unten.

## Öffentliche Freigabe (#94, E42)

Konzept: `docs/konzept-freigabe.md`. Einzige Stelle, an der die App Daten ohne Anmeldung zeigt –
nur **eine Notiz lesend per Link**, keine Konten, kein Bearbeiten.

- **Tabelle `note_shares`** (Migration 45): `note_id` (cascade), `token` (43 Zeichen base64url aus
  32 Zufallsbytes, per `check`, eindeutig), `revoked_at`, dazu die üblichen Spalten. Höchstens eine
  aktive Freigabe je Notiz (partieller Unique-Index); Trigger `note_shares_own_note`: nur eigene
  Notizen. RLS + aal2 wie jede Tabelle, nie an anon, **nicht für die KI** (nicht in `AI_TABLES`:
  sie sieht, legt an und beendet keine Freigaben). **Freigegebene Notizen ändert die KI nicht**
  (Migration 46): die Werkzeuge prüfen vorher `note_share_active(note_id)` (security definer,
  stable, nur eigene Notizen, nur aal2/KI-Zugang, nur boolean; `ai/server/shares.ts`), „fetch“
  zeigt den Hinweis; der Trigger `note_shares_guard_ai` sperrt für Anfragen ohne aal2 Titel und
  Blöcke (insert/update/delete) mit derselben Meldung – App, Migrationen, Restore unberührt.
  Beenden = `revoked_at` (Rückgängig), neues Freigeben = neuer Token. Export ohne Token (wie die
  iCal-Adresse), die Sicherung enthält alles.
- **Lesen ohne Anmeldung nur über zwei `security definer`-Funktionen** (`stable`, `search_path`
  leer, im Audit als `PUBLIC_RPC_ALLOWLIST` – die einzigen mit `grant execute … to anon`; der
  Audit verbietet `alter function`, die Simulation prüft `prosecdef`/`provolatile`/`search_path`):
  `shared_note(token)` → `{title, blocks}` (ohne Eigenschaften und `content_text`, Inhalt nur
  über die Positivliste `shared_block_content` – Verweise ohne Ziel-ID –, `task_done` statt
  Aufgabe) und `shared_note_file(token, pfad)` → Bucket, nur für Bilder/
  Dateien in nicht gelöschten Blöcken der Notiz im Ordner des Besitzers. Beide verlangen eine
  aktive Freigabe einer nicht gelöschten Notiz desselben Nutzers (Papierkorb → `null`).
- **Seite `/freigabe/<token>`** (außerhalb von `(app)`, keine Shell): Server-Komponente ruft
  `shared_note` mit dem publishable key ohne Cookies (`lib/supabase/anon.ts`), Darstellung als
  reine Funktion aus dem Blockbaum (`features/share/components/shared-outline.tsx`, nie rohes
  HTML, Links nur über `normalizeLinkUrl`). Unbekannt/beendet/Papierkorb → dieselbe 404.
- **Dateien** `GET /api/freigabe/<token>/datei?pfad=…` (`features/storage/shared.ts`): Format prüfen,
  `shared_note_file`, dann 302 auf einen signierten R2-GET-Link (5 min) mit festem Typ
  (`response-content-type`/`-disposition`: Bilder inline als Bildtyp, PDF inline, sonst
  Herunterladen mit Namen aus der Notiz und der Endung des Pfads). Nie `service_role`.
- **Kopfzeilen** für `/freigabe/*` und `/api/freigabe/*` (`SHARE_HEADERS`): `X-Robots-Tag:
  noindex, nofollow`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`; die CSP
  erlaubt nur dort zusätzlich den R2-Ursprung in `img-src` (`r2Images`). Routenschutz über
  `SHARE_PREFIXES` in `PUBLIC_PREFIXES`.

## Google-Kalender (#64, E35)

Mit Anmeldung bei Google liest und bearbeitet die App Termine dort, wo sie liegen (Konzept:
`docs/konzept-google-kalender.md`). Stand N1d: verbinden, Token, Kalenderliste, Lesen über die
Schnittstelle, Termine verschieben/Dauer ändern sowie anlegen, Texte ändern, Kalender wechseln,
löschen und wiederherstellen – in der App und über die KI-Werkzeuge (Abschnitt „KI-Schnittstelle“).

```
Einstellungen › Kalender ──Link──▶ GET /api/google/start (aal2) ──303──▶ accounts.google.com
                                     Cookie sz-google-oauth (state + PKCE, verschlüsselt, 10 min)
accounts.google.com ──303──▶ GET /api/google/callback (Sitzung, SameSite=Lax) ──▶ oauth2.googleapis.com/token
                                     prüft state/Nutzer/Ablauf, beide Berechtigungen, Refresh-Token
                                     ──▶ calendarList (E-Mail = primärer Kalender) ──▶ google_accounts
```

- **Routen** (`src/app/api/google/`, Logik in `src/features/calendar/google/`): `start`,
  `callback` (Rücksprung `redirect_uri` in Produktion fest
  `https://deine-app.vercel.app/api/google/callback` – `googleRedirectOrigin`, nie
  aus Host/`x-forwarded-host`; über eine andere Adresse geöffnet, wechselt `start` einmal dorthin),
  `POST disconnect` (Widerruf bei Google, Token leeren + `deleted_at`, Termin-Cache leeren; Origin-Prüfung),
  `status` (eingerichtet, verbunden, E-Mail – fragt Google nicht), `calendars` (Kalenderliste;
  `state: "reconnect"`, wenn Google den Zugang ablehnt). Alle nur mit aal2, `no-store`.
- **Zugang:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` nur in Vercel
  (Production), beim Lesen getrimmt; der Schlüssel muss base64 und 32 Byte sein, sonst zeigt die
  App „nicht eingerichtet“ mit dem Namen der Variable (nie Werte). Berechtigungen nur
  `calendar.events` und `calendar.calendarlist.readonly`, `access_type=offline`, `prompt=consent`.
- **Token:** Der Refresh-Token liegt nur verschlüsselt in `google_accounts` (AES-256-GCM, zufälliger
  IV, Format `v1:iv:tag:daten`, Nutzer-ID als AAD – nicht in eine andere Zeile kopierbar); ein
  Zugriffs-Token entsteht je Anfrage per Refresh und wird nie gespeichert oder ausgegeben.
  Lehnt Google ab (400/401: widerrufen, abgelaufen) oder passt der Schlüssel nicht → „Neu
  verbinden“. Geschrieben wird mit der Sitzung des Nutzers (RLS), nie service_role.
- **Adressen:** fest im Code (`accounts.google.com`, `oauth2.googleapis.com`,
  `www.googleapis.com/calendar/v3`), IDs je Pfadteil kodiert (`apiPath`; „.“/„..“ und leere Teile
  verboten, Termin-IDs nie nur Punkte – G-3). Nur mit `NODE_ENV=test` lenken
  `GOOGLE_OAUTH_BASE`/`GOOGLE_API_BASE` auf den Google-Ersatz `/dev/google` (OAuth mit
  PKCE-Prüfung, Kalenderliste, Termine mit etag/If-Match, Steuerung `_test/*`; in Produktion 404).
  Die CSP braucht nichts: Google spricht nur der Server an, der Browser folgt einer Weiterleitung
  nach einem Link (kein Formular – `form-action 'self'`).
- **KI:** `google_accounts` ist für freigegebene KI-Zugänge nur lesbar (`AI_TABLES` +
  `AI_READ_ONLY_TABLES`, Sperren `_insert/_update/_delete_mfa`) – die Termin-Werkzeuge (N1d,
  `ai/server/google.ts`: `getGoogleAccess` mit dem KI-Client, getestet mit echtem aal1-Token)
  brauchen den verschlüsselten Token; verbinden und trennen nur in der App. Nicht im Export, nicht
  in der Suche; die nächtliche Sicherung enthält den Token nur verschlüsselt.
- **calendar_sources:** Google-Kalender sind Zeilen `kind = google` ohne Adresse, mit fester ID je
  Nutzer und Kalender (`googleSourceId`, G-4: zwei Geräte treffen dieselbe Zeile, „anzeigen“ holt
  sie aus dem Papierkorb zurück). Wird eine Zeile aus dem Papierkorb geholt, während derselbe
  Kalender schon eine lebende Zeile hat, wandert diese in den Papierkorb (Trigger, Migration 38).
  Eine iCal-Adresse `…/calendar/ical/<ID>/…`, deren Kalender eingeschaltet ist, gilt als „ersetzt
  durch Google“ (`icalReplacedByGoogle`).
- **Lesen (N1b):** `GET /api/kalender` lädt alle eingeschalteten Quellen über `loadAllSources`
  (`src/features/calendar/server/load-all.ts`): Google-Kalender per `events.list`
  (`singleEvents=true`, Zeitraum, Seiten, `google/events-api.ts`), normalisiert in
  `google/events.ts` auf `CalendarEvent` + `google` (`eventId`, `etag`, `editable`,
  `recurringEventId`, Zone). Ersetzte iCal-Quellen werden nicht geladen; ohne Verbindung (oder nicht
  eingerichtet) schweigen die Google-Zeilen und iCal läuft wie vorher; bei „neu verbinden“/Fehler
  steht ein Status je Quelle (`reconnect: true`) und die ersetzte iCal-Quelle springt ein. Cache
  der Google-Antworten 60 s im Speicher der Instanz (Schlüssel Nutzer + Kalender + Zeitraum,
  höchstens 200 Einträge, Abgelaufenes fliegt beim Merken raus); `frisch=1`, jede Änderung,
  Verbinden und Trennen leeren den Cache des Nutzers.
- **Verschieben (N1b):** `PATCH /api/kalender/termin` (aal2, Origin-Prüfung, Eingabe in
  `google/patch-input.ts`) → `events.patch` mit `If-Match` (etag) und `sendUpdates=none`, nur
  `start`/`end` (bei Terminen mit Uhrzeit mit `timeZone`; das jeweils andere Feld `date`/`dateTime`
  ausdrücklich `null`, weil Google verschachtelte Felder zusammenführt – G-6); Antwort `{ ok, etag }`, Fehler 412
  `{ conflict }`, 409 `{ state: "reconnect" }`, 403, 404 `{ gone }`. Client: `event-move.ts`
  (sofort anzeigen, Toast mit Rückgängig, je Termin nacheinander mit dem jeweils neuen etag),
  Zeitrechnung in `move.ts`.
- **Anlegen, Ändern, Löschen (N1c):** Routen unter `/api/kalender/termin` – `POST` (anlegen →
  `{ ok, event }`, normalisiert), `PATCH` (Zeit und/oder `summary`/`location`/`description`;
  Gäste und Co. nimmt die Eingabe nicht an), `DELETE` (löschen, optional mit `etag`),
  `POST …/verschieben-kalender` (`events.move`, `If-Match`), `POST …/wiederherstellen`
  (Rückgängig von „löschen“: `events.patch` mit `status: "confirmed"`, sonst `events.insert` mit
  den gespeicherten Angaben; Antwort `how: same | new`). Alle mit `sendUpdates=none`, aal2,
  Origin-Prüfung. Aufbau: Eingabeprüfung rein (`google/patch-input.ts`, `google/event-input.ts`),
  Aufrufe an Google (`google/events-api.ts`), **Dienstschicht** `server/event-service.ts`
  (`createEvent`, `updateEvent`, `removeEvent`, `moveEventToCalendar`, `restoreEvent` – nehmen
  Zugriffs-Token und Quelle fertig entgegen, kennen keine Anfrage: die KI-Werkzeuge in N1d rufen
  dieselben Funktionen) und Routen-Unterbau `server/termin-route.ts` (Sitzung, Quelle, Zugang,
  Fehlerabbildung). `GET /api/kalender` meldet je Google-Quelle `writable` und `primary`. Client:
  `event-edit.ts` (sofort anzeigen, Rückgängig, Ketten je Termin gemeinsam mit `event-move.ts` über
  `event-cache.ts`), Rechnung in `event-create.ts`. Google-Ersatz: Papierkorb (`status: confirmed`
  holt zurück), `_test/state` mit `ops`/`trash`, `_test/add-calendar`, `_test/purge-trash`.

## KI-Schnittstelle (#33, E27)

Claude (Web, Desktop, iPhone, Claude Code) und ChatGPT arbeiten über **MCP** mit der App:
suchen, lesen, anlegen, ändern, **in den Papierkorb legen nur nach Rückfrage** (E29) – endgültig
löschen nur in der App.

```
Claude/ChatGPT ──POST /api/mcp (Bearer)──▶ Next.js-Route (Vercel fra1, MCP-SDK v2, zustandslos)
      │ 401 + resource_metadata                    │ supabase-js mit DEM Token des Nutzers
      ▼                                            ▼
/.well-known/oauth-protected-resource      PostgREST/RPC/Storage: RLS (aal2 ODER Freigabe) + Trigger
      │ authorization_servers
      ▼
Supabase OAuth-2.1-Server (Beta) ──▶ /ki-zugang in der App (Login + TOTP, „Erlauben“)
```

**Kein Rate-Limit an `/api/mcp`** (Review Teil B, K-8, nur dokumentiert): Jeder wohlgeformte
Bearer-Token löst `getClaims`/`getUser` beim Auth-Server aus, auch ein ungültiger. Größe ist durch
das SDK (~4 MiB) und zod begrenzt, Folge nur Kosten/Last (Vercel-Aufrufe, Auth-Anfragen). Bei
Bedarf: Zähler je IP in Vercel KV/Upstash vor der Token-Prüfung – erst, wenn es im Dashboard
auffällt.

- **Anmeldung:** Supabase ist der Authorization Server (PKCE S256, Tokens = Supabase-JWTs ES256
  mit Claims `client_id` und `session_id`, 1 h gültig, Refresh). In Prod gibt es **nur
  vertrauliche Clients**, die der Nutzer im Dashboard anlegt (Selbst-Registrierung aus); Client-ID
  und Geheimnis stehen nur in den Einstellungen der KI. Die Freigabe-Seite `/ki-zugang` ist wie
  die App nur mit `aal2` erreichbar (Proxy + Server-Prüfung), trägt beim „Erlauben“ den Client in
  `ai_clients` ein und ruft dann `auth.oauth.approveAuthorization` (bzw. `denyAuthorization`);
  weitergeleitet wird nur nach https.
- **Sicherheitsmodell (E28, „Fall B“):** Supabase stellt KI-Tokens immer mit `aal1` aus und lässt
  das Erlauben schon mit dem Passwort zu. Daten sieht ein Token deshalb nur über
  `ai_client_allowed()` (Migration 21): Client freigegeben (`ai_clients`, nur mit aal2 änderbar)
  und nicht getrennt, **vertraulich** (ohne Geheimnis kein Token) und seine Sitzung besteht
  noch. Die MFA-Policies der Inhalte für die Werkzeuge und der zwei Buckets lauten „aal2 ODER
  freigegebener KI-Zugang“; Einstellungen, Vorlagen, Ansichten und `ai_clients` bleiben reines
  aal2, das KI-Protokoll kann die KI nur ergänzen. Wer nur das Passwort kennt, kann weder
  freigeben noch ein Token für einen freigegebenen Client tauschen (Geheimnis fehlt). Die
  MCP-Route nimmt nur Tokens mit `client_id`, prüft je Anfrage `auth.getUser` und die Freigabe;
  „Trennen“ (Freigabe zurück + Zugang beim Auth-Server) sperrt **sofort**, auch direkt gegen die
  Datenbank. Dauertest: `tests/integration/oauth.test.ts`. **Kein service_role** (nur die
  öffentlichen Variablen).
- **Werkzeuge** (`src/features/ai/server/tools/`): `overview`, `search` (`search_all`), `fetch`
  (Projekt/Aufgabe/Notiz/Rückblick als Markdown wie der Export), `list_tasks|notes|projects`,
  `create_/update_note`, `create_/update_task` (Erledigen über `complete_task`), `capture`,
  `create_/update_project` (Fahrplan in einem Aufruf), `list_recaps`, `create_/update_recap`
  (Wochen-/Monatsrückblick anlegen und Antworten/Werte/Fokus/Themen ändern, Texte angehängt;
  Migrationen 32 + 34), `attach_file` (Notion-Download-Hosts,
  ≤ 50 MB, jede Weiterleitung geprüft – oder Verweis `upload` aus `prepare_upload`),
  `prepare_upload` (#51, E33, E41: Pflichtangabe `groesse`, signierter R2-PUT-Link für
  `<user>/<notiz|aufgabe>/<uuid>.<ext>`, 1 h, erlaubt genau diese Größe und diesen Typ und nur
  einen PUT mit `If-None-Match: *`; der
  Server ruft dabei keine fremde Adresse ab, `attach_file` prüft den Verweis per HEAD gegen
  Nutzer, Ziel, Größe und Typ), `list_events|create_event|update_event|delete_event` (Google-Termine, N1d,
  siehe unten), `trash` (nur per ID, nur `deleted_at` wie in der App,
  zerstörerisch markiert → Claude/ChatGPT fragen vorher). Namen statt IDs gehen sonst auch;
  unklare Namen → Rückfrage. Jedes `id`-Feld nimmt auch einen kopierten App-Link (#47,
  „Link kopieren“: `…/wissen/<id>`, `…/projekte/<id>`, `…?aufgabe=<id>`; `idFromLink`); Anleitung
  (`aiInstructions(origin)`) und „fetch“ nennen die Adresse der App: solche Links nie im Browser öffnen;
  Adressen aus einer Quelle (`src/lib/app-links.ts`). `create_/update_project` pflegen auch die
  Links des Steckbriefs (`links`, `links_hinzu`, `links_entfernen`).
- **Google-Termine (N1d, `tools/calendar.ts`):** `list_events` (Zeitraum, Standard heute + 7 Tage,
  höchstens 62; je Termin Kalender- und Termin-ID, Zeit Europe/Berlin, Ort, änderbar, Serie; ohne
  Verbindung eine klare Antwort statt Fehler), `create_event` (Standard Hauptkalender, nur mit
  Schreibrecht), `update_event` (Zeit/Dauer/ganztägig, Titel, Ort, Beschreibung, `kalender_neu`;
  etag/If-Match, bei Serien nur der eine Termin, Kalenderwechsel nicht bei Serien; den Ursprungstermin
  einer Serie – Termin mit `recurrence` – ändern und löschen beide nie, G-1) und `delete_event`
  (zerstörerisch markiert, Beschreibung und Anleitung wie `trash`: nur nach Bestätigung im Chat).
  Dieselben Dienste wie die App (`calendar/server/event-service.ts`, Eingabeprüfung aus
  `calendar/google/`), immer `sendUpdates=none`. Die Kalender kommen aus Googles Kalenderliste
  (`ai/server/google.ts`: `openGoogle`, `pickCalendar` nach ID, Name oder „primär“) – nie aus
  `calendar_sources` (geheime iCal-Adressen, für KI-Tokens unlesbar). Fehler von Google als Text für
  die KI (412 → „neu lesen mit list_events“). Zeitrechnung rein in `ai/server/event-times.ts`.
  **Protokoll:** Eintrag mit `entity = 'termin'` (Migration 37 erweitert nur den Wertebereich;
  `entity_id` leer, Google-IDs sind keine UUID) und `undo` aus `ai/event-undo-model.ts`:
  `event_create` (→ löschen mit dem etag nach dem Anlegen, G-7), `event_update` (etag nach der Änderung, Vorwerte nur der geänderten
  Felder, `moved_from` bei Kalenderwechsel), `event_delete` (ganzer Termin zum Wiederherstellen),
  je mit `date` für den Link auf den Tag. **Rückgängig** läuft in der App, nicht über die
  Speicher-Warteschlange: `ai/event-undo.ts` ruft `/api/kalender/termin` (löschen, alte Werte),
  `…/verschieben-kalender` und `…/wiederherstellen` auf; die Google-Kalender-ID ordnet es über
  `calendar_sources` der Quelle zu. Konflikt (seit der KI-Änderung in Google geändert), nicht
  verbunden, Termin weg → verständliche Meldung, der Eintrag bleibt offen (`undone_at` erst nach
  Erfolg). Tests: `tests/integration/ai-google.test.ts` (Google-Ersatz im Testprozess, echtes
  KI-Token), `ai/event-undo.test.ts`, `ai/server/event-times.test.ts`, E2E in `google-konto.spec.ts`.
- **Inhalt:** Notizen als verschachtelte Markdown-Liste ↔ `note_blocks` (`paste.ts`,
  `serializer.ts`, `ai/model/`); `- [ ]` wird ein Aufgaben-Block wie „Block → Aufgabe“.
  „Ersetzen“ löscht Blöcke nur weich.
- **KI-Protokoll** `ai_activity` (Migration 20): je Schreibaktion Client, Werkzeug, Eintrag,
  Zusammenfassung und Rückgängig-Daten. Einstellungen › KI-Zugänge zeigt die letzten 20 mit
  „Rückgängig“ (über die Speicher-Warteschlange, bei Terminen über die Termin-Routen) sowie die
  Zugänge mit „Trennen“.

## Backup und Export

- **In der App (B14):** Einstellungen › Export erstellt im Browser ein ZIP: Obsidian-Vault (Projekte
  mit Fahrplan, Aufgaben, Notizen, Rückblicke, Bilder und Dateien unter `Anhänge/`, auch aus
  Aufgaben-Notizen; Felder als YAML-Frontmatter)
  plus `export.json` mit allen Zeilen aller Tabellen (auch Papierkorb). Der abgeschlossene
  Wochenrückblick nennt den letzten Export (`user_settings.last_export_at`).
- **Nächtlich (E32, aus Stufe 2 vorgezogen, statt der früher geplanten GitHub Action):** Der Mac
  sichert per launchd (`scripts/backup-install.sh`, stündlich, einmal je Nacht ab 02:00, holt
  nach dem Schlafen nach) mit `scripts/backup-nightly.mts`: `pg_dump` des Schemas `public` im
  selben Schnappschuss wie die Zeilenzahlen (`pg_export_snapshot`), dazu ein inkrementeller
  Spiegel der Dateien (rclone `copy`, nie `sync`; Pfade sind unveränderlich –
  `userId/ownerId/uuid.ext`) und je Stand eine Datei-Liste. Quelle ist R2 (Bucket
  `triskel-dateien`, Nur-Lesen-Token `R2_BACKUP_*`); **im Übergang zusätzlich** die alten
  Supabase-Buckets über den S3-Schlüssel, solange `SUPABASE_S3_*` gesetzt ist – das Manifest ist je
  alter Bucket die Vereinigung nach Pfad (Größenkonflikt = Fehler vor dem Kopieren), Spiegel
  `dateien/<bucket>/`. Ablage
  `.backups/nachts/prod/` und eigener Google-Drive-Ordner „Triskel-Backup“, nach dem
  Hochladen geprüft (`rclone check`). Aufbewahrung 30 Tage täglich + 12 Monatsstände, nie
  Dateien löschen. Erfolg in `user_settings.last_backup_at`/`last_backup_summary` (Migration 27)
  → Hinweis auf Heute nach 36 h; Fehler als Mac-Mitteilung. Wiederherstellen mit
  `scripts/backup-restore.mts` (eine Transaktion, Trigger/Fremdschlüssel während des Ladens aus
  über `session_replication_role = replica`, Zeilenprüfung vor dem Commit, Sicherheits-Dump des
  Ziels; neues Projekt über `--nutzer ALT=NEU`). Probe: `tests/integration/backup-restore.test.ts`.
  Wiederherstellen schreibt die Dateien nach R2 – in Prod nur mit einem eigenen
  Schreib-Token `R2_RESTORE_*` (im Ernstfall anlegen, README), sonst Abbruch vor jeder Änderung.
  **Zugänge:** `SUPABASE_DB_URL` und der R2-Nur-Lesen-Token `R2_BACKUP_*` nur in `.env.local`
  (Regel 3); der Supabase-S3-Schlüssel (Vollzugriff auf Storage, umgeht RLS) und der befristete
  Umzugs-Token `R2_MIGRATE_*` nur bis zum Widerruf. Nicht gesichert: `auth` (Konto, TOTP) und `storage.objects`-Metadaten – beim
  Wiederherstellen entstehen sie neu (Konto anlegen, Dateien hochladen).

## Umgebungen

- Stufe 1: lokale Entwicklung (kein Docker nötig). Tests gegen `second-brain-test`, die App
  gegen `second-brain`. Seit 15.10.2026 (B16, vorgezogen) Vercel-Deploy aus `main`:
  https://deine-app.vercel.app, Funktionen in `fra1` (`vercel.json`), nur die
  zwei `NEXT_PUBLIC_…`-Variablen in Vercel. Preview-Deployments nutzen dieselben (Prod-)Variablen,
  deshalb laufen E2E-Tests nicht gegen Vercel, sondern lokal gegen das Testprojekt.
