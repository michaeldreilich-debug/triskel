/**
 * Mehr Formatierung (Rückmeldung #40, „wie Tana/Notion“): Absatzarten und Farben – reine Daten
 * und Markdown-Regeln, ohne Editor. Gilt für Notizen (Outliner), Aufgaben-Notiz und den
 * Freitext der Projekte.
 *
 * Absatzart = Attribut `kind` am Absatz (`{type: "paragraph", attrs: {kind: "h2"}}`), damit der
 * Outliner bei „block → paragraph block*“ bleibt. Farben sind Token-Schlüssel (keine Farbwerte),
 * die das Theme in `styles/tokens.css` auflöst – Papier und Dunkel bleiben lesbar.
 */
import type { JSONContent } from "@tiptap/core";
import { PARAGRAPH } from "./names";

export const BLOCK_KINDS = ["h1", "h2", "h3", "quote", "callout", "divider"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  h1: "Überschrift 1",
  h2: "Überschrift 2",
  h3: "Überschrift 3",
  quote: "Zitat",
  callout: "Hinweis-Kasten",
  divider: "Trennlinie",
};

export const parseBlockKind = (value: unknown): BlockKind | null =>
  (BLOCK_KINDS as readonly unknown[]).includes(value) ? (value as BlockKind) : null;

export const TEXT_COLORS = ["grau", "rot", "orange", "gelb", "gruen", "blau", "lila"] as const;
export type TextColor = (typeof TEXT_COLORS)[number];
export const MARKER_COLORS = ["gelb", "gruen", "blau", "rot", "lila"] as const;
export type MarkerColor = (typeof MARKER_COLORS)[number];

export const COLOR_LABELS: Record<TextColor, string> = {
  grau: "Grau",
  rot: "Rot",
  orange: "Orange",
  gelb: "Gelb",
  gruen: "Grün",
  blau: "Blau",
  lila: "Lila",
};

export const parseTextColor = (value: unknown): TextColor | null =>
  (TEXT_COLORS as readonly unknown[]).includes(value) ? (value as TextColor) : null;
export const parseMarkerColor = (value: unknown): MarkerColor | null =>
  (MARKER_COLORS as readonly unknown[]).includes(value) ? (value as MarkerColor) : null;

/** Knotennamen der Markierungen */
export const TEXT_COLOR = "textColor";
export const MARKER = "marker";

/** Absatzart eines Absatzes (unbekannte Werte: normaler Text) */
export const kindOf = (paragraph: JSONContent | undefined): BlockKind | null =>
  parseBlockKind(paragraph?.attrs?.kind);

/** Absatz mit Art (ohne Art: ohne attrs, wie bisher gespeichert) */
export function paragraphWith(content: JSONContent[] | undefined, kind: BlockKind | null) {
  const node: JSONContent = { type: PARAGRAPH };
  if (kind) node.attrs = { kind };
  if (kind !== "divider" && content && content.length > 0) node.content = content;
  return node;
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

const MARKDOWN_PREFIX: Record<Exclude<BlockKind, "divider">, string> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
  quote: "> ",
  // Obsidian-Callout: „> [!note] Text“ zeigt einen Kasten mit dem Text als Titel
  callout: "> [!note] ",
};

/** Zeile eines Absatzes als Markdown (Export, KI, Zwischenablage). */
export function kindMarkdown(kind: BlockKind | null, text: string): string {
  if (!kind) return text;
  if (kind === "divider") return "---";
  return `${MARKDOWN_PREFIX[kind]}${text}`;
}

const DIVIDER = /^(?:-{3,}|\*{3,}|_{3,})$/;
const HEADING = /^(#{1,6})\s+/;
const CALLOUT = /^>\s*\[!\w+\][+-]?\s*/;
const QUOTE = /^>\s?/;

/** Absatzart aus einer Markdown-Zeile (ohne Listenzeichen) und der Rest des Texts. */
export function kindFromMarkdown(line: string): { kind: BlockKind | null; text: string } {
  const trimmed = line.trim();
  if (DIVIDER.test(trimmed)) return { kind: "divider", text: "" };
  const heading = HEADING.exec(trimmed);
  if (heading) {
    const level = Math.min((heading[1] as string).length, 3);
    return { kind: `h${level}` as BlockKind, text: trimmed.slice(heading[0].length) };
  }
  if (CALLOUT.test(trimmed)) return { kind: "callout", text: trimmed.replace(CALLOUT, "") };
  if (QUOTE.test(trimmed)) return { kind: "quote", text: trimmed.replace(QUOTE, "") };
  return { kind: null, text: line };
}
