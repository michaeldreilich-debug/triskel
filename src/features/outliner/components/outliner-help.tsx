"use client";

import { Keyboard } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";

/** Zeichen und Kürzel des Outliners – eine Quelle für die Hilfe in der App und die Spielwiese. */
export const OUTLINER_HELP: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: "Beim Tippen",
    rows: [
      ["((", "Notiz verlinken (Titel tippen, Enter)"],
      ["⌘ Enter", "am Notiz-Link: Notiz öffnen (auch per Rechtsklick)"],
      ["#", "Tag, z. B. #wartung"],
      ["@jetzt / @heute", "+ Leertaste: Zeitstempel (17.10.2026 20:45) bzw. Datum"],
      ["**fett**", "fett"],
      ["*kursiv*", "kursiv"],
      ["~~weg~~", "durchgestrichen"],
      ["`Code`", "Code"],
      ["www.…", "Web-Adresse wird zum Link"],
      ["() oder []", "am Anfang: Punkt wird zur Aufgabe (mit Checkbox)"],
      ["Bild", "Ecke unten rechts ziehen = Größe; oben rechts − / + und Zuschneiden"],
      ["```mermaid", "+ Leertaste am Anfang: Diagramm (Code eingeben, die App zeichnet)"],
      [
        "⌘ V / Ziehen",
        "Bild oder Datei (PDF …) einfügen – auch irgendwo auf die Notiz ziehen, oder ＋ oben",
      ],
    ],
  },
  {
    title: "Absatz und Farbe",
    rows: [
      ["# / ## / ###", "+ Leertaste am Anfang: Überschrift 1, 2, 3 (⌘ ⌥ 1–3)"],
      ["> ", "am Anfang: Zitat"],
      ["---", "am Anfang einer leeren Zeile: Trennlinie"],
      ["==Text==", "Marker (⌘ ⇧ H)"],
      ["Rücktaste", "am Anfang einer Überschrift: wieder normaler Text"],
      ["Rechtsklick", "Absatz (auch Hinweis-Kasten) und Farbe; am Handy „Aa“ in der Leiste"],
    ],
  },
  {
    title: "Text markieren",
    rows: [
      [
        "Leiste",
        "Fett, Kursiv, Durchgestrichen, Code, Absatz und Farbe, Link, als Notiz verlinken",
      ],
      ["Rechtsklick", "zusätzlich: Punkt in Aufgabe umwandeln, Aufgabe öffnen"],
    ],
  },
  {
    title: "Gliedern",
    rows: [
      ["Enter", "neuer Punkt"],
      ["⇧ Enter", "Zeilenumbruch im Punkt"],
      ["Tab / ⇧ Tab", "einrücken / ausrücken"],
      ["Esc", "Editor verlassen (danach geht Tab weiter)"],
      ["⌥ ⇧ ↑ / ↓", "Punkt samt Unterpunkten verschieben"],
      ["⌘ ↑ / ↓", "einklappen / ausklappen"],
      ["⌘ Z / ⌘ ⇧ Z", "rückgängig / wiederholen"],
      ["⌘ B / I / E", "fett / kursiv / Code"],
    ],
  },
];

export type HelpSections = typeof OUTLINER_HELP;

/** Knopf mit Spickzettel: welche Zeichen und Tasten der Editor versteht. */
export function OutlinerHelp({ sections = OUTLINER_HELP }: { sections?: HelpSections }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Zeichen und Tastenkürzel">
          <Keyboard size={16} strokeWidth={1.5} aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={16}
          aria-label="Zeichen und Tastenkürzel"
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-32px)] flex-col gap-4 overflow-y-auto rounded-card border border-border bg-surface p-4 text-fg shadow-float data-[state=open]:animate-pop-in"
        >
          {sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-1.5">
              <h2 className="text-meta uppercase tracking-widest text-faint">{section.title}</h2>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-sm">
                {section.rows.map(([keys, label]) => (
                  <div key={keys} className="contents">
                    <dt className="font-mono text-muted whitespace-nowrap">{keys}</dt>
                    <dd className="text-fg">{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
