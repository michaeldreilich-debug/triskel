/**
 * Eingefügter Text → Outline-Blöcke (eigener Paste-Handler, Plan Abschnitt 1):
 * mehrzeiliger Text und Markdown-Listen (-, *, +, 1.) mit Einrückung (Tab oder Leerzeichen).
 * Inline: **fett**, *kursiv*, `Code`, ~~durchgestrichen~~, ==Marker==, [Text](https://…), [[Notiz]], #tag.
 * Absatzarten (#40): „# “ bis „### “ Überschrift, „> “ Zitat, „> [!note] “ Hinweis, „---“ Linie.
 * Code-Blöcke (```): Mermaid wird ein Diagramm (unter einem Listenpunkt wie im Export: im selben
 * Block), anderer Code eine Zeile je Block als `Code`.
 * Blöcke bekommen keine ID – die vergibt der Editor (eindeutig, auch beim Einfügen von Kopien).
 */
import type { JSONContent } from "@tiptap/core";
import { BLOCK, MERMAID, NOTE_LINK, TAG } from "./names";
import {
  type BlockKind,
  kindFromMarkdown,
  MARKER as MARKER_MARK,
  paragraphWith,
} from "./text-style";

export interface PasteOptions {
  /** Notiz-ID zu einem Titel (für [[Titel]]); unbekannte Titel bleiben Text */
  resolveNoteByTitle?: (title: string) => string | undefined;
  /** #tag als Tag-Knoten (Standard); false = bleibt Text (Aufgaben-Notiz kennt keine Tags) */
  tags?: boolean;
  /**
   * Checkbox-Zeilen (`- [ ]`, `- [x]`) als Aufgaben-Block: liefert die Aufgaben-ID für den Block.
   * Ohne Rückruf fällt die Checkbox weg (Einfügen im Editor).
   */
  onTask?: (title: string, done: boolean) => string | undefined;
  /**
   * `![[…]]`/`[[…]]` auf ein Bild bzw. eine Datei, die schon im Eintrag stehen → deren Knoten
   * (KI-Schnittstelle, `existingMediaResolver`); geht vor Notiz-Titeln. Ohne: bleibt Text.
   */
  resolveMedia?: (ref: string) => JSONContent | undefined;
}

const MARKER = /^(?:[-*+]|\d+[.)])\s+/;
const CHECKBOX = /^\[([ xX])\]\s+/;
const FENCE = /^(`{3,}|~{3,})\s*([\w-]*)\s*$/;

function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

const INLINE =
  /\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|\*(?!\s)(.+?)(?<!\s)\*|\[\[([^\]]+)\]\]|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(^|\s)#([\p{L}\p{N}_-]{1,50})|==([^=\n]+?)==/gu;

export function parseInline(text: string, options: PasteOptions = {}): JSONContent[] {
  const nodes: JSONContent[] = [];
  const pushText = (value: string, marks?: JSONContent["marks"]) => {
    if (!value) return;
    nodes.push(marks ? { type: "text", text: value, marks } : { type: "text", text: value });
  };
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    const [whole, bold, strike, code, italic, linkTitle, label, href, tagPrefix, tagName, marked] =
      match;
    const media = linkTitle !== undefined ? options.resolveMedia?.(linkTitle.trim()) : undefined;
    if (media) {
      // „!“ davor (Bild bzw. ganz angezeigtes PDF) gehört zum Verweis
      const embed = index > last && text[index - 1] === "!";
      pushText(text.slice(last, embed ? index - 1 : index));
      nodes.push(media);
    } else if (linkTitle !== undefined) {
      const noteId = options.resolveNoteByTitle?.(linkTitle.trim());
      if (!noteId) continue; // unbekannte Notiz: als Text stehen lassen (keine offenen Verweise)
      pushText(text.slice(last, index));
      nodes.push({ type: NOTE_LINK, attrs: { noteId } });
    } else if (tagName !== undefined) {
      if (options.tags === false) continue;
      pushText(text.slice(last, index) + (tagPrefix ?? ""));
      nodes.push({ type: TAG, attrs: { name: tagName } });
    } else {
      pushText(text.slice(last, index));
      if (bold !== undefined) pushText(bold, [{ type: "bold" }]);
      else if (strike !== undefined) pushText(strike, [{ type: "strike" }]);
      else if (code !== undefined) pushText(code, [{ type: "code" }]);
      else if (italic !== undefined) pushText(italic, [{ type: "italic" }]);
      else if (label !== undefined) pushText(label, [{ type: "link", attrs: { href } }]);
      else if (marked !== undefined)
        pushText(marked, [{ type: MARKER_MARK, attrs: { color: "gelb" } }]);
    }
    last = index + whole.length;
  }
  pushText(text.slice(last));
  return nodes;
}

type Item =
  | { kind: "line"; indent: number; text: string }
  | { kind: "fence"; indent: number; lang: string; lines: string[] };

/** Zeilen → Einträge; Code-Blöcke (```) bleiben zusammen, Leerzeilen außerhalb fallen weg. */
function scan(text: string): Item[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const items: Item[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const open = FENCE.exec(line.trim());
    if (open) {
      const indent = indentWidth(line);
      const closing = new RegExp(`^\\${(open[1] as string)[0]}{3,}\\s*$`);
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !closing.test((lines[j] as string).trim()))
        code.push(lines[j++] as string);
      // ohne schließenden Zaun: alles Folgende ist Code (wie Markdown)
      items.push({ kind: "fence", indent, lang: (open[2] ?? "").toLowerCase(), lines: code });
      i = j;
      continue;
    }
    if (line.trim().length > 0) items.push({ kind: "line", indent: indentWidth(line), text: line });
  }
  return items;
}

