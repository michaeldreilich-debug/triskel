"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleHelp,
  Flag,
  Globe,
  GripVertical,
  History,
  Inbox,
  Lock,
  Maximize2,
  PanelLeftClose,
  Plus,
  Repeat,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChecklistCount } from "@/components/ui/checklist-count";
import { DueDate } from "@/components/ui/due-date";
import { Kbd } from "@/components/ui/kbd";
import { AreaDot } from "@/components/ui/pill";
import { ProgressRing, ProjectStatusIcon } from "@/components/ui/progress-ring";
import { Sheet } from "@/components/ui/sheet";
import { TaskCheck, type TaskCheckStatus } from "@/components/ui/task-check";
import type { AreaSummary } from "@/features/areas/defaults";
import { LoadBar } from "@/features/calendar/components/day-parts";
import { EventLinkMarks } from "@/features/calendar/components/event-links";
import type { ProjectStatus } from "@/features/projects/types";
import { AiAssigneeBadge } from "@/features/tasks/components/task-item";
import { MilestoneMark } from "@/features/timeline/components/axis";
import { cn } from "@/lib/cn";
import { addDays, berlinDate } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";

type Row = [React.ReactNode, string];

/** Zeichen in der Legende: echte Bausteine, aber weder fokussierbar noch für Screenreader doppelt. */
function LegendSymbol({ children }: { children: React.ReactNode }) {
  return (
    <span inert aria-hidden className="flex w-16 shrink-0 items-center justify-center">
      {children}
    </span>
  );
}

