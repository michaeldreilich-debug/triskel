/**
 * Serializer Dokument ↔ Zeilen (note_blocks) und Diff gegen den zuletzt gespeicherten Stand.
 * Reine Funktionen auf TipTap-JSON, ohne Editor.
 *
 * Sortierung per Fractional Indexing: Bestehende Schlüssel bleiben erhalten, soweit sie in der
 * neuen Reihenfolge aufsteigend sind (längste aufsteigende Teilfolge); nur verschobene oder neue
 * Blöcke bekommen neue Schlüssel. Beim Verschieben ändert sich so nur eine Zeile.
 */
import type { JSONContent } from "@tiptap/core";
import { generateNKeysBetween } from "fractional-indexing";
import { exportFileName } from "./files";
import { BLOCK, MERMAID, NOTE_FILE, NOTE_IMAGE, NOTE_LINK, PARAGRAPH, TAG } from "./names";
import { kindMarkdown, kindOf, MARKER, paragraphWith } from "./text-style";

export interface BlockRow {
  id: string;
  parent_id: string | null;
  sort: string;
  /** Absatz als TipTap-JSON ({type: "paragraph", content: [...]}) */
  content: JSONContent;
  content_text: string;
  collapsed: boolean;
  task_id: string | null;
  deleted_at?: string | null;
}

export interface SerializeOptions {
  /** Titel verlinkter Notizen für content_text (Suche); ohne Auflöser bleibt „[[]]“ */
  resolveTitle?: (noteId: string) => string | undefined;
  /** nur Markdown: Aufgaben-Blöcke als Checkliste (`- [ ]` / `- [x]`), Export B14 */
  taskDone?: (taskId: string) => boolean;
}

/** Klartext eines Absatzes (für Suche und Vorschau). */
export function inlineText(
  content: JSONContent[] | undefined,
  options: SerializeOptions = {},
): string {
  if (!content) return "";
  return content
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      if (node.type === "hardBreak") return "\n";
      if (node.type === NOTE_LINK)
        return `[[${options.resolveTitle?.(String(node.attrs?.noteId ?? "")) ?? ""}]]`;
      if (node.type === TAG) return `#${node.attrs?.name ?? ""}`;
      // Bild: Alternativtext; Diagramm: der Code (durchsuchbar)
      if (node.type === NOTE_IMAGE) return `[Bild${node.attrs?.alt ? `: ${node.attrs.alt}` : ""}]`;
      if (node.type === MERMAID) return `Diagramm: ${node.attrs?.code ?? ""}`;
      if (node.type === NOTE_FILE) return `[Datei: ${node.attrs?.name ?? ""}]`;
      return inlineText(node.content, options);
    })
    .join("");
}

/** Neue Sortierschlüssel nur dort, wo die bisherigen nicht mehr aufsteigend passen. */
export function assignSortKeys(previous: Array<string | undefined>): string[] {
  const n = previous.length;
  // längste streng aufsteigende Teilfolge der vorhandenen Schlüssel (O(n²), Geschwisterlisten sind klein)
  const length = new Array<number>(n).fill(0);
  const before = new Array<number>(n).fill(-1);
  let bestEnd = -1;
  for (let i = 0; i < n; i++) {
    const key = previous[i];
    if (key === undefined) continue;
    length[i] = 1;
    for (let j = 0; j < i; j++) {
      const other = previous[j];
      if (other !== undefined && other < key && (length[j] as number) + 1 > (length[i] as number)) {
        length[i] = (length[j] as number) + 1;
        before[i] = j;
      }
    }
    if (bestEnd === -1 || (length[i] as number) > (length[bestEnd] as number)) bestEnd = i;
  }
  const keep = new Set<number>();
  for (let i = bestEnd; i !== -1; i = before[i] as number) keep.add(i);

  const result = new Array<string>(n);
  let i = 0;
  while (i < n) {
    if (keep.has(i)) {
      result[i] = previous[i] as string;
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !keep.has(j)) j += 1;
    const left = i > 0 ? (result[i - 1] as string) : null;
    const right = j < n ? (previous[j] as string) : null;
    const keys = generateNKeysBetween(left, right, j - i);
    for (let k = i; k < j; k++) result[k] = keys[k - i] as string;
    i = j;
  }
  return result;
}