/** Code-Zeilen um die Einrückung des Zauns kürzen (Tabs zählen 4). */
function dedent(lines: string[], width: number): string[] {
  return lines.map((line) => {
    let cut = 0;
    let seen = 0;
    while (cut < line.length && seen < width && (line[cut] === " " || line[cut] === "\t")) {
      seen += line[cut] === "\t" ? 4 : 1;
      cut += 1;
    }
    return line.slice(cut);
  });
}

const newBlock = (
  content: JSONContent[],
  taskId: string | null = null,
  kind: BlockKind | null = null,
): JSONContent => ({
  type: BLOCK,
  attrs: { id: null, collapsed: false, taskId },
  content: [paragraphWith(content, kind)],
});

/** Text → Blöcke. Gibt [] zurück, wenn der Text leer ist. */
export function parseOutlineText(text: string, options: PasteOptions = {}): JSONContent[] {
  const items = scan(text);
  if (items.length === 0) return [];
  const minIndent = Math.min(...items.map((item) => item.indent));

  const root: JSONContent[] = [];
  const stack: Array<{ indent: number; block: JSONContent }> = [];
  const place = (block: JSONContent, indent: number) => {
    while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= indent)
      stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) (parent.block.content as JSONContent[]).push(block);
    else root.push(block);
    stack.push({ indent, block });
  };

  for (const item of items) {
    const indent = item.indent - minIndent;
    if (item.kind === "fence") {
      const code = dedent(item.lines, item.indent).join("\n").replace(/\s+$/, "");
      if (item.lang === "mermaid") {
        const diagram: JSONContent = { type: MERMAID, attrs: { code } };
        // Export-Form: Diagramm eingerückt unter seinem Listenpunkt → im selben Block
        const owner = stack[stack.length - 1];
        if (owner && owner.indent < indent) {
          const paragraph = (owner.block.content as JSONContent[])[0] as JSONContent;
          paragraph.content = [...(paragraph.content ?? []), diagram];
        } else place(newBlock([diagram]), indent);
      } else {
        for (const line of code.split("\n")) {
          if (!line.trim()) continue;
          place(newBlock([{ type: "text", text: line, marks: [{ type: "code" }] }]), indent);
        }
      }
      continue;
    }
    let body = item.text.trim();
    body = body.replace(MARKER, "");
    const checkbox = CHECKBOX.exec(body);
    body = body.replace(CHECKBOX, "");
    // Überschrift, Zitat, Hinweis, Trennlinie (#40) – vorher wurden Überschriften fett
    const styled = kindFromMarkdown(body);
    const content = styled.kind === "divider" ? [] : parseInline(styled.text.trim(), options);
    const title = content
      .map((n) => (n.type === "text" ? n.text : n.type === TAG ? `#${n.attrs?.name}` : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    const taskId = checkbox ? (options.onTask?.(title, checkbox[1] !== " ") ?? null) : null;
    place(newBlock(content, taskId, styled.kind), indent);
  }
  return root;
}
