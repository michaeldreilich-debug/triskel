/**
 * Vorlagen (B11) als reine Funktionen: Projekt-Vorlage lesen und schreiben, Notiz-Vorlage als
 * Gliederung (eine Zeile je Punkt, zwei Leerzeichen = eine Ebene tiefer) ↔ TipTap-Dokument und
 * Zeilen für note_blocks mit frischen IDs.
 */
import type { JSONContent } from "@tiptap/core";
import { type BlockRow, docToRows, inlineText } from "@/features/outliner/model/serializer";
import { newId } from "@/lib/id";

/* ------------------------------------------------------------------ */
/* Projekt                                                            */
/* ------------------------------------------------------------------ */

export interface ProjectTemplate {
  why: string;
  /** „Fertig ist es, wenn …“ */
  outcome: string[];
  /** Meilensteine (Titel) in Reihenfolge */
  milestones: string[];
  /** Aufgaben (Titel), landen im Projekt */
  tasks: string[];
}

const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) =>
          typeof item === "string"
            ? item
            : typeof item === "object" && item !== null && "text" in item
              ? String((item as { text: unknown }).text ?? "")
              : "",
        )
        .map((text) => text.trim())
        .filter(Boolean)
    : [];

export function parseProjectTemplate(body: Record<string, unknown>): ProjectTemplate {
  return {
    why: typeof body.why === "string" ? body.why : "",
    outcome: texts(body.outcome),
    milestones: texts(body.milestones),
    tasks: texts(body.tasks),
  };
}

export const projectTemplateBody = (template: ProjectTemplate): Record<string, unknown> => ({
  why: template.why,
  outcome: template.outcome,
  milestones: template.milestones,
  tasks: template.tasks,
});

/** Hat die Vorlage überhaupt etwas zum Anwenden? Leere Vorlagen werden nicht angeboten. */
export const hasProjectContent = (t: ProjectTemplate) =>
  t.why.trim() !== "" || t.outcome.length + t.milestones.length + t.tasks.length > 0;

/** Zeilen eines Textfelds (eine je Punkt), ohne Leerzeilen. */
export const splitLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/* ------------------------------------------------------------------ */
/* Notiz: Gliederung ↔ Dokument                                       */
/* ------------------------------------------------------------------ */

const isBlock = (node: JSONContent) => node.type === "block";

/** Inhalt einer Notiz-Vorlage als Dokument (Migration 09: {type: "doc", content: [block…]}). */
export function noteTemplateDoc(body: Record<string, unknown>): JSONContent {
  const content = Array.isArray(body.content) ? (body.content as JSONContent[]) : [];
  return { type: "doc", content: content.filter(isBlock) };
}

/** Dokument → Gliederung als Text (Einrückung mit zwei Leerzeichen je Ebene). */
export function docToLines(doc: JSONContent): string {
  const lines: string[] = [];
  const walk = (blocks: JSONContent[], depth: number) => {
    for (const block of blocks.filter(isBlock)) {
      const [paragraph, ...children] = block.content ?? [];
      lines.push(`${"  ".repeat(depth)}${inlineText(paragraph?.content).replace(/\n/g, " ")}`);
      walk(children, depth + 1);
    }
  };
  walk(doc.content ?? [], 0);
  return lines.join("\n");
}

const paragraph = (text: string): JSONContent =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };

/**
 * Gliederung → Dokument. Einrückung: zwei Leerzeichen oder ein Tab je Ebene; ein Punkt kann
 * höchstens eine Ebene tiefer stehen als der vorige. Führende „- “ oder „• “ fallen weg.
 */
export function linesToDoc(text: string): JSONContent {
  const root: JSONContent = { type: "doc", content: [] };
  // Stapel der zuletzt angelegten Blöcke je Ebene
  const stack: JSONContent[] = [];
  for (const raw of text.replace(/\t/g, "  ").split("\n")) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const depth = Math.min(Math.floor(indent / 2), stack.length);
    const label = raw
      .trim()
      .replace(/^[-•*]\s+/, "")
      .trim();
    const block: JSONContent = { type: "block", content: [paragraph(label)] };
    stack.length = depth;
    const parent = depth === 0 ? root : (stack[depth - 1] as JSONContent);
    parent.content = [...(parent.content ?? []), block];
    stack.push(block);
  }
  return root;
}

/** Kopie mit neuen Block-IDs (jede Anwendung erzeugt eigene Blöcke). */
export function withFreshIds(doc: JSONContent): JSONContent {
  const copy = (node: JSONContent): JSONContent => ({
    ...node,
    ...(isBlock(node) ? { attrs: { ...node.attrs, id: newId(), collapsed: false } } : {}),
    ...(node.content ? { content: node.content.map(copy) } : {}),
  });
  return copy(doc);
}

/** Zeilen für note_blocks aus einer Notiz-Vorlage (frische IDs). */
export function templateRows(body: Record<string, unknown>): BlockRow[] {
  return docToRows(withFreshIds(noteTemplateDoc(body)));
}

/** Ist eine Notiz leer (höchstens ein leerer Block ohne Unterpunkte)? */
export function isEmptyDoc(doc: JSONContent): boolean {
  const blocks = (doc.content ?? []).filter(isBlock);
  if (blocks.length === 0) return true;
  if (blocks.length > 1) return false;
  const [paragraphNode, ...children] = blocks[0]?.content ?? [];
  return children.length === 0 && !(paragraphNode?.content ?? []).length;
}

/* ------------------------------------------------------------------ */
/* Rückblick: neue Fragen                                             */
/* ------------------------------------------------------------------ */

/** Schlüssel für eine eigene Leitfrage (Antwort landet in recaps.answers). */
export const newQuestionKey = () => `q_${newId().slice(0, 8)}`;
