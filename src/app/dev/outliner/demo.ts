import type { JSONContent } from "@tiptap/core";
import type { NoteSummary } from "@/features/outliner/directory";

export const DEMO_NOTES: NoteSummary[] = [
  { id: "00000000-0000-4000-8000-0000000000a1", title: "Wartungsplan PA" },
  { id: "00000000-0000-4000-8000-0000000000a2", title: "Besprechung Werkstatt 09/26" },
  { id: "00000000-0000-4000-8000-0000000000a3", title: "Herstellerunterlagen PA" },
];

export const DEMO_TAGS = ["prüfung", "pa", "wartung", "werkstatt"];

const text = (value: string, bold = false): JSONContent =>
  bold ? { type: "text", text: value, marks: [{ type: "bold" }] } : { type: "text", text: value };

const block = (
  content: JSONContent[],
  children: JSONContent[] = [],
  collapsed = false,
): JSONContent => ({
  type: "block",
  attrs: { id: null, collapsed, taskId: null },
  content: [{ type: "paragraph", content }, ...children],
});

/** Beispielinhalt wie im Entwurf 08-Wissen („Prüffristen Atemschutzgeräte“). */
export const DEMO_DOC: JSONContent = {
  type: "doc",
  content: [
    block(
      [text("Pressluftatmer", true)],
      [
        block([
          text("Prüffristen laut Herstellerangabe, Details in "),
          { type: "noteLink", attrs: { noteId: DEMO_NOTES[0]?.id } },
        ]),
        block([text("Nach jedem Einsatz: Einsatzprüfung + Dokumentation")]),
      ],
    ),
    block(
      [text("Atemschutzmasken", true)],
      [
        block([text("Sichtprüfung vor jedem Einsatz")]),
        block([text("Dichtprüfung halbjährlich")]),
        block([text("Desinfektion nach Gebrauch")]),
      ],
      true,
    ),
    block(
      [text("Offene Punkte", true)],
      [block([text("Fristen-Export in die Werkstatt-App übernehmen")])],
    ),
  ],
};
