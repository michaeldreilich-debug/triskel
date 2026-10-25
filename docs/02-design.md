# Design-Spezifikation

**Visuelle Vorlage:** `design/entwurf/*.html` (Entwurf vom 10.10.2026). Die Dateien sind
Ansichts-Mockups in einem Design-Tool-Format: als **Bild-/Layout-Vorlage** lesen, nicht als
Code übernehmen. **Feinschliff (#23, 16.10.2026):** `design/feinschliff/index.html` zeigt den
Stand davor (Aufnahmen) neben dem Vorschlag; die Muster stehen unten im **Muster-Katalog**.

## Gewählte Richtung: Mischung A + B + C

- **A – Dunkel (Standard):** `02-Heute-A-dunkel.html` und alle anderen Ansichten.
  Dicht, ruhig, monochrom, Bereichsfarben als Punkte.
- **B – Papier (heller Modus):** `03-Heute-B-papier.html`. Warmes Papierweiß, Überschriften in
  Serifenschrift (Newsreader), sonst wie A. Umschaltbar.
- **C – Fokusmodus (Stufe 2):** `04-Heute-C-fokus.html`. Schmale Icon-Leiste, nur die 3
  Fokus-Aufgaben groß, alles andere eingeklappt. Per Tastenkürzel (z. B. `F`) ein-/ausschalten.

## Schrift

- UI/Text: **Geist**, Papier-Überschriften: **Newsreader**
- Zahlen und Daten: **Geist mit gleich breiten Ziffern** (`tabular-nums`); **Geist Mono** nur noch
  für Tastenkürzel und Code (geändert 11.10.2026 mit dem Nutzer: Mono wirkte bei Daten technisch)
- Größen: 11–12 (Meta, Labels in Versalien mit Sperrung) · 13–14 (UI) · 15–16 (Text) · 26–34 (Seitentitel)

## Bereichsfarben

- Beruf `#F0883E` (dunkel) / `#C2410C` (hell)
- Privat `#7AA2F7` (dunkel) / `#2457C5` (hell)
- Nur als Punkt, Linie, Fortschrittsring/-balken oder Textakzent – nie als Fläche.
- Orange bedeutet **nur** Beruf: „überfällig“ ist rot (`--danger`), nicht orange (#23).
- „Nächster Schritt“-Box: dunkles Orange (`#1A1612` Fläche, `#5C3A1E` Rahmen, `#F0A86A` Label)

## Prinzipien

1. **Inhalt zuerst.** Die Oberfläche tritt zurück; Farbe nur, wo sie Bedeutung trägt.
2. **Tastatur zuerst** am Desktop, **Daumen zuerst** am Handy.
3. **Ruhe statt Effekte.** Keine Verläufe, kein Glas-Effekt, keine großen Schatten.
4. **Schnell fühlt sich gut an.** Jede Aktion reagiert sofort (optimistisch), Ladezustände als Skeleton.
5. **Konsistenz.** Jeder Wert kommt aus einem Token.

## Farb-Tokens

| Token | Dark (Standard) | Papier (hell) |
|---|---|---|
| `--bg` | `#0A0A0B` | `#F6F4EF` |
| `--sidebar` | `#0E0E10` | `#F6F4EF` |
| `--surface` | `#141416` | `#FFFFFF` |
| `--surface-2` | `#1C1C1F` | `#EFECE5` |
| `--border` | `#26262A` | `#E4E0D7` |
| `--border-strong` (Pillen, Tags; ergänzt 11.10.2026 aus Entwurf 08) | `#3A3A40` | `#D3CDC1` |
| `--text` | `#EDEDEF` | `#1C1B19` |
| `--text-muted` | `#A1A1AA` | `#55524B` |
| `--text-faint` | `#8B8B93` | `#6E6A61` |
| `--accent` (aktiv, Auswahl) | `#EDEDEF` (helle Pille) | `#1C1B19` (dunkle Pille) |
| `--success` | `#3FB950` | `#1F883D` |
| `--warning` (Papier 17.10.2026 von `#9A6700` abgedunkelt: 4,4 → 5,0 : 1, WCAG AA) | `#D29922` | `#8F5F00` |
| `--danger` | `#F85149` | `#CF222E` |
| `--link` / `--link-line` (Notiz-Links im Outliner; ergänzt 11.10.2026 aus Entwurf 08) | `#9DB9F7` / `#3F5A8F` | `#2457C5` / `#A9BEE8` |
| `--qr-bg` (QR-Code der MFA-Einrichtung, Ruhezone für Scanner; ergänzt 15.10.2026, B16) | `#FFFFFF` | `#FFFFFF` |

Aktive Navigation und Umschalter: helle Pille (dunkel) bzw. dunkle Pille (hell), wie im Entwurf.
Status und Tags als umrandete Pillen, nicht gefüllt.

## Raster und Formen

- Abstände im 4-px-Raster: 4 · 8 · 12 · 16 · 24 · 32 · 48
- Radius: 6 (Buttons, Inputs, Pillen) · 10 (Karten, Panels) · 14 (Sheets auf Mobil)
- Rahmen 1 px `--border`; Schatten nur bei schwebenden Elementen (Menüs, Palette), dezent
- Icons: **Lucide**, 16 px, Strichstärke 1.5

## Bewegung

- 120–180 ms, ease-out; keine Federn, kein Hüpfen
- Ein-/Ausklappen und Drag & Drop animiert, alles andere sofort
- `prefers-reduced-motion` wird respektiert
- **Ausnahme Startbild (E45, #102):** einmal am Tag beim ersten Öffnen von Heute ein Vollbild-Video
  (Supernova der ESA) mit Leitsätzen (Beispiele) in Newsreader, danach Ausklang ins Helle und in die
  Seite darunter (`features/intro/`, `src/styles/daily-intro.css`). Immer Nacht in beiden Themes
  (Tokens `--intro-*`), Text über abgedunkeltem Video mit weichem Schatten, Werte in Versalien mit
  Sperrung und Bernstein-Strich („Säulen“), „Los geht’s“ mit Zündschnur. Jederzeit überspringbar,
  bei „Bewegung reduzieren“ ein Standbild. Sonst gilt weiter „Ruhe statt Effekte“.

## Layout Desktop (≥ 1024 px)

- **Sidebar links** 248 px, einklappbar (Knopf oben rechts, ⌘\): Logo · Bereichs-Schalter · Suche (⌘K) + Neu ·
  Heute · Inbox · Woche · Wissen · Rückblicke · Aktive Projekte · Datenbanken · gespeicherte Ansichten
- **Inhalt Mitte:** volle Breite (Rückmeldung #20), höchstens einzelne Eingabefelder begrenzt
- **Projektseite:** Steckbrief-Spalte links, Standard 344 px, am rechten Rand ziehbar 280–640 px
  (Pfeiltasten, Doppelklick = Standard; je Gerät gemerkt, #43), oben rechts einklappbar zum Reiter
  „Steckbrief“ (#80), rechts Reiter (kein langes Scrollen)
- **Wissen:** Themen | Notizliste | Notiz ab 1280 px (`xl`); die Verknüpfungs-Spalte erst ab
  2200 px (`4xl`), sonst stehen die Rückverweise unter der Notiz. Themen (240 px, 192–480),
  Notizliste (320 px, 256–640) und Verknüpfungen (288 px, 224–480) am Rand ziehbar wie der
  Steckbrief, je Gerät gemerkt (#83). Unter 1280 px ist die
  Themen-Auswahl der Titel der Liste (mit Themen-Menü). Menü „Sortieren und filtern“ neben der
  Suche. (11.10.2026: Themen-Spalte erst ab 1800 px ausprobiert – der Nutzer: zu unübersichtlich,
  deshalb wieder ab 1280 px.) Listenzeilen: Titel + Datum, darunter Typ (nur wenn nicht „Wissen“) und
  Textanfang (geändert 11.10.2026: mehr Platz für die Notiz auf Laptop-Bildschirmen).
  Sortierung: „Neueste zuerst“ (zuletzt bearbeitet, auch im Text) als Standard, „A–Z“ im Menü
  „Sortieren und filtern“; die Wahl bleibt je Gerät gespeichert.
  **Nur Wissen (#56, N3):** Die Liste zeigt nur Notizen von Typen mit „zählt als Wissen“ (mit und
  ohne Projekt); „Alle Notizen“ heißt „Alles Wissen“, der Typ-Filter bietet nur diese Typen an.
  **Chip „Noch einordnen · N“** (ruhige Pille, `rounded-full`, Rahmen `border-strong`, Eingeschaltet
  = Akzent gefüllt) unter der Kopfzeile der Liste, nur sichtbar, wenn N > 0 oder aktiv; Klick →
  `?einordnen=1`: Notizen anderer Typen ohne Projekt, je Zeile die Typ-Auswahl (`NoteTypePicker`)
  rechts, daneben die Pille „← Zurück zum Wissen“. Unter der Liste ein leiser Hinweis „N weitere
  Notizen zählen nicht als Wissen · Alle Notizen“ (Link zur Datenbank). „Neue Notiz“ bleibt „Idee“
  und öffnet in „Noch einordnen“. Steht die offene Notiz nicht in der Liste (Direkt-Link, Typ
  gerade umgestellt), nennt ein leiser Hinweis über der Liste Grund und Weg (N4).
- Befehlspalette ⌘K: Suche, Seite öffnen, neuer Knoten, Befehle. Suchtreffer nach Art gruppiert
  (Projekte, Aufgaben, Notizen, Rückblicke); ab 6 Treffern steht darüber „Beste Treffer“ mit den
  3 relevantesten offenen Treffern aller Arten (#84)

## Layout Mobil (< 768 px)

- **App vom Home-Bildschirm (E44 H1):** Manifest (`src/app/manifest.ts`, Start /heute,
  `standalone`), `appleWebApp` mit `black-translucent` – der Inhalt liegt unter der Statusleiste,
  deshalb hält alles, was oben klebt oder oben beginnt (Handy-Kopfzeile, seitliche Sheets,
  Aufgaben-Panel am Handy, Anmeldung/MFA, Freigabe), `env(safe-area-inset-top)` frei; unten trägt
  die Leiste den Rand. `themeColor` = `--bg` des gewählten Themes (`THEME_COLORS`). Hinweis „Auf
  den Home-Bildschirm“ einmal je Gerät auf Heute, vorerst nur iPhone (iPad: großes Layout ab
  1024 px oben noch ohne Rand); Anleitung dauerhaft unter Einstellungen › Auf dem Handy (`#handy`)
- **Leiste unten (E44 H2):** Heute · Woche · **＋** (Schnell erfassen) · Wissen · Menü, nur unter
  768 px (`md:hidden`), fest unten (z-30, unter Sheets/Dialogen/Palette), Hintergrund `bg-sidebar`,
  Rahmen oben, trägt selbst `env(safe-area-inset-bottom)`. Höhe `--spacing-tabbar` (3,5 rem);
  `<main>` hält darunter Höhe + Rand frei, Meldungen (Toaster) sitzen darüber. Aktiver Platz per
  `aria-current="page"` (Kalender in jeder Ansicht = Woche); „Woche“ führt in die Wochenansicht;
  ＋ ist der runde Akzent-Knopf und öffnet das Sheet „Festhalten“ (von unten, Radius 14: „Abbrechen“ · Titel · „Anlegen“ oben – bleibt bei offener Tastatur erreichbar; Art Aufgabe/Notiz, Textfeld mit Zielvorschau, Wann, Bereich, Projekt; Datumswörter wie „morgen“ setzen Wann, der Titel bleibt; Kürzel im Text gehen vor); „Menü“
  öffnet die Navigation (Bedienname „Menü öffnen“). Solange auf einem Touch-Gerät der Fokus in
  einem Feld oder Editor liegt, gleitet die Leiste weg (150 ms, `inert`) – sonst schwebte sie über
  der Tastatur und der Outliner-Werkzeugleiste. Der Menü-Knopf in der Kopfzeile erscheint nur
  zwischen 768 und 1023 px (`max-md:hidden`)
- Sidebar und rechtes Panel werden zu **Sheets** (von unten / seitlich)
- Touch-Ziele ≥ 44 px
- **Wischgesten** (Rückmeldung #22, B13, `SwipeRow`): nach links = Papierkorb (Zeile gleitet
  hinaus, Toast mit „Rückgängig“), nach rechts = erledigt bzw. wieder öffnen (nur Aufgaben,
  Zeile federt zurück). Unter der Zeile Farbe und Symbol der Aktion: zart (`--danger`/`--success`
  15 %), kräftig ab der Auslöse-Schwelle (40 % der Breite). 160 ms, ohne Bewegung bei
  `prefers-reduced-motion`. Senkrechtes Scrollen hat Vorrang; ist die Bewegung waagrecht, hält
  die Zeile das Scrollen an (Touch-Ereignisse, `touchmove` nicht passiv – Safari am iPhone brach
  sonst ab, #24). Nur Listenzeilen – nicht im
  Board, in Tabellen oder im Outliner; Desktop nutzt den Rechtsklick
- Outliner: Werkzeugleiste über der Tastatur (Einrücken, Ausrücken, Hoch, Runter, Tag, Link)
- Tabellen-Ansicht scrollt horizontal; Kanban spaltenweise wischbar

## Komponenten (Mindestumfang)

Button (primär, sekundär, ghost) · Input · Select · Datepicker · Checkbox · Pille/Tag ·
Status-Badge · Menü / Kontextmenü · Befehlspalette · Sheet · Toast (mit „Rückgängig“, auch per
⌘Z) · Wischbare Listenzeile (Handy) · Rückfrage inline (endgültig löschen, rot umrandet) ·
Skeleton · Leerer Zustand (mit Handlungsaufforderung) · Tabelle · Kanban-Karte · Galerie-Karte ·
Aufgaben-Kreis · Abschnittskopf · Zusammenfassungszeile · Fortschrittsring · Projekt-Status-Symbol ·
Fälligkeit (siehe Muster-Katalog)

## Muster-Katalog (Feinschliff #23, 16.10.2026)

Gestaltung über Muster mit Bedeutung, nie über Deko. Alle acht hat der Nutzer übernommen; neue
Ansichten benutzen sie. Komponenten in `src/components/ui/`, zu sehen unter `/dev/ui`.

| # | Muster | Regel | Komponente |
|---|---|---|---|
| 1 | Klare Gewichte | Je Seite höchstens **eine gefüllte Karte** (das Wichtigste, auf Heute der Fokus). Zusammengehörige Abschnitte bekommen einen **leichten Rahmen ohne Fläche** (Rückmeldung: „dass man sieht, es gehört zusammen“), Nebenspalten stehen offen mit einer feinen Linie links. Unter dem Seitentitel fasst **eine Zeile** zusammen, was zählt (Farbe nur bei überfällig/festgefahren). | `SummaryLine`, `PageHeader summary`, `Section` (Heute) |
| 2 | Abschnittskopf | Symbol-Kästchen (32 px, Symbol wie in der Seitenleiste), Titel, blasse Unterzeile (was hier steht), rechts Anzahl oder Zustand. In Listen als **Gruppenkopf** mit Anzahl über einer feinen Linie; „Überfällig“ rot. Aufgabenlisten gruppieren standardmäßig nach Fälligkeit, Projektlisten nach Status (aktive oben, #74). Gruppenköpfe in Liste und Tabelle klappen mit dem Pfeil davor (#73, ⌥-Klick: alle; je Gerät gemerkt, beim Suchen alles offen). Aufgaben- und Notizen-Übersicht nach Projekt: Projekte beim Öffnen immer zu, „Ohne Projekt“ oben und offen (#79/#81, nicht gemerkt). | `SectionHeader`, `SegmentMeter`, Gruppenkopf in `DatabaseView` (`GroupFoldButton`, `useGroupFold`) |
| 3 | Aufgaben-Kreis | Runder Kreis statt Kästchen. Farbe = Priorität (rot hoch, gelb mittel, 12 % Fläche), Füllung = Status (halb = in Arbeit, gestrichelt = wartet). Abhaken: grün gefüllt, Haken zeichnet sich in 160 ms (wie Wischen nach rechts). Keine Prioritäts-Pille mehr in Zeilen und Karten; die Priorität steht für Screenreader im Titel. Trefferfläche am Handy 44 px. Checklisten in Texten bleiben eckig. | `TaskCheck` |
| 4 | Fälligkeit mit Bedeutung | Überfällig rot mit Wochentag („Mi 14.10.“), heute kräftig, morgen grau, später blass; Erledigtes blass. Datum immer mit Wochentag außer heute/morgen/gestern. Zahlen bündig in eigenen Spalten. | `DueDate`, `formatDue`, `dueTone` |
| 5 | Projekt-Zustand als Symbol | Fortschrittsring in Bereichsfarbe statt Balken (ohne Aufgaben gestrichelt). Form = Status: Idee gepunktet, geplant gestrichelt, aktiv Ring, pausiert mit Strichen, abgeschlossen grün mit Haken, Archiv-Kiste. „Festgefahren“ nennt den Grund („Ergebnis fehlt“), mit Warnsymbol statt Pille. Seitenleiste: kleine Ringe. | `ProgressRing`, `ProjectStatusIcon`, `ProjectHints`, `stuckText` |
| 6 | Zeitleiste mit Jetzt-Linie | Senkrechte Linie mit Punkten, Erledigtes blass, die Jetzt-Linie steht vor dem nächsten Eintrag. Auch für den Tagesverlauf (B12): „Erledigt heute“ auf Heute (einklappbar) und je Tag im Rückblick; erledigt/erreicht = grüner Punkt, Notizen = offener Punkt, Symbol je Art. | `timeline()` + Tagesablauf auf Heute, `DayTimeline` |
| 7 | Abendplanung mit drei Plätzen | Drei Plätze (frei gestrichelt, belegt mit Titel und ×). Vorschläge als ruhige Zeilen mit Grund („überfällig“, „hoch · heute fällig“). | `suggestionReason()` |
| 8 | Leise Wiederholungen | Knöpfe, die in jeder Zeile gleich sind (Zuordnen, → Notiz), ohne Rahmen (`ghost`); einen Klick entfernt, am Handy sichtbar. Ebenso die Vorlagen auf leerer Notiz und frischem Projekt („Vorlage: Protokoll“, B11). | `Button variant="ghost"`, `TemplateChips` |

**Dateien** (#27): Kachel im Outliner wie Bilder (`.ol-media`): Datei-Symbol, Name als Link
(PDF öffnet im neuen Tab, sonst Herunterladen), darunter Art · Größe; rechts leise Knöpfe „Ganz
anzeigen“ (nur PDF) und „Herunterladen“. Ganz angezeigt: Seiten untereinander auf weißem Blatt
(`--pdf-paper`) in einer `surface-2`-Fläche. Ablegen irgendwo auf Notiz oder Aufgabe zeigt einen
gestrichelten `link`-Rahmen „Loslassen: …“ (`FileDrop`).

**Bilder bearbeiten** (#28): Bild antippen bzw. darüberfahren zeigt einen Griff unten rechts
(Ziehen = Breite in % der Zeile, 10–100) und eine schwebende Leiste *unter* dem Bild („−“, „+“,
„Zuschneiden“) – darüber deckte sie kleine Bilder am Handy ganz ab. Zuschneiden im Dialog mit
abgedunkeltem Rand (`--overlay`) und vier Ecken; das Ergebnis ist eine neue Datei, ⌘Z holt das
Original zurück.

**Ganze Breite** (#31, `src/components/shell/wide.tsx`): Schalter (Maximize) im Kopf von Aufgabe
(ab 1280 px), Notiz und Projekt (ab 1024 px). Seitenleiste und Listen werden zu senkrechten Reitern
(40 px, `bg-sidebar`, Symbol + senkrechter Text, von oben nach unten); ein Klick auf einen Reiter
klappt alles wieder auf. Gilt nur, solange die Ansicht offen ist. Auch über ⌘K.

**Spalten einklappen** (#80, `FoldButton` + `Rail` in `wide.tsx`): Jede Spalte am Rand hat oben
rechts in ihrem Kopf einen kleinen Knopf (ghost, `icon-sm`, `PanelLeftClose` bzw. bei Spalten am
rechten Rand `PanelRightClose`, Name „<Spalte> einklappen“). Er schiebt die Spalte zum senkrechten
Reiter an ihrem Rand: linke nach links, rechte nach rechts; ein Klick auf den Reiter klappt sie
wieder auf. Spalten: Seitenleiste (⌘\), Wissen › Themen und Notizliste (Reiter mit Anzahl),
Wissen › Verknüpfungen (ab `4xl`, eingeklappt stehen die Rückverweise wieder unter der Notiz),
Projekt › Steckbrief, Kalender › Einplanen, offene Aufgabe (Panel). Zustand je Gerät
(`useLocalFlag("sz:…-zu")`); nur die Aufgabe steht in der Adresse (`?eingeklappt=1`), damit jedes
erneute Öffnen einer Aufgabe sie wieder zeigt. `Rail side`: `shell` (Seitenleiste, ganze Höhe),
`left` (Spalte am linken Rand des Inhalts, unter der Reiterleiste), `right` (Spalte rechts im
Inhalt), `panel` (Aufgabe). Knöpfe nur am Laptop – unter der Breite, ab der die Spalte neben dem
Inhalt steht, mit `max-lg:hidden`/`max-xl:hidden` ausblenden (nie `hidden lg:inline-flex` am
`Button`: dessen `inline-flex` gewinnt, `cn` löst den Konflikt nicht auf); eingeklappt gilt dort
ebenfalls nur ab dieser Breite.

**Termin verknüpft** (#68, `calendar/components/event-links.tsx`): Im Termin-Fenster der Abschnitt
„Verknüpft“ (Kopf klein in Versalien wie „Verschieben auf …“), Zeilen mit Datei-Symbol bzw.
Aufgaben-Kreis, Titel als Link, bei Serien ein leiser Umschalter „nur dieses Mal / ganze Serie“,
✕ löst; darunter `secondary`-Knöpfe „＋ Notiz zum Termin“, „＋ Aufgabe“ und ein `SearchPicker`
„Vorhandenes verknüpfen …“. In Notiz und Aufgabe oben `LinkedEvents`: gerahmte Zeile mit
Kalender-Symbol „Termin: Mi, 21.10. 19:00–21:00 · Titel“ und „Lösen“; gestrichelt und blass,
wenn Google den Termin nicht mehr hat („war: …“). Am Termin `EventLinkMarks`: auf Heute/Liste
„Notiz · 1 · Aufgabe · 2“ in `text-faint`, im Zeitraster knapp mit Symbol und Zahl.

**Zuständig KI** (#77, `AiAssigneeBadge`): Arbeitsschritte der KI stehen nur im Projekt – Titel in
`text-muted`, dahinter ein feines Kürzel „KI“ (Rahmen `border`, `text-meta text-faint`).

**Alle auswählen / abwählen** (#78, `MenuSelectAll` in `components/ui/menu.tsx`): zwei Einträge
über jeder Häkchen-Liste in Menüs, gesperrt, was schon gilt; das Menü bleibt offen.

**Legende** (#25, `src/components/shell/legend.tsx`): erklärt die Muster 3–6, Bereichsfarben und
den Speicherstatus mit denselben Komponenten (nie nachgezeichnet). Öffnet als Panel rechts über das
„?“ im Fuß der Seitenleiste oder ⌘K „Legende“. Neue Muster mit Bedeutung dort ergänzen.

**Ergänzungen Nachtlauf J** (17.10.2026, Oberfläche Teil 1):
- **Zuletzt geändert** (#41, `EditedLine`): leise Zeile (`text-meta text-faint`) direkt unter dem
  Titel von Notiz, Aufgabe und Projekt – „heute um 14:32“, „gestern um …“, „am Mi, 14.10. um …“.
- **Checkliste einer Aufgabe** (#42): in der Aufgabe über der Notiz „Checkliste · 2 von 5“ mit
  `ProgressBar` in der Bereichsfarbe (ohne Bereich `neutral`); in Zeile und Karte `ChecklistCount`
  „2/5“ mit Listen-Symbol, das Symbol wird grün, wenn alles erledigt ist. Steht in der Legende.
- **Bereich gewählt** (#45): 1-px-Rahmen in der Bereichsfarbe um die ganze App, solange nicht
  „Alles“ gewählt ist (auch am Handy, wo der Schalter im Menü steckt). Nur der Rahmen, kein Text.
  Steht in der Legende.
- **Links im Steckbrief**: Abschnitt „Links“ (Laptop im Steckbrief, Handy in der Übersicht) –
  Globus bzw. Brief, Name in `--link`, Kurzform der Adresse blass dahinter (weicht zuerst);
  „Link hinzufügen“ öffnet ein kleines Formular mit Rahmen (Name, Adresse; Enter speichert,
  Escape bricht ab). Bearbeiten und Entfernen leise in der Zeile, Entfernen mit „Rückgängig“.
- **Link kopieren** (#47): im …-Menü von Notiz, Aufgabe, Projekt und im Rechtsklick-Menü der
  Listen, Bestätigung als Toast „Link kopiert“.
- **Rechtsklick auf Notizen** (#35): Öffnen, Typ, Bereich, Link kopieren, Papierkorb – in jeder
  Notizliste (Wissen, Datenbank, Projekt) und in Tabelle/Board.
- **Scrollbalken** (#32): Farbe `--border-strong` auf transparenter Spur (vererbt von `<html>`);
  Spalten, die rechts am Rand scrollen (Aufgaben-Panel), mit `scroll-quiet` (schmal, fester Platz).

Ergänzungen Nachtlauf K (17.10.2026 abends, Oberfläche Teil 2, E31):
- **Formatierung** (#40) in Notiz, Aufgaben-Notiz und Projekt-Freitext gleich: Überschrift 1–3 in
  `--heading-font` (24/20/17 px, der Aufzählungspunkt steht mittig zur ersten Zeile), Zitat mit
  3-px-Linie `--border-strong` und `--text-muted`, Hinweis-Kasten in `--surface-2` mit leichtem
  Rahmen und „i“ im Kreis, Trennlinie 1 px `--border-strong` (ohne Punkt). Textfarben `--ink-grau|rot|
  orange|gelb|gruen|blau|lila`, Marker `--marker-gelb|gruen|blau|rot|lila` (Papier und Dunkel je
  eigene Werte, Text bleibt `--text`). Bedienung: Rechtsklick › „Absatz“ und „Farbe“ (Untermenüs),
  am Handy „Aa“ in der Leiste (drei Zeilen: Absatzart, Textfarbe, Marker, je 44 px). Farben
  bewusst gedämpft, keine Bedeutung – nicht in der Legende.
- **Datenbanken nach Projekt** (#48): Gruppenkopf mit Bereichspunkt und leisem Pfeil
  (`GroupLink`, ↗) ins Projekt – in Liste und Tabelle; „Ohne Projekt“ am Ende.
- **PDF-Fenster** (#36): „Ganz anzeigen“ = Fenster in Seitenhöhe (höchstens 80 % des Bildschirms)
  auf `--surface-2`, darin blättern (Seiten rasten leicht ein), „Seite 3 von 12“ in `--text-faint`
  rechts darunter; das Fenster ist per Tab erreichbar.
- **Freitext im Projekt** (#44): Abschnitt „Freitext“ im Reiter Übersicht unter „Als Nächstes“,
  ohne Rahmen wie die Aufgaben-Notiz, mit „Punkt hinzufügen“, „Datei anhängen“, Spickzettel.
- **Notiz-Typen** (#34): in der Notiz eine Such-Auswahl (`NoteTypePicker`) mit „Typ „…“ anlegen“
  und „Typen bearbeiten …“; Einstellungen › Notiz-Typen als ruhige Liste (Name direkt bearbeiten,
  Anzahl Notizen, Papierkorb-Knopf; „Wissen“ trägt „Standard“). Löschen klappt darunter eine
  gerahmte Rückfrage auf („Die 3 Notizen ziehen um nach [Wissen]“), kein Dialog.
  **Schalter „zählt als Wissen“** je Zeile (Checkbox mit Text, vor der Anzahl; bricht am Handy in
  eine zweite Zeile um); neue Typen starten ausgeschaltet, „Wissen“ und „Anleitung“ sind an.
- **Zuletzt bearbeitet** (#38): Aufgaben mit Aufgaben-Symbol (wie in der Navigation), ein Klick
  öffnet das Panel auf der aktuellen Seite.
- **Zeitstempel** (#50): „@jetzt“/„@heute“ + Leertaste wird normaler Text „17.10.2026 20:45“ bzw.
  „17.10.2026“ (kein eigenes Aussehen); im Rechtsklick-Menü „Zeitstempel einfügen“ mit Uhr-Symbol.
- **Großansicht für Bilder** (#59, 18.10.): `openImageViewer` – deckende Fläche in `--bg`,
  Kopfzeile mit Name + „2 von 5“, −/Zoom %/+, am Handy „Bearbeiten“, ✕; Bild eingepasst, Zoom
  1–8× um den Zeiger (`image-zoom.ts`), Verschieben nur bis zum Bildrand; Blättern-Knöpfe an
  den Seiten; Hinweiszeile mit `Kbd` nur am Desktop. Bild im Editor mit `cursor: zoom-in`.
- **Meilenstein erreicht** (#60): Der Kreis wird mit der letzten erledigten Aufgabe von selbst zum
  grünen Haken (Tooltip „Erreicht, sobald alle Aufgaben erledigt sind – du kannst auch selbst
  abhaken“); die Meldung nennt ihn.
- **Menüs** passen immer ins Fenster (`collisionPadding` 8 px, Höhe = verfügbarer Platz) und
  scrollen in sich; der Menü-Container ist dafür per Tastatur erreichbar.

Ergänzungen Nachtlauf O (19.10.2026, #62, #63, #65–#67, #69, Triskel):
- **Reiterleiste** (#63, `components/shell/tabs/`): Desktop ab 1024 px, 36 px hoch
  (`--tabbar-h: 2.25rem`), klebt oben über dem Inhalt, `bg-sidebar` mit Linie unten. Reiter
  28 px hoch, bis 192 px breit: Symbol der Seite (14 px, `text-faint`) + Titel, ✕ rechts leise;
  aktiv = `bg-surface` mit Rahmen und `font-medium`, sonst `text-muted` ohne Rahmen. ＋ am Ende
  öffnet Heute. Klebende Spalten im Inhalt rechnen mit `var(--tabbar-h,0px)` (`top`, Höhe statt
  `100dvh`). **Handy/Tablet:** Zähler in der Kopfzeile (Zahl in einem Kästchen mit 1,5-px-Rahmen,
  44 px Trefferfläche) öffnet das Sheet „Offene Reiter“ (Zeilen ≥ 44 px, aktiv `bg-surface-2`,
  „Neuer Reiter“ unten). Menüs mit „Öffnen“ bieten „In neuem Reiter öffnen“. Steht in der Legende.
- **Einplanen-Gruppen** (#62, `calendar/plan.ts` + `plan-sidebar.tsx`): Kopf „N offen · M jetzt“,
  Suche, darunter die eine getönte Fläche der Spalte: Block „Jetzt einplanen“ (`bg-surface-2`,
  `rounded-card`, höchstens 7 Zeilen + leise Zeile „N weitere“). Danach offene Gruppen mit
  Gruppenkopf (Inbox, Projekte mit dem nächsten Meilenstein aufgeklappt und „+ 2 Meilensteine ·
  18 Aufgaben“ als leise Zeile, lose Aufgaben je Bereich); große Gruppen starten zu. Filter als
  kleines Menü („Einplanen-Anzeige“) statt Chip-Reihe. Zeilen am Handy ≥ 44 px.
- **Angelegt von** (#69): In Panel und Datenbank leise „· von KI angelegt“ (`text-faint`), kein
  Abzeichen; Filter „Angelegt von: Ich / KI“ wie die übrigen Filter der Ansichten.
- **Abschnitt in den Leitfragen** (#66): Fragen mit gleichem `section` stehen unter einer
  Überschrift (`heading`, `text-body-lg`) über einer feinen Linie (`border-t`, 20 px Abstand) –
  keine Karte, die Reflexion bleibt die eine gefüllte Karte. Unter „Bezug zur Vorwoche“ eingeklappt
  „Zum Nachlesen: Vorwoche“ (Fokus und Mitnehmen der Woche davor, blass).
- **Zeitraum groß** (#67): Seiten mit Zeitraum (Kalender) nennen ihn als `h1` („November 2026“,
  „Okt – Nov 2026“), den Seitennamen klein in `text-meta text-faint` darüber (`periodTitle`).
- **Umwandeln** (#65): Menüeintrag „In Notiz umwandeln“ bzw. „In Aufgabe umwandeln“ (Symbol der
  Zielart: Notiz bzw. Checkliste) im ⋯- und Rechtsklick-Menü; danach eine Meldung mit
  „Rückgängig“, die nennt, was nicht mitgeht. Checklisten-Punkte stehen in der Notiz als Zeile mit
  ☐/☑. Steht in der Legende (Wissen).
- **Triskel-Symbol** (O7, `components/triskel-mark.tsx`, `public/triskel.png`): Farbkreis-
  Triskel auf durchsichtigem Grund, rund, in Hell und Dunkel ohne eigene Fläche lesbar – 20 px in
  der Seitenleiste neben „Triskel“, 16 px in den senkrechten Reitern (`Rail`), 32 px über der
  Anmeldekarte. App-Icons in `src/app/` (favicon, icon, apple-icon). Kein Lucide-Symbol mehr.

Ergänzungen Nachtlauf G (16./17.10.2026): Rückblick-Seite mit der Reflexion als einziger gefüllter
Karte, Zahlen/Tagesverlauf/„An diesem Tag“ in der offenen Nebenspalte; Verlauf als Liste mit
Status-Symbol (abgeschlossen grüner Haken, offen Stift, Lücke gestrichelter Kreis, ab drei Lücken
zusammengefasst). Skala 1–5 als fünf Kästchen (gewählt = helle bzw. dunkle Pille wie aktive
Navigation). Bilder und Diagramme im Outliner als Kasten mit leichtem Rahmen (`.ol-media`), der
Aufzählungspunkt steht oben am Kasten.

## Zeitstrahl (#55, N2, 18.10.2026)

Rückmeldung: „nativ bauen“, zuerst Variante 1 (alle Projekte auf einer Achse, **filterbar**) + Variante 3
(Projektübersicht im Stil des Artefakts); Variante 2 (Abhängigkeitspfeile) später. Vorlage:
`design/zeitstrahl/index.html`. **Eine Seite `/projekte/zeitstrahl`** (`src/features/timeline/`,
`appPath.timeline()`), ohne Migration und ohne neue Daten – Projekte, Meilensteine, Aufgaben.
Einstieg: Knopf „Zeitstrahl“ im Kopf der Projekte-Datenbank und ⌘K „Zeitstrahl“; **nicht** in der
Seitenleiste (Regel #29: nur täglich Gebrauchtes).

- **Kopf (V3):** Titel „Zeitstrahl“ mit **Farbstrich** oben (3 px in der Bereichsfarbe des
  gewählten Bereichs, bei „Alles“ neutral `--border-strong`), darunter `SummaryLine` und vier
  **Kennzahlen-Kacheln** ohne Fläche (feine Linien, Zahlen `tabular-nums`): Aktive Projekte ·
  Meilensteine im laufenden Monat (davon erreicht) · Überfällige Meilensteine (rot nur bei > 0) ·
  Fortschritt (erledigte ÷ alle Aufgaben aktiver Projekte). Kennzahlen hängen am Bereich, nicht
  an Status- und Zeitraum-Filter. Handy: 2 × 2.
- **Filter (V1), je Gerät gemerkt** (`sz:zeitstrahl-filter`): **Bereich** = Bereichs-Schalter der
  App mit „N weitere Projekte in anderen Bereichen · Alle Bereiche zeigen“; **Status** als
  Umschalt-Pillen (Standard Aktiv + Geplant; Pausiert, Idee, Abgeschlossen dazu; Archiv nie);
  **Zeitraum** 3 Monate · 6 Monate (Standard) · Jahr · Alles; **Sortierung** nach Ziel oder Start.
  ‹ › verschieben (3 Mon. = 1 Monat, 6 = 3, Jahr = 6), „Heute“ holt zurück, Tasten ←/→/T; die
  Verschiebung gilt nur, solange die Seite offen ist.
- **Achse (V1):** Zeile = Projekt – Status-Symbol in Bereichsfarbe (Muster 5), Name (Link), Meta
  „Bereich · Status · 3 von 6 Meilensteinen“, „N überfällig“ rot. Balken Start → Ziel in
  Bereichsfarbe (Linie + 20 %), **gefüllt = erledigte Aufgaben**; **gestrichelt**, wenn nur Start
  (bis letzter Meilenstein/heute) oder nur Ziel (ab Anlage) eingetragen ist; angeschnittene Enden
  ohne Rundung. Nicht laufende Projekte (pausiert, Idee, abgeschlossen) 60 %. **Meilensteine** als
  Rauten: erreicht grün gefüllt, offen leer, überfällig rot mit Warnzeichen (nie nur Farbe);
  Lage = Fälligkeit, ohne Fälligkeit der Erreicht-Tag. **Heute-Linie** 2 px `--text` mit Marke
  „heute“ (nicht rot – Rot heißt „überfällig“). Raster: Monatslinien, bei 3 Monaten auch
  Wochenlinien. Projekte **ganz ohne Datum** stehen darunter als Liste „Ohne Termin“.
  Hover-Kärtchen am Meilenstein wie `TaskHover` (Titel, Projekt, fällig/überfällig seit/erreicht,
  Aufgaben x von y); Klick auf Balken oder Raute öffnet das Projekt; Rechtsklick auf die Zeile:
  Öffnen, Link kopieren.
- **Handy 390 px:** Achse scrollt **in sich waagrecht** (Region „Zeitstrahl, waagrecht scrollbar“,
  per Tastatur erreichbar, mindestens 46 rem breit), die Namen bleiben links stehen (`sticky`),
  die Heute-Linie wird beim Öffnen in die Mitte geholt. Filter und Kacheln brechen um, Pillen
  und Umschalter 44 px hoch. Gewählt statt „Liste je Monat“: die Achse bleibt ein Bild und die
  Überlappungen bleiben sichtbar.
- **Karten (V3) „Nächster Schritt“:** je aktivem Projekt, frühestes Ziel zuerst; Bereichspunkt,
  Ziel (`DueDate`), Titel, `ProgressRing` mit Prozent, darunter nächster Schritt (Aufgabe + Fälligkeit)
  und nächster offener Meilenstein, Hinweis „festgefahren“/„still“. Nur leichter Rahmen – die
  Seite hat keine gefüllte Karte. Aus dem Artefakt **nicht** übernommen: eigene Schrift (Barlow),
  Rot als Akzent.
- **Legende:** Gruppe „Zeitstrahl“ (Balken, gestrichelt, Rauten in drei Zuständen, Heute-Linie)
  und dieselben Zeichen als Zeile unter der Achse.

## Kalender (Stufe 2, S2b – Leitlinie #52, 18.10.2026)

Rückmeldung: „schlüssig, einfach, übersichtlich – das ist das Hauptding. Da sollte viel Logisches
reinfließen. Aufgaben reinziehen, verschieben, verschiedene Ansichten.“ Konzept vor dem Bauen:

- **Eine Seite `/kalender`** (`src/features/calendar/`), Umschalter **Tag | Woche | Monat |
  Liste** (`SegmentedControl`, Standard Woche, je Gerät gemerkt, `?ansicht=` und `?tag=` in der
  Adresse für Links). Woche ab Montag mit **KW** im Kopf („KW 43 · 19.–25.10.2026“), darunter die
  Zusammenfassungszeile (Muster 1): Termine, Aufgaben, überfällig (rot), vollster Tag.
- **Alles mit Datum an einem Ort, jedes genau einmal** (`model.ts`, reine Funktionen, auch für
  S2c): Google-Termine, Aufgaben (Tag = geplant › Fokus › fällig; Erledigtes bleibt am Tag,
  gedämpft), Fokus-3 (Zielscheibe), Meilenstein- und Projekt-Zieldaten als **Fristen** (Fahne),
  künftige Instanzen wiederkehrender Aufgaben **blass** (nur vorausberechnet, nicht anlegbar),
  Rückblick-Tage (So „Wochenrückblick KW n“, Monatsletzter „Monatsrückblick“), Feiertage BW
  (`holidays.ts`, berechnet, ruhig im Tageskopf). **Überfälliges** steht nicht in der
  Vergangenheit, sondern **heute oben** mit „überfällig seit Mi 14.10.“.
- **Feste Ordnung je Tag:** Kopf (Wochentag, Datum, Feiertag, Tageslast-Balken) → **ganztägig +
  Fristen** → **Termine nach Uhrzeit** als Zeitraster (Google-Termine mit Kalenderfarbe links,
  geplante Aufgaben als Zeitblock mit Aufgaben-Kreis; ohne Dauer gilt 1 h, Dauer am unteren Rand
  ziehbar) → **Aufgaben** ohne Uhrzeit (Liste, Tag, Handy: darunter). Überlappende Termine stehen
  nebeneinander (Spaltenlayout in `layout.ts`, Blöcke verlassen nie ihre Tagesspalte, Text
  einzeilig gekürzt, voller Titel im Tooltip), ein Termin mit Dauer 0 als Linie mit Uhrzeit.
- **Woche am Desktop (S2c, Befund aus den Screenshots):** Aufgaben ohne Uhrzeit stehen als
  **Band über dem Raster** (wie ganztägig), Überfälliges zuerst, höchstens 3 je Tag und „+ N
  weitere“ zum Aufklappen – sonst lägen sie unter 22:00 außer Sicht. Das Raster darunter bekommt
  die Resthöhe des Fensters (`useFillHeight`) und scrollt in sich; es beginnt um 07:00 (früher bei
  früheren Terminen), die Jetzt-Linie wird beim Öffnen ins Bild geholt. Bei 1440×800 ist die ganze
  Woche samt Band ohne Seiten-Scrollen erfassbar (E2E prüft es).
- **Logik, die mitdenkt (Signal statt Rauschen):** Tageslast = belegte Termin-Stunden +
  Aufgaben-Dauer (`LoadBar`, 4 Stufen: frei · normal · voll (≥ 6 h) · überladen (≥ 8 h oder
  ≥ 8 Aufgaben), nur Text in `--warning`, nie eine Sperre); **freie Fenster** (≥ 60 min zwischen
  8 und 18 Uhr) als gestrichelte Flächen im Raster; eine Frist an einem vollen Tag bekommt das
  Warnsymbol; Bereichs-Schalter wie überall mit „N weitere in anderen Bereichen“.
- **Einfach bedienen:** Klick auf eine Aufgabe = Panel `?aufgabe=`, Klick in einen leeren Tag =
  Aufgabe für diesen Tag anlegen (Zeile „+ Aufgabe“), Termin = kleines Detail (Popover: Zeit, Ort,
  Beschreibung, Kalender, „In Google öffnen“). Tasten **←/→** Zeitraum, **T** heute, **D/W/M/L**
  Ansicht. ⌘K „Kalender“. Filter: Termine, Aufgaben, Erledigte an/aus, Projekt (je Gerät gemerkt).
- **Reinziehen und verschieben** (dnd-kit wie im Board): Seitenspalte **„Einplanen“** (Desktop
  rechts, aufklappbar, Zustand gemerkt; Handy als Sheet) mit Suche und Gruppen Inbox · Ohne Datum
  · gewähltes Projekt/Bereich. Ziehen auf einen Tag = **Fälligkeit**, auf eine Uhrzeit (Woche,
  Tag) = **Zeitblock** (`scheduled_at`, Dauer bleibt), zurück in die Spalte = Datum entfernen.
  Jede Verschiebung mit **Rückgängig** (`notifyWithUndo`, also ⌘Z). Ohne Maus bzw. am Handy:
  Rechtsklick/langes Drücken bzw. „⋯“ in der Zeile › „Verschieben auf …“ (morgen, nächster Montag,
  nächste Woche, Datum wählen, Datum entfernen). Google-Termine sind nur lesbar.
- **Zeitblock = vorhandene Felder** `tasks.scheduled_at` + `tasks.duration_min` (Migration 04,
  im Aufgaben-Panel „Geplant“/„Dauer“) – **keine Migration 31**.
- **Handy 390 px:** Woche als Tagesliste untereinander (vergangene Tage der laufenden Woche
  zusammengeklappt, heute oben), Monat als kompaktes Raster mit Punkten (Termin = Kalenderfarbe,
  Aufgabe = `--text-faint`, Frist = Fahne), Tipp auf einen Tag zeigt seine Liste darunter.
- **Monat zum Durchscrollen (#85, wie Notion Kalender):** Auf `/kalender` ist der Monat ein
  durchgehendes Wochenraster, das in sich scrollt (`MonthScroll`, Resthöhe des Fensters wie das
  Wochenraster; Handy ~6½ Wochen hoch, Tagesliste darunter); die Wochentage bleiben oben. „Dran“ ist
  der Monat mit den meisten sichtbaren Tagen (`dominantMonth`): große Überschrift, Zusammenfassung,
  „N weitere“ und Adresse (`?tag=JJJJ-MM-01` per `history.replaceState(null, …)`, kein
  Server-Abruf). Seine Tage liegen auf `--surface`, die übrigen auf `--bg` mit Zahl in
  `--text-faint` (nie halbtransparent – Kontrast); am 1. steht der Monat („1 Nov“, am Handy „Nov“),
  im Namen der Zelle immer („Sonntag, 1. November …“). ←/→, „Heute“/T und Links scrollen hin
  (bis 2 Monate weich, sonst Sprung; Woche mit dem 1. oben, im laufenden Monat heute im Bild).
  Fenster ±3 Monate um die Adresse, beim Scrollen an ein Ende 3 dazu, höchstens 15 (`MONTH_WINDOW`);
  die oberste Woche bleibt beim Anhängen und Nachladen stehen. Termine monatsweise
  (`useCalendarEventMonths`, Monat im Bild ± 1). Das feste Monatsraster (`MonthView`) bleibt für
  die Datenbank-Ansicht „Kalender“ und den Monatsrückblick.
- **Google-Termine ziehen (N1b, #64):** Termine aus Google-Kalendern mit Schreibrecht verhalten
  sich wie Zeitblöcke: Hand-Zeiger (`cursor-grab`), in Woche und Tag auf eine andere Uhrzeit
  (15 min) oder einen anderen Tag ziehen, am unteren Rand (`Dauer ziehen`, Griff wie bei Aufgaben)
  länger/kürzer; **ganztägige** nur auf einen Tag (die ganztägig-Zeile der Woche ist eine eigene
  Ablagefläche `day:<Tag>:allday`), auf eine Uhrzeit gibt es einen Hinweis; **Serien**: nur diese
  Instanz. **Nur lesbare** (Feiertage, fremde Einladungen, abonnierte Kalender) bleiben fest,
  normaler Zeiger, im Fenster „In Google nur lesbar“ (Schloss). Gezogen wird sofort, geschrieben
  erst beim Loslassen; jede Änderung mit Toast **Rückgängig** (auch ⌘Z); Konflikt (in Google
  inzwischen geändert) → neu laden + „Der Termin wurde inzwischen in Google geändert – neu
  geladen“. **Ohne Maus/am Handy:** im Termin-Fenster (Popover, `EventMovePanel`) Knöpfe Heute/
  Morgen/Nächster Montag/In einer Woche, „Datum wählen“ und Beginn + Dauer mit „Uhrzeit
  übernehmen“. Ist der Zugang weg, steht über dem Kalender „Google neu verbinden“ mit Link.
- **Google-Termine anlegen, ändern, löschen (N1c, #64):** *Anlegen* – in Woche/Tag (Maus) auf
  freie Zeit klicken (1 h ab dem Halbstundenfeld) oder ziehen (15-min-Raster, die Zeile des
  Loslassens zählt mit; gestrichelte Vorschau `data-new-event-range`); beginnt nur auf leerer
  Fläche (Aufgaben/Termine bleiben ziehbar), nicht mit Touch, nicht solange ein Fenster/Menü
  offen ist. Überall (Monat, Liste, Handy) der Knopf „＋ Termin“ in der Kopfzeile und „Termin“ neben
  „Aufgabe“ im leeren Tag (nur wenn ein Kalender mit Schreibrecht eingeschaltet ist). Fenster
  `NewEventDialog`: Desktop kleines Fenster, Handy Sheet von unten; Titel (Fokus), Kalender
  (nur beschreibbare, zuletzt benutzter bzw. primärer vorgewählt), Tag, Beginn + Dauer (mit
  Ende-Zeile) bzw. ganztägig + „Bis“, Ort, Beschreibung; Enter legt an, Esc bricht ab. Sofort im
  Raster, Toast „Termin „…“ angelegt“ mit **Rückgängig** (= löschen). *Ändern* im Termin-Popover
  (`EventEditFields`, nur änderbare): Titel, Ort, Beschreibung als ruhige Felder, gespeichert beim
  Verlassen bzw. mit Enter (Esc schließt das Fenster ohne Speichern), Kalender wechseln (nicht bei
  Serien; Rückgängig = zurück); zu lang gekürzt gelesene Texte sind gesperrt („nur in Google“).
  *Löschen*: Knopf „Löschen“ bzw. „Nur diesen Termin löschen“ (Serien-Instanz), Rechtsklick,
  Entf/⌫ am fokussierten Termin; kein Dialog, Toast mit **Rückgängig** (holt den Termin aus
  Googles Papierkorb, sonst neu mit allen Angaben). Gäste und Videokonferenz bleiben in Google.
- **Legende:** Gruppe „Kalender“ (Termin-Balken, Termin anlegen, Termin ziehbar, Termin nur lesbar, Zeitblock,
  blasse Wiederholung, Frist, Tageslast, freies Fenster, Feiertag). Eigene gespeicherte Ansichten gibt es nicht (das System
  der Datenbank-Ansichten ist auf Aufgaben/Projekte/Notizen festgelegt, Migration 06) – die
  Filter je Gerät reichen; offen für den Nutzer (E34).
- **Heute (S2c):** Der Tagesablauf kommt aus demselben Modell (`useCalendarData` für den Tag):
  ganztägig + Fristen oben (`AllDayList`), dann Google-Termine und Zeitblöcke gemeinsam nach
  Uhrzeit in der Zeitleiste (Muster 6) – Chip-Variante `timeline` (Uhrzeit und Punkt in
  Kalenderfarbe stellt die Leiste, Termin-Klick öffnet das Detail mit „In Google öffnen“, Aufgabe
  mit ⋯/Rechtsklick „Verschieben auf …“), dazwischen Jetzt-Linie und Abendplanung. „Nächster
  Termin“ in der Zusammenfassung kennt die Google-Termine. Blockierte Aufgaben bleiben außen vor.
- **Datenbank-Ansicht „Kalender“ (S2c):** vierte Darstellung neben Liste, Tabelle, Board für
  Aufgaben und Projekte – derselbe `MonthView` mit den Filtern und der Suche der Datenbank
  (Aufgaben nach Fälligkeit/Plan/Fokus, Projekte als Fristen mit Meilensteinen), ohne Google-
  Termine; ‹ Heute ›, Klick auf einen Tag öffnet ihn in `/kalender`. Speicherbar als Ansicht
  (Migration 31 erweitert `saved_views.view_type`).
- **Einplanen-Spalte lesbar (#61, 18.10.):** am Desktop 240–560 px ziehbar (`ResizeHandle`
  mit `edge="left"`, `useLocalNumber("sz:einplanen-breite")`, Standard 320), Knopf
  „Einplanen einklappen“ (`FoldButton side="right"`) im Kopf → `Rail side="right"` mit Anzahl. Zeilen mit `TaskChip wrap`:
  Titel bis zwei Zeilen (am Handy ganz), Meta mit Projekt › Meilenstein (`taskPlaceLine`).
  **`TaskHover`** (Radix HoverCard, 400 ms) an jeder Aufgabe im Kalender: voller Titel,
  Bereichspunkt + Projekt › Meilenstein, Fälligkeit/Uhrzeit/Priorität, drei Zeilen Notiz; nur mit
  Maus, schließt beim Ziehen. Das Wochenraster ist eine fokussierbare `section` „Zeitraster“.

## Rückblicke (Stufe 2, S1a–S1c, 18.10.2026)

- **Seite `/rueckblicke`** mit Umschalter **Wochen | Monate | Verlauf** (`SegmentedControl`,
  `?ansicht=`). Je Reiter eine gefüllte Karte (der Zeitraum, der dran ist), darunter die früheren
  als ruhige Liste mit Status-Symbol und Lücken (ab drei zusammengefasst). Wochen aus anderen
  Jahren tragen das Jahr („KW 10/2025“).
- **Monatsrückblick (S1a):** dieselbe Seite wie die Woche – Reflexion als Karte (Vorlage, „Fokus
  nächster Monat“), Nebenspalte Zahlen (week_stats über den Monat) → **„Wochen des Monats“**
  (Ø Werte und Sport-Summe in einer Zeile, wiederkehrende Themen als Pillen, je Woche eine Zeile
  „KW 42 · 12.–18.10. · 4 erledigt“ mit Werten, aufklappbar zu den Antworten, Lücken mit
  „Nachholen“) → „An diesem Tag“. Eine Woche gehört zu dem Monat ihres Donnerstags. In der ersten
  Monatswoche ist im Reiter Monate noch der vorige Monat dran, solange er offen ist.
- **Zeitraum als Adresse:** `/rueckblicke/monat-2026-10`, `/rueckblicke/woche-2026-10-12` öffnen
  den vorhandenen Rückblick oder zeigen „… schreiben“ (Kalender, Heute verlinken so).
- **Verlauf (S1b):** Filter Art (Wochen | Monate) und Zeitraum (letzte 12 oder ein Jahr) in der
  Adresse (`art`, `jahr`, `thema`). Je Wert eine Zeile mit Balken (Höhe 48 px, Skala 1–5, Sport
  relativ zum größten Wert): `--border-strong`, der neueste Wert `--text`; Lücke = gestrichelter
  Stummel, „nicht eingetragen“ = Punkt, vor dem ersten Rückblick leer. Rechts Ø (Skalen) bzw.
  Summe (Sport), darunter eine Achse mit etwa sechs Beschriftungen. Für Screenreader trägt jeder
  Balken „KW 42 · 12.–18.10.2026: 4 von 5“. Darunter wiederkehrende Themen (≥ 2×) als Schalter,
  die die Liste der Rückblicke filtern. Keine Diagramm-Bibliothek. Legende: „Rückblicke · Verlauf“.
- **Geführtes Wochenreview (S1c, `/wochenreview`, ⌘K „Wochenreview“):** Kopf „KW 42 · Zeitraum“,
  Zusammenfassung (Schritt, Inbox, Projekte mit Blickbedarf), darunter die fünf Schritte als
  nummerierte Leiste (erledigt = grüner Haken, aktuell = helle Pille; am Handy nur Nummern) und
  der aktuelle Schritt als die eine gefüllte Karte: **Inbox** (dieselben Zeilen wie /inbox) →
  **Projekte** (aktive, festgefahrene und stille oben, je Zeile Ring, Grund, nächster Schritt mit
  „festlegen/ändern“ und Haken „durchgesehen“) → **Fälliges** (die nächste Woche als eine Zeile des
  Monatsrasters aus dem Kalender, mit Tageslast, Zusammenfassung „Termine · Aufgaben · voll“,
  Klick auf einen Tag öffnet ihn in /kalender) → **Wochenrückblick** (dieselben Leitfragen-Felder
  ohne Fokus) → **Fokus** (drei Punkte, Vorschläge: wichtige Fälligkeiten, nächste Schritte,
  übrige Fälligkeiten). Unten Zurück · Weiter · „Später weitermachen“; der Stand liegt am
  Wochenrückblick (`recaps.review`, Migration 33), gilt also auf jedem Gerät. „Abschließen“
  schließt den Wochenrückblick mit ab. Montags gilt noch die vergangene Woche.
- **Hinweis auf Heute:** ruhige Zeile unter der Zusammenfassung (Symbol, Text, Link) – sonntags
  „Sonntag: Zeit fürs Wochenreview (KW 42) · Starten“ bzw. „Schritt 3 von 5 · Weitermachen“
  (montags nur ein angefangenes), am Monatsletzten und in den ersten drei Tagen danach
  „Monatsrückblick Oktober 2026 · Schreiben“, bis er abgeschlossen ist.

## Verboten

- Emojis als UI-Icons, Verläufe, Glas-Effekte, schwere Schatten
- Modale Dialoge für Dinge, die inline gehen
- Spinner länger als 300 ms ohne Skeleton
- Eingaben, die beim Navigieren verloren gehen
- Text unter 12 px oder Kontrast unter WCAG AA