/** Absatz ohne fremde Attribute; nur die Absatzart (#40) bleibt erhalten. */
function normalizeParagraph(node: JSONContent | undefined): JSONContent {
  if (!node || node.type !== PARAGRAPH) return { type: PARAGRAPH };
  return paragraphWith(node.content, kindOf(node));
}

/** Dokument → flache Zeilen (Vorordnung: Eltern stehen vor ihren Kindern). */
export function docToRows(
  doc: JSONContent,
  previous: Iterable<BlockRow> = [],
  options: SerializeOptions = {},
): BlockRow[] {
  const prev = new Map<string, BlockRow>();
  for (const row of previous) prev.set(row.id, row);
  const rows: BlockRow[] = [];
  const seen = new Set<string>();

  const walk = (blocks: JSONContent[], parentId: string | null) => {
    const list = blocks.filter((b) => b.type === BLOCK);
    const ids = list.map((block) => {
      const id = block.attrs?.id;
      if (typeof id !== "string" || id.length === 0) throw new Error("Outline-Block ohne ID");
      if (seen.has(id)) throw new Error(`Outline-Block-ID doppelt: ${id}`);
      seen.add(id);
      return id;
    });
    const keys = assignSortKeys(
      ids.map((id) => {
        const old = prev.get(id);
        return old && old.parent_id === parentId && !old.deleted_at ? old.sort : undefined;
      }),
    );
    list.forEach((block, index) => {
      const [paragraph, ...children] = block.content ?? [];
      const content = normalizeParagraph(paragraph);
      const id = ids[index] as string;
      rows.push({
        id,
        parent_id: parentId,
        sort: keys[index] as string,
        content,
        content_text: inlineText(content.content, options),
        collapsed: Boolean(block.attrs?.collapsed) && children.some((c) => c.type === BLOCK),
        task_id: typeof block.attrs?.taskId === "string" ? block.attrs.taskId : null,
      });
      walk(children, id);
    });
  };

  walk(doc.content ?? [], null);
  return rows;
}

/** Zeilen → Dokument. Gelöschte Zeilen fallen weg; verwaiste oder zyklische Zeilen landen oben (nichts geht verloren). */
export function rowsToDoc(rows: Iterable<BlockRow>): JSONContent {
  const live = [...rows].filter((row) => !row.deleted_at);
  const byId = new Map(live.map((row) => [row.id, row]));
  const children = new Map<string | null, BlockRow[]>();
  for (const row of live) {
    const parent =
      row.parent_id && byId.has(row.parent_id) && row.parent_id !== row.id ? row.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push(row);
    children.set(parent, list);
  }
  const bySort = (a: BlockRow, b: BlockRow) =>
    a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.id < b.id ? -1 : 1;
  const visited = new Set<string>();

  const build = (row: BlockRow): JSONContent => {
    visited.add(row.id);
    const kids = (children.get(row.id) ?? []).filter((c) => !visited.has(c.id)).sort(bySort);
    const childNodes = kids.map(build);
    return {
      type: BLOCK,
      attrs: { id: row.id, collapsed: row.collapsed && childNodes.length > 0, taskId: row.task_id },
      content: [normalizeParagraph(row.content), ...childNodes],
    };
  };

  const top = (children.get(null) ?? []).sort(bySort).map(build);
  // Zyklen (a → b → a) erreicht man von oben nicht: trotzdem anzeigen
  for (const row of [...live].sort(bySort)) if (!visited.has(row.id)) top.push(build(row));

  return {
    type: "doc",
    content:
      top.length > 0
        ? top
        : [
            {
              type: BLOCK,
              attrs: { id: null, collapsed: false, taskId: null },
              content: [{ type: PARAGRAPH }],
            },
          ],
  };
}

export interface RowDiff {
  /** neue oder geänderte Zeilen (vollständig, für Upsert) */
  upserts: BlockRow[];
  /** entfernte Block-IDs (→ deleted_at setzen, nie hart löschen) */
  removed: string[];
}

function sameRow(a: BlockRow, b: BlockRow): boolean {
  return (
    a.parent_id === b.parent_id &&
    a.sort === b.sort &&
    a.content_text === b.content_text &&
    a.collapsed === b.collapsed &&
    a.task_id === b.task_id &&
    JSON.stringify(a.content) === JSON.stringify(b.content)
  );
}