function LegendGroup({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-meta uppercase tracking-widest text-faint">{title}</h3>
      <ul className="flex flex-col">
        {rows.map(([symbol, text]) => (
          <li key={text} className="flex min-h-8 items-center gap-2 text-ui-sm">
            <LegendSymbol>{symbol}</LegendSymbol>
            <span className="min-w-0 text-fg">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const check = (status: TaskCheckStatus, priority?: number) => (
  <TaskCheck status={status} priority={priority} tabIndex={-1} />
);

const project = (status: ProjectStatus, progress: number | null = null) => (
  <ProjectStatusIcon status={status} color="orange" progress={progress} />
);

const dot = (filled: boolean) => (
  <span
    className={cn(
      "size-2.5 rounded-full border-[1.5px]",
      filled ? "border-success bg-success" : "border-faint bg-bg",
    )}
  />
);

/**
 * Legende (Rückmeldung #25): was Farben, Kreise und Symbole bedeuten. Gebaut aus denselben
 * Bausteinen wie die Listen (Muster-Katalog in docs/02-design.md), damit sie nie veraltet.
 */
export function Legend({ areas }: { areas: AreaSummary[] }) {
  const today = berlinDate();
  return (
    <div className="flex flex-col gap-6 pb-4">
      <LegendGroup
        title="Aufgaben-Kreis"
        rows={[
          [check("offen"), "offen, normale Priorität"],
          [check("offen", 1), "rot: hohe Priorität"],
          [check("offen", 2), "gelb: mittlere Priorität"],
          [check("in_arbeit"), "halb gefüllt: in Arbeit"],
          [check("wartet"), "gestrichelt: wartet"],
          [check("erledigt"), "grün mit Haken: erledigt"],
          [
            <span key="list" className="text-meta text-faint">
              <ChecklistCount done={2} total={5} />
            </span>,
            "Checkliste: 2 von 5 Punkten erledigt",
          ],
          [
            <span key="all" className="text-meta text-faint">
              <ChecklistCount done={5} total={5} />
            </span>,
            "grünes Symbol: alle Punkte erledigt",
          ],
          [
            check("erledigt"),
            "Letzten Punkt abgehakt: die Aufgabe ist erledigt (Rückgängig in der Meldung); nimmst du danach einen Haken weg oder kommt ein Punkt dazu, ist sie wieder offen",
          ],
          [
            <ChevronDown key="cell" size={14} strokeWidth={1.5} className="text-faint" />,
            "Tabelle (Aufgaben, Notizen): Klick auf Status, Priorität, Datum, Projekt, Bereich, Typ, Thema oder Tags ändert den Wert direkt in der Zeile – der Titel öffnet den Eintrag",
          ],
        ]}
      />
      <LegendGroup
        title="Fälligkeit"
        rows={[
          [<DueDate key="over" value={addDays(today, -2)} today={today} />, "rot: überfällig"],
          [<DueDate key="today" value={today} today={today} />, "kräftig: heute fällig"],
          [<DueDate key="soon" value={addDays(today, 1)} today={today} />, "grau: morgen"],
          [<DueDate key="later" value={addDays(today, 9)} today={today} />, "blass: später"],
        ]}
      />
      <LegendGroup
        title="Projekte"
        rows={[
          [project("aktiv", 0.6), "Ring: aktiv, gefüllt = erledigter Anteil der Aufgaben"],
          [
            <ProgressRing key="empty" value={null} color="orange" label="" decorative />,
            "gestrichelter Ring: aktiv, noch ohne Aufgaben",
          ],
          [project("idee"), "gepunktet: Idee"],
          [project("geplant"), "gestrichelt: geplant"],
          [project("pausiert"), "mit Strichen: pausiert"],
          [project("abgeschlossen"), "grüner Haken: abgeschlossen"],
          [project("archiv"), "Kiste: archiviert"],
          [
            <AlertTriangle key="stuck" size={16} strokeWidth={1.5} className="text-warning" />,
            "festgefahren: Ergebnis oder nächster Schritt fehlt",
          ],
        ]}
      />
      <LegendGroup
        title="Bereiche"
        rows={[
          ...areas.map(
            (area): Row => [
              <AreaDot key={area.id} color={area.color} className="size-2.5" />,
              `${area.color === "orange" ? "Orange" : "Blau"}: ${area.name}`,
            ],
          ),
          [
            <span key="frame" className="h-5 w-10 rounded-control border border-area-orange" />,
            "Rahmen um die App: nur dieser Bereich ist gewählt, nicht „Alles“",
          ],
        ]}
      />
      <LegendGroup
        title="Wissen"
        rows={[
          [
            <span key="type" className="flex items-center gap-1 text-meta text-muted">
              <span className="flex size-4 items-center justify-center rounded-control border-[1.5px] border-accent bg-accent text-accent-fg">
                <Check size={11} strokeWidth={3} />
              </span>
              Typ
            </span>,
            "„zählt als Wissen“ am Notiz-Typ (Einstellungen › Notiz-Typen): nur Notizen dieser Typen stehen unter Wissen – mit und ohne Projekt; anfangs Wissen und Anleitung",
          ],
          [
            <span
              key="sort"
              className="inline-flex h-5 items-center gap-1 rounded-full border border-border-strong px-1.5 text-meta text-muted"
            >
              <Inbox size={11} strokeWidth={1.5} />3
            </span>,
            "„Noch einordnen · 3“: Notizen ohne Wissens-Typ und ohne Projekt (z. B. Ideen) – Typ wählen, dann stehen sie im Wissen; alle Notizen zeigt die Notizen-Datenbank",
          ],
          [
            <Maximize2 key="peek" size={14} strokeWidth={1.5} className="text-faint" />,
            "Notizen-Datenbank (Laptop): eine Notiz öffnet rechts als Panel, die Liste bleibt daneben; der Knopf oben bzw. Rechtsklick › „Im Wissen öffnen“ zeigt sie ganz",
          ],
          [
            <span key="check" className="text-meta text-muted">
              ☐ ☑
            </span>,
            "Umwandeln (Rechtsklick bzw. ⋯ › „In Notiz umwandeln“ / „In Aufgabe umwandeln“): Checklisten-Punkte einer Aufgabe stehen in der Notiz als Zeile mit ☐ bzw. ☑; das Original liegt im Papierkorb, Rückgängig holt es zurück",
          ],
          [
            <span
              key="public"
              className="inline-flex h-5 items-center gap-1 rounded-full border border-border-strong px-1.5 text-meta text-muted"
            >
              <Globe size={11} strokeWidth={1.75} />
              Öffentlich
            </span>,
            "„Öffentlich“ im Notiz-Kopf: jeder mit dem Link sieht Titel und Inhalt (ohne Eigenschaften) – Klick bzw. ⋯ › „Öffentlich freigeben …“ zeigt den Link und beendet die Freigabe; alle stehen unter Einstellungen › Freigaben",
          ],
        ]}
      />
      <LegendGroup
        title="Einplanen"
        rows={[
          [
            <span
              key="now"
              className="inline-flex h-5 items-center rounded-control bg-surface-2 px-1.5 text-meta uppercase tracking-widest text-muted"
            >
              Jetzt
            </span>,
            "getönter Block „Jetzt einplanen“: überfällig, in 7 Tagen fällig, Priorität hoch, Fokus heute/morgen – höchstens 7 Zeilen, der Rest hinter „N weitere“; jede Aufgabe steht nur einmal",
          ],
          [
            <span key="more" className="text-meta text-faint">
              + 2 Meilensteine · 18
            </span>,
            "Projekt: nur der nächste offene Meilenstein ist aufgeklappt, spätere stehen als Zeile; Projekte mit mehr als 8 Aufgaben sind zu",
          ],
          [
            <span key="ai" className="text-meta text-faint">
              von KI angelegt
            </span>,
            "Aufgabe, die Claude oder ChatGPT angelegt hat – im Filter „Einplanen-Anzeige“ und in der Aufgaben-Datenbank (Angelegt von) ein- und auszublenden",
          ],
          [
            <AiAssigneeBadge key="ki" task={{ assignee: "ai" }} />,
            "Zuständig: KI – Arbeitsschritt der KI, steht gedämpft nur im Projekt (nicht auf Heute, in der Inbox, im Kalender, in der Aufgaben-Datenbank); Aufgaben für dich bleiben überall sichtbar. Umstellen im Aufgaben-Panel oder per Rechtsklick",
          ],
        ]}
      />
      <LegendGroup
        title="Zeitleisten"
        rows={[
          [dot(true), "gefüllter grüner Punkt: erledigt oder erreicht"],
          [dot(false), "offener Punkt: geplant oder Notiz bearbeitet"],
          [<span key="now" className="h-px w-10 bg-fg" />, "Linie mit „jetzt“: aktuelle Uhrzeit"],
        ]}
      />
      <LegendGroup
        title="Zeitstrahl"
        rows={[
          [
            <span
              key="bar"
              className="h-2.5 w-12 rounded-full border border-area-orange bg-area-orange/20"
            >
              <span className="block h-full w-1/2 rounded-l-full bg-area-orange/70" />
            </span>,
            "Balken: Start bis Ziel eines Projekts in Bereichsfarbe, gefüllt = erledigte Aufgaben",
          ],
          [
            <span
              key="inf"
              className="h-2.5 w-12 rounded-full border border-dashed border-area-orange"
            />,
            "gestrichelt: nur Start oder nur Ziel eingetragen, der Rest ist abgeleitet",
          ],
          [<MilestoneMark key="done" state="done" />, "grüne Raute: Meilenstein erreicht"],
          [<MilestoneMark key="open" state="open" />, "leere Raute: Meilenstein offen"],
          [
            <span key="over" className="relative">
              <MilestoneMark state="overdue" />
              <AlertTriangle
                size={11}
                strokeWidth={2}
                className="absolute -top-1.5 -right-2 text-danger"
              />
            </span>,
            "rote Raute mit Warnzeichen: Meilenstein überfällig",
          ],
          [
            <span key="today" className="h-5 w-0 border-l-2 border-fg" />,
            "senkrechte Linie mit „heute“: der heutige Tag auf der Achse",
          ],
        ]}
      />
      <LegendGroup
        title="Kalender"
        rows={[
          [
            <span
              key="ev"
              className="flex h-4 w-10 items-center rounded-control border border-border border-l-2 border-l-ink-blau bg-surface-2"
            />,
            "Farbbalken: Termin aus Google (Kalenderfarbe); gestrichelt = als „frei“ markiert",
          ],
          [
            <span
              key="drag"
              className="relative flex h-4 w-10 cursor-grab items-center rounded-control border border-border border-l-2 border-l-ink-blau bg-surface-2"
            >
              <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-border-strong" />
            </span>,
            "Termin ziehbar (Hand-Zeiger): auf eine andere Uhrzeit oder einen anderen Tag, unten die Dauer – ⌘Z macht es rückgängig. Im Fenster Titel, Ort und Beschreibung ändern, Kalender wechseln, löschen (auch Rechtsklick oder Entf)",
          ],
          [
            <span
              key="new"
              className="flex h-4 w-10 items-center rounded-control border border-dashed border-border-strong bg-surface-2/80 px-1 text-meta text-muted"
            >
              ＋
            </span>,
            "Termin anlegen: auf freie Zeit klicken (1 h) oder ziehen, oder „＋ Termin“ oben – im Fenster Titel, Kalender, Zeit; Rückgängig macht es ungeschehen",
          ],
          [
            <Lock key="lock" size={14} strokeWidth={1.5} className="text-faint" />,
            "Termin nur lesbar („In Google nur lesbar“): bleibt fest – Feiertage, fremde Einladungen, abonnierte Kalender",
          ],
          [
            <span
              key="block"
              className="flex h-4 w-10 items-center gap-1 rounded-control border border-border bg-surface px-1"
            >
              <span className="size-2 rounded-full border-[1.5px] border-faint" />
            </span>,
            "Kasten mit Kreis: Zeitblock einer Aufgabe (geplant, Dauer unten ziehbar)",
          ],
          [
            <Repeat key="rep" size={14} strokeWidth={1.5} className="text-faint" />,
            "blass mit Pfeilen: künftiger Termin einer Wiederholung, nur vorausberechnet",
          ],
          [
            <Flag key="flag" size={14} strokeWidth={1.75} className="text-muted" />,
            "Fahne/Ziel: Frist – Meilenstein oder Projektziel; gelb an einem vollen Tag",
          ],
          [
            <LoadBar
              key="load"
              load={{ busyMinutes: 300, taskMinutes: 90, openTasks: 3, level: "voll" }}
              className="w-10"
            />,
            "Tageslast-Balken: Termine + Aufgaben über 8 h – grau normal, voll ab 6 h, gelb „überladen“ ab 8 h",
          ],
          [
            <span
              key="free"
              className="h-4 w-10 rounded-control border border-dashed border-border-strong/60"
            />,
            "gestrichelte Fläche im Raster: freies Fenster (≥ 1 h zwischen 8 und 18 Uhr)",
          ],
          [
            <EventLinkMarks key="links" counts={{ notes: 1, tasks: 2 }} compact />,
            "am Termin: verknüpfte Notizen und Aufgaben (auf Heute „Notiz · 1 · Aufgabe · 2“) – im Termin-Fenster unter „Verknüpft“; Notiz oder Aufgabe zeigen den Termin oben, gestrichelt, wenn Google ihn nicht mehr hat",
          ],
          [
            <span key="over" className="text-meta text-danger">
              überfällig
            </span>,
            "Überfälliges steht heute oben mit „überfällig seit …“, nicht in der Vergangenheit",
          ],
        ]}
      />
      <LegendGroup
        title="Rückblicke · Verlauf"
        rows={[
          [
            <span key="bars" className="flex h-4 items-end gap-0.5">
              <span className="h-2 w-2 rounded-sm bg-border-strong" />
              <span className="h-3 w-2 rounded-sm bg-border-strong" />
              <span className="h-4 w-2 rounded-sm bg-fg" />
            </span>,
            "Balken je Woche bzw. Monat (Skala 1–5, Sport als Zahl); hell = neuester Wert",
          ],
          [
            <span
              key="gap"
              className="h-1.5 w-6 rounded-sm border border-dashed border-border-strong"
            />,
            "gestrichelt: Woche oder Monat ohne Rückblick (Lücke)",
          ],
          [
            <span key="none" className="size-1 rounded-full bg-border-strong" />,
            "Punkt: Rückblick da, Wert nicht eingetragen",
          ],
        ]}
      />
      <LegendGroup
        title="Reiter"
        rows={[
          [
            <span
              key="tab"
              className="flex h-5 items-center gap-1 rounded-control border border-border bg-surface px-1.5 text-meta text-fg"
            >
              Notiz <X size={10} strokeWidth={2} className="text-faint" />
            </span>,
            "Reiterleiste oben (Desktop): jede offene Seite ein Reiter – Klick wechselt, ✕ oder Mittelklick schließt, Ziehen sortiert, ＋ öffnet Heute",
          ],
          [
            <Kbd key="click">⌘-Klick</Kbd>,
            "⌘-Klick oder Mittelklick auf einen Link oder in der Seitenleiste: in neuem Reiter (⌘⇧-Klick: Browser-Tab); ohne Taste öffnet es im aktuellen Reiter",
          ],
          [
            <Kbd key="keys">⌃⌥←→</Kbd>,
            "Reiter wechseln; in ⌘K auch „Reiter schließen“. Höchstens 8 – beim 9. schließt der am längsten nicht benutzte",
          ],
          [
            <span
              key="count"
              className="grid h-5 min-w-5 place-items-center rounded-control border-[1.5px] border-muted px-1 text-meta font-semibold text-fg"
            >
              3
            </span>,
            "Handy: Zähler oben – Tippen zeigt die offenen Seiten; „In neuem Reiter öffnen“ im Rechtsklick- bzw. Halten-Menü",
          ],
          [
            <span
              key="tabbar"
              className="grid size-5 place-items-center rounded-full bg-accent text-accent-fg"
            >
              <Plus size={14} strokeWidth={2} />
            </span>,
            "Handy (unter 768 px): Leiste unten mit Heute, Woche, ＋ (öffnet „Festhalten“: Aufgabe oder Notiz mit Datum, Bereich und Projekt; ein Wort wie „morgen“ im Text setzt das Datum), Wissen und Menü; der Platz der offenen Seite ist hervorgehoben. Beim Schreiben in ein Feld blendet sie sich aus und kommt danach zurück. Zwischen 768 und 1023 px bleibt das Menü oben in der Kopfzeile",
          ],
          [
            <History key="back" size={16} strokeWidth={1.5} className="text-faint" />,
            "Ein Reiter macht dort weiter, wo er aufgehört hat: Adresse, offene Aufgabe, Ansicht und Scroll-Stelle",
          ],
          [
            <PanelLeftClose key="fold" size={16} strokeWidth={1.5} className="text-faint" />,
            "Spalte einklappen (Laptop): kleiner Knopf oben in Seitenleiste, Themen, Notizliste, Steckbrief, Einplanen, offener Aufgabe und offener Notiz der Notizen-Datenbank – die Spalte wird zum senkrechten Reiter am Rand, ein Klick darauf klappt sie wieder auf",
          ],
          [
            <span key="resize" className="h-4 w-0.5 rounded-full bg-border-strong" />,
            "Spalte breiter ziehen (Laptop): an der Trennlinie von Seitenleiste, Themen, Notizliste, Verknüpfungen, Steckbrief, Einplanen, offener Aufgabe und Notiz sowie den rechten Spalten auf Heute, im Rückblick und in der Tag-Ansicht ziehen – Doppelklick stellt die Standardbreite wieder her, das Gerät merkt es sich",
          ],
          [
            <GripVertical key="drag" size={16} strokeWidth={1.5} className="text-faint" />,
            "Aufgabe ziehen im Projekt (Laptop): eine offene Aufgabe – aus dem Fahrplan, dem Reiter Aufgaben oder vom Kopf der offenen Aufgabe – auf „Nächster Schritt“ ziehen; der Kasten zeigt gestrichelt, dass er annimmt, Rückgängig macht es ungeschehen. Ohne Maus und am Handy bleibt „Nächsten Schritt festlegen“",
          ],
          [
            <GripVertical key="drag-today" size={16} strokeWidth={1.5} className="text-faint" />,
            "Aufgabenspalte auf Heute (ab 1280 px): „Andere Aufgabe wählen“ und „Fokus wählen“ öffnen sie rechts – eine Aufgabe auf einen freien Platz der Abendplanung bzw. auf „Fokus heute“ ziehen oder antippen, oben zwischen „Morgen“ und „Fokus heute“ umschalten; sind es 3, nimmt der Tag nichts mehr an. Schmaler bleibt die Auswahl mit Suche",
          ],
        ]}
      />
      <LegendGroup
        title="Speichern (unten links)"
        rows={[
          [
            <Check key="ok" size={14} strokeWidth={2} className="text-faint" />,
            "grau: gespeichert",
          ],
          [
            <span key="busy" className="text-meta text-warning">
              gelb
            </span>,
            "wird gespeichert",
          ],
          [
            <span key="err" className="text-meta text-danger">
              rot
            </span>,
            "Fehler, erneut versuchen",
          ],
        ]}
      />
    </div>
  );
}

/** Legende als Panel rechts, geöffnet über den Fuß der Seitenleiste oder ⌘K. */
export function LegendSheet({ areas }: { areas: AreaSummary[] }) {
  const open = useUi((s) => s.legendOpen);
  const setOpen = useUi((s) => s.setLegendOpen);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      side="right"
      title="Legende"
      description="Was Farben, Kreise und Symbole bedeuten"
    >
      <Legend areas={areas} />
    </Sheet>
  );
}

/** Knopf im Fuß der Seitenleiste. */
export function LegendButton({ onOpen }: { onOpen?: () => void }) {
  const setOpen = useUi((s) => s.setLegendOpen);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="md:size-7"
      aria-label="Legende: Farben und Symbole"
      title="Legende: Farben und Symbole"
      onClick={() => {
        onOpen?.();
        setOpen(true);
      }}
    >
      <CircleHelp size={16} strokeWidth={1.5} aria-hidden />
    </Button>
  );
}
