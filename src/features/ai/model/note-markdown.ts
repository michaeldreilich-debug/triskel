/**
 * Notiz-Inhalt für die KI-Schnittstelle (#33): Markdown → neue Outline-Zeilen (note_blocks).
 * Rein, ohne Editor und ohne Datenbank. Gelesen wird über den Export (`createRenderer().note`),
 * damit Lesen und Schreiben dieselbe Form haben: verschachtelte Liste, `[[Titel]]`, `- [ ]` für
 * Aufgaben-Blöcke, ```mermaid unter dem Listenpunkt.
 */
import type { JSONContent } from "@tiptap/core";
import { generateNKeysBetween } from "fractional-indexing";
import { BLOCK } from "@/features/outliner/model/names";
import { parseOutlineText } from "@/features/outliner/model/paste";
import { type BlockRow, docToRows } from "@/features/outliner/model/serializer";
import { isValidKey } from "@/lib/sort-key";

/** Checkbox-Zeile, die als Aufgabe angelegt wird (wie „Block → Aufgabe“ in der App). */
export interface PlannedTask {
  id: string;
  title: string;
  done: boolean;
}

export interface NoteRowsPlan {
  rows: BlockRow[];
  tasks: PlannedTask[];
}

export interface NoteRowsOptions {
  newId: () => string;
  /** Notiz-ID zu einem Titel (für `[[Titel]]`); unbekannte Titel bleiben Text */
  resolveNoteByTitle?: (title: string) => string | undefined;
  /** Titel verlinkter Notizen für content_text (Suche) */
  resolveTitle?: (noteId: string) => string | undefined;
  /** Sortierschlüssel des bisher letzten Blocks oben (Anhängen); null = leere Notiz */
  afterSort?: string | null;
  /** `![[…]]`/`[[…]]` auf Bilder und Dateien, die schon in der Notiz stehen (`existingMediaResolver`) */
  resolveMedia?: (ref: string) => JSONContent | undefined;
}

function assignIds(blocks: JSONContent[], newId: () => string): void {
  for (const block of blocks) {
    if (block.type !== BLOCK) continue;
    block.attrs = { ...block.attrs, id: newId() };
    assignIds((block.content ?? []).slice(1), newId);
  }
}

/** Markdown → neue Blockzeilen (alle IDs neu); oben hinter `afterSort` einsortiert. */
export function markdownToNoteRows(markdown: string, options: NoteRowsOptions): NoteRowsPlan {
  const tasks: PlannedTask[] = [];
  const blocks = parseOutlineText(markdown, {
    resolveNoteByTitle: options.resolveNoteByTitle,
    resolveMedia: options.resolveMedia,
    onTask: (title, done) => {
      const id = options.newId();
      tasks.push({ id, title: title || "Ohne Titel", done });
      return id;
    },
  });
  if (blocks.length === 0) return { rows: [], tasks };
  assignIds(blocks, options.newId);
  const rows = docToRows({ type: "doc", content: blocks }, [], {
    resolveTitle: options.resolveTitle,
  });
  // oben: hinter den vorhandenen Blöcken (Kinder neuer Blöcke behalten ihre Schlüssel)
  const top = rows.filter((row) => row.parent_id === null);
  const after = options.afterSort && isValidKey(options.afterSort) ? options.afterSort : null;
  const keys = generateNKeysBetween(after, null, top.length);
  top.forEach((row, index) => {
    row.sort = keys[index] as string;
  });
  return { rows, tasks };
}

/** Letzter Sortierschlüssel oben unter den lebenden Blöcken (für Anhängen). */
export function lastTopSort(rows: Iterable<Pick<BlockRow, "parent_id" | "sort" | "deleted_at">>) {
  let last: string | null = null;
  for (const row of rows) {
    if (row.parent_id !== null || row.deleted_at) continue;
    if (last === null || row.sort > last) last = row.sort;
  }
  return last;
}