export function diffRows(previous: Iterable<BlockRow>, next: Iterable<BlockRow>): RowDiff {
  const before = new Map<string, BlockRow>();
  for (const row of previous) if (!row.deleted_at) before.set(row.id, row);
  const upserts: BlockRow[] = [];
  const nextIds = new Set<string>();
  for (const row of next) {
    nextIds.add(row.id);
    const old = before.get(row.id);
    if (!old || !sameRow(old, row)) upserts.push(row);
  }
  const removed = [...before.keys()].filter((id) => !nextIds.has(id));
  return { upserts, removed };
}

/** Outline als Markdown-Liste (Zwischenablage, Export B14). */
export function outlineToMarkdown(
  blocks: JSONContent[],
  options: SerializeOptions = {},
  depth = 0,
): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type !== BLOCK) continue;
    const [paragraph, ...children] = block.content ?? [];
    const taskId = block.attrs?.taskId;
    const box =
      options.taskDone && typeof taskId === "string"
        ? options.taskDone(taskId)
          ? "[x] "
          : "[ ] "
        : "";
    const inline = (paragraph?.content ?? []).filter((n) => n.type !== MERMAID);
    const diagrams = (paragraph?.content ?? []).filter((n) => n.type === MERMAID);
    // Absatzart (#40): „- ## Titel“, „- > Zitat“, „- ---“ (Obsidian zeigt das im Listenpunkt)
    const text = kindMarkdown(kindOf(paragraph), inlineMarkdown(inline, options));
    lines.push(`${"  ".repeat(depth)}- ${box}${text}`.replace(/\s+$/, ""));
    // Diagramme als ```mermaid-Block im Listenpunkt (Obsidian zeichnet ihn)
    const pad = "  ".repeat(depth + 1);
    for (const diagram of diagrams) {
      const code = String(diagram.attrs?.code ?? "").trimEnd();
      lines.push(
        `${pad}\`\`\`mermaid`,
        ...code.split("\n").map((l) => (l ? pad + l : "")),
        `${pad}\`\`\``,
      );
    }
    const nested = outlineToMarkdown(children, options, depth + 1);
    if (nested) lines.push(nested);
  }
  return lines.join("\n");
}

/** Inhalt eines Absatzes als Markdown (Export, KI-Schnittstelle). */
export function inlineMarkdown(
  content: JSONContent[] | undefined,
  options: SerializeOptions = {},
): string {
  if (!content) return "";
  return content
    .map((node) => {
      if (node.type === "hardBreak") return " ";
      if (node.type === NOTE_LINK)
        return `[[${options.resolveTitle?.(String(node.attrs?.noteId ?? "")) ?? ""}]]`;
      if (node.type === TAG) return `#${node.attrs?.name ?? ""}`;
      // Bild als Obsidian-Einbettung; die Datei liegt im Export unter „Anhänge/“
      if (node.type === NOTE_IMAGE) {
        const file = String(node.attrs?.path ?? "")
          .split("/")
          .pop();
        return file ? `![[${file}]]` : "";
      }
      // Datei: ganz angezeigtes PDF eingebettet, sonst als Link (Datei unter „Anhänge/“)
      if (node.type === NOTE_FILE) {
        const path = String(node.attrs?.path ?? "");
        if (!path) return "";
        const file = exportFileName(path, String(node.attrs?.name ?? "Datei"));
        return node.attrs?.view === "full" ? `![[${file}]]` : `[[${file}]]`;
      }
      if (node.type !== "text") return inlineMarkdown(node.content, options);
      let text = node.text ?? "";
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = `**${text}**`;
        else if (mark.type === "italic") text = `*${text}*`;
        else if (mark.type === "code") text = `\`${text}\``;
        else if (mark.type === "strike") text = `~~${text}~~`;
        else if (mark.type === "link") text = `[${text}](${mark.attrs?.href ?? ""})`;
        // Marker wie in Obsidian; Textfarbe hat kein Markdown (bleibt nur in der App)
        else if (mark.type === MARKER) text = `==${text}==`;
      }
      return text;
    })
    .join("");
}

/** Aufgaben-Blöcke → Klartext des Absatzes (für „Block → Aufgabe“: Titel der Aufgabe). */
export function taskBlockTexts(
  doc: JSONContent,
  options: SerializeOptions = {},
): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (node: JSONContent) => {
    if (node.type === BLOCK) {
      const taskId = node.attrs?.taskId;
      const [paragraph] = node.content ?? [];
      if (typeof taskId === "string" && taskId && !result.has(taskId)) {
        result.set(taskId, inlineText(paragraph?.content, options).replace(/\s+/g, " ").trim());
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return result;
}
