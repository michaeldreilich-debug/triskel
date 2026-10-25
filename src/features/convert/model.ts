/**
 * Aufgabe ↔ Notiz umwandeln (#65, E36) – reine Umrechnung des Inhalts, ohne Editor und ohne
 * „use client“ (App und KI-Schnittstelle nutzen sie gleich).
 *
 * Aufgabe → Notiz: Absätze und Listen der Aufgaben-Notiz werden Outliner-Blöcke (Listenpunkte
 * mit Unterpunkten werden verschachtelt). Checklisten-Punkte bleiben als Zeile mit „☐ “ bzw.
 * „☑ “ erhalten – es entstehen keine neuen Aufgaben (Standardwahl). Bilder, Dateien und Notiz-
 * Links gehen unverändert mit (gleiche Speicherpfade, nichts wird neu hochgeladen).
 *
 * Notiz → Aufgabe: Blöcke werden Absätze, Unterpunkte Listenpunkte; Zeilen mit „☐ “/„☑ “ und
 * Aufgaben-Blöcke werden Checklisten-Punkte (Häkchen nach Status der Aufgabe), Tags als „#name“,
 * Diagramme als Code-Text (die Aufgaben-Notiz kennt weder Tags noch Diagramme).
 */
import type { JSONContent } from "@tiptap/core";
import { taskBodyText } from "@/features/ai/model/task-markdown";
import type { NoteRow } from "@/features/notes/types";
import {
  BLOCK,
  MERMAID,
  NOTE_FILE,
  NOTE_IMAGE,
  NOTE_LINK,
  PARAGRAPH,
  TAG,
} from "@/features/outliner/model/names";
import {
  type BlockRow,
  docToRows,
  inlineText,
  rowsToDoc,
} from "@/features/outliner/model/serializer";
import {
  type BlockKind,
  kindOf,
  MARKER,
  paragraphWith,
  TEXT_COLOR,
} from "@/features/outliner/model/text-style";
import { PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskRow } from "@/features/tasks/types";
import { formatDayShort } from "@/lib/dates";

/** Zeichen vor einem Checklisten-Punkt, der als Zeile in der Notiz steht */
export const CHECK_OPEN = "☐ ";
export const CHECK_DONE = "☑ ";

/** Marken, die Aufgaben-Notiz und Outliner gemeinsam kennen (alles andere fiele beim Laden weg) */
const KNOWN_MARKS = new Set(["bold", "italic", "strike", "code", "link", TEXT_COLOR, MARKER]);

type NewId = () => string;

const isList = (node: JSONContent) =>
  node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList";

/* ------------------------------------------------------------------ */
/* Inhalt einzelner Absätze                                            */
/* ------------------------------------------------------------------ */

function cleanMarks(node: JSONContent): JSONContent {
  if (!node.marks) return node;
  const marks = node.marks.filter((mark) => KNOWN_MARKS.has(mark.type));
  const { marks: _drop, ...rest } = node;
  return marks.length > 0 ? { ...rest, marks } : rest;
}

const textNode = (text: string, code = false): JSONContent =>
  code ? { type: "text", text, marks: [{ type: "code" }] } : { type: "text", text };

/** Diagramm als Text mit Code-Marke (Zeilen durch Umbrüche), vorn „Diagramm:“ */
function diagramInline(code: string): JSONContent[] {
  const lines = code.split("\n");
  const nodes: JSONContent[] = [textNode("Diagramm (Mermaid):")];
  for (const line of lines) {
    nodes.push({ type: "hardBreak" });
    if (line) nodes.push(textNode(line, true));
  }
  return nodes;
}

/** Inhalt eines Absatzes für das jeweils andere Schema bereinigen. */
function inlineFor(content: JSONContent[] | undefined, target: "outline" | "task"): JSONContent[] {
  const result: JSONContent[] = [];
  for (const node of content ?? []) {
    if (node.type === "text") {
      if (node.text) result.push(cleanMarks(node));
    } else if (node.type === TAG) {
      result.push(textNode(`#${node.attrs?.name ?? ""}`));
    } else if (node.type === MERMAID) {
      result.push(...(target === "task" ? diagramInline(String(node.attrs?.code ?? "")) : [node]));
    } else if (
      node.type === "hardBreak" ||
      node.type === NOTE_LINK ||
      node.type === NOTE_IMAGE ||
      node.type === NOTE_FILE
    ) {
      result.push(node);
    } else if (node.content) {
      result.push(...inlineFor(node.content, target));
    }
  }
  return result;
}

const hasContent = (paragraph: JSONContent | undefined) =>
  (paragraph?.content ?? []).some((n) => n.type !== "text" || (n.text ?? "").trim() !== "") ||
  kindOf(paragraph) === "divider";

/** Text vorn einfügen (Checklisten-Zeichen). */
function withPrefix(content: JSONContent[], prefix: string): JSONContent[] {
  const [first, ...rest] = content;
  if (first?.type === "text" && !first.marks?.length) {
    return [{ ...first, text: prefix + (first.text ?? "") }, ...rest];
  }
  return [textNode(prefix), ...content];
}

/** Führendes Checklisten-Zeichen abziehen: `[Zeichen entfernt?, Inhalt]`. */
function stripCheckbox(
  content: JSONContent[],
): { checked: boolean; content: JSONContent[] } | null {
  const [first, ...rest] = content;
  if (first?.type !== "text") return null;
  const text = first.text ?? "";
  const checked = text.startsWith(CHECK_DONE);
  if (!checked && !text.startsWith(CHECK_OPEN)) return null;
  const remaining = text.slice(CHECK_OPEN.length);
  return {
    checked,
    content: remaining ? [{ ...first, text: remaining }, ...rest] : rest,
  };
}

/* ------------------------------------------------------------------ */
/* Aufgabe → Notiz                                                     */
/* ------------------------------------------------------------------ */

function outlineBlock(paragraph: JSONContent, children: JSONContent[], newId: NewId): JSONContent {
  return {
    type: BLOCK,
    attrs: { id: newId(), collapsed: false, taskId: null },
    content: [paragraph, ...children],
  };
}

function outlineParagraph(paragraph: JSONContent, prefix = ""): JSONContent {
  let content = inlineFor(paragraph.content, "outline");
  if (prefix) content = withPrefix(content, prefix);
  return paragraphWith(content, kindOf(paragraph));
}

/** Weitere Knoten eines Listenpunkts (Absätze, verschachtelte Listen) → Unterpunkte. */
function outlineChildren(nodes: JSONContent[], newId: NewId): JSONContent[] {
  const blocks: JSONContent[] = [];
  for (const node of nodes) blocks.push(...outlineBlocksOf(node, newId));
  return blocks;
}

function outlineBlocksOf(node: JSONContent, newId: NewId): JSONContent[] {
  if (node.type === PARAGRAPH) {
    return hasContent(node) ? [outlineBlock(outlineParagraph(node), [], newId)] : [];
  }
  if (isList(node)) {
    return (node.content ?? []).flatMap((item, index) => {
      const [first, ...rest] = item.content ?? [];
      const prefix =
        node.type === "taskList"
          ? item.attrs?.checked
            ? CHECK_DONE
            : CHECK_OPEN
          : node.type === "orderedList"
            ? `${Number(node.attrs?.start ?? 1) + index}. `
            : "";
      const paragraph =
        first?.type === PARAGRAPH
          ? outlineParagraph(first, prefix)
          : paragraphWith(prefix ? [textNode(prefix.trim())] : [], null);
      const children = outlineChildren(
        first?.type === PARAGRAPH ? rest : (item.content ?? []),
        newId,
      );
      // ein leerer Listenpunkt ohne Inhalt fällt weg
      if (!hasContent(paragraph) && children.length === 0) return [];
      return [outlineBlock(paragraph, children, newId)];
    });
  }
  // unbekannter Knoten: sein Text bleibt erhalten
  const text = (node.content ?? []).map((n) => n.text ?? "").join("");
  return text.trim() ? [outlineBlock(paragraphWith([textNode(text)], null), [], newId)] : [];
}

/** Inhalt der Aufgabe (`tasks.body`) → Outline-Dokument (Blöcke mit frischen IDs). */
export function taskBodyToOutline(body: JSONContent | null | undefined, newId: NewId): JSONContent {
  const nodes = body?.type === "doc" ? (body.content ?? []) : body ? [body] : [];
  const blocks = nodes.flatMap((node) => outlineBlocksOf(node, newId));
  return {
    type: "doc",
    content: blocks.length > 0 ? blocks : [outlineBlock({ type: PARAGRAPH }, [], newId)],
  };
}

/** Zeilen für `note_blocks` (Eltern vor Kindern, Sortierschlüssel vergeben). */
export function taskBodyToRows(body: JSONContent | null | undefined, newId: NewId): BlockRow[] {
  const doc = taskBodyToOutline(body, newId);
  const rows = docToRows(doc);
  // eine leere Notiz braucht keine leere Zeile
  return rows.length === 1 && rows[0]?.content_text === "" && !rows[0].content.content?.length
    ? []
    : rows;
}

/** Was von der Aufgabe in der Notiz nicht ankommt (für die Meldung). */
/** Verknüpfungen der Aufgabe, die eine Notiz nicht kennt (V-8): der Aufrufer zählt sie. */
export interface TaskToNoteExtras {
  /** Termin-Verknüpfungen (event_links) */
  eventLinks?: number;
  /** Abhängigkeiten („Blockiert durch“, in beide Richtungen) */
  dependencies?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function lostByTaskToNote(task: TaskRow, extras: TaskToNoteExtras = {}): string[] {
  const lost: string[] = [];
  if (task.due_date) lost.push(`fällig ${formatDayShort(task.due_date)}`);
  if (task.scheduled_at) lost.push("geplante Zeit");
  if (task.priority) lost.push(`Priorität ${PRIORITY_LABELS[task.priority]}`);
  if (task.status !== "offen") lost.push(`Status ${TASK_STATUS_LABELS[task.status]}`);
  if (task.recurrence) lost.push("Wiederholung");
  if (task.milestone_id) lost.push("Meilenstein");
  if (extras.eventLinks)
    lost.push(plural(extras.eventLinks, "Termin-Verknüpfung", "Termin-Verknüpfungen"));
  if (extras.dependencies)
    lost.push(`${plural(extras.dependencies, "Abhängigkeit", "Abhängigkeiten")} (Blockiert durch)`);
  return lost;
}

/* ------------------------------------------------------------------ */
/* Notiz → Aufgabe                                                     */
/* ------------------------------------------------------------------ */

export interface NoteToTaskOptions {
  /** Aufgaben-Blöcke: ist die Aufgabe erledigt? (unbekannt = offen) */
  taskDone?: (taskId: string) => boolean | undefined;
  /** Titel verlinkter Notizen (für den Klartext) */
  resolveTitle?: (noteId: string) => string | undefined;
}

interface Item {
  checkbox: { checked: boolean } | null;
  paragraph: JSONContent;
  children: JSONContent[];
}

function taskParagraph(content: JSONContent[], kind: BlockKind | null): JSONContent {
  return paragraphWith(inlineFor(content, "task"), kind);
}

function itemOf(block: JSONContent, options: NoteToTaskOptions): Item {
  const [paragraph, ...children] = block.content ?? [];
  const kind = kindOf(paragraph);
  const content = paragraph?.content ?? [];
  const taskId = block.attrs?.taskId;
  const stripped = stripCheckbox(content);
  const checkbox =
    typeof taskId === "string" && taskId
      ? { checked: options.taskDone?.(taskId) === true }
      : stripped
        ? { checked: stripped.checked }
        : null;
  return {
    checkbox,
    paragraph: taskParagraph(stripped && !taskId ? stripped.content : content, kind),
    children: children.filter((c) => c.type === BLOCK),
  };
}

/** Geschwister-Blöcke → Listen (zusammenhängende Läufe gleicher Art in eine Liste). */
function taskLists(blocks: JSONContent[], options: NoteToTaskOptions): JSONContent[] {
  const lists: JSONContent[] = [];
  for (const block of blocks) {
    const item = itemOf(block, options);
    const kind = item.checkbox ? "taskList" : "bulletList";
    const node: JSONContent = {
      type: item.checkbox ? "taskItem" : "listItem",
      ...(item.checkbox ? { attrs: { checked: item.checkbox.checked } } : {}),
      content: [item.paragraph, ...taskLists(item.children, options)],
    };
    const last = lists[lists.length - 1];
    if (last?.type === kind) last.content = [...(last.content ?? []), node];
    else lists.push({ type: kind, content: [node] });
  }
  return lists;
}

/** Oberste Ebene: einfache Blöcke werden Absätze, Checkboxen eine Checkliste. */
function taskTop(blocks: JSONContent[], options: NoteToTaskOptions): JSONContent[] {
  const nodes: JSONContent[] = [];
  let run: JSONContent[] = [];
  const flush = () => {
    if (run.length > 0) nodes.push(...taskLists(run, options));
    run = [];
  };
  for (const block of blocks) {
    const item = itemOf(block, options);
    if (item.checkbox) {
      run.push(block);
      continue;
    }
    flush();
    nodes.push(item.paragraph, ...taskLists(item.children, options));
  }
  flush();
  return nodes;
}

/** Zeilen der Notiz → Inhalt der Aufgabe (`tasks.body`); eine leere Notiz ergibt `null`. */
export function rowsToTaskBody(
  rows: Iterable<BlockRow>,
  options: NoteToTaskOptions = {},
): JSONContent | null {
  const live = [...rows].filter((row) => !row.deleted_at);
  if (live.length === 0) return null;
  const doc = rowsToDoc(live);
  const top = (doc.content ?? []).filter((n) => n.type === BLOCK);
  const nodes = taskTop(top, options);
  // leere Absätze am Anfang/Ende und doppelte Leerzeilen sind in der Aufgaben-Notiz nur Rauschen
  const trimmed = nodes.filter((node, index, all) => {
    if (node.type !== PARAGRAPH || hasContent(node)) return true;
    return index > 0 && index < all.length - 1 && hasContent(all[index - 1]);
  });
  return trimmed.some((n) => n.type !== PARAGRAPH || hasContent(n))
    ? { type: "doc", content: trimmed }
    : null;
}

/** Klartext der Aufgaben-Notiz (`tasks.body_text`). */
export const bodyTextOf = (body: JSONContent | null, options: NoteToTaskOptions = {}) =>
  taskBodyText(body, { resolveTitle: options.resolveTitle });

/** Was von der Notiz in der Aufgabe nicht ankommt (für die Meldung). */
/** Verknüpfungen der Notiz, die eine Aufgabe nicht kennt (V-8): der Aufrufer zählt sie. */
export interface NoteToTaskExtras {
  /** Termin-Verknüpfungen (event_links) */
  eventLinks?: number;
  /** öffentliche Freigabe – ruht, solange die Notiz im Papierkorb liegt */
  shared?: boolean;
}

export function lostByNoteToTask(
  note: Pick<NoteRow, "tags" | "topic_id" | "type">,
  defaultType: string,
  extras: NoteToTaskExtras = {},
): string[] {
  const lost: string[] = [];
  if (note.type !== defaultType) lost.push("Typ");
  if (note.topic_id) lost.push("Thema");
  if (note.tags.length > 0) lost.push("Tags");
  if (extras.eventLinks)
    lost.push(plural(extras.eventLinks, "Termin-Verknüpfung", "Termin-Verknüpfungen"));
  if (extras.shared) lost.push("öffentliche Freigabe (ruht im Papierkorb)");
  return lost;
}

/** Erste Zeile der neuen Notiz für die Listenvorschau. */
export function snippetOf(rows: BlockRow[]): string {
  const first = rows.find((row) => row.parent_id === null);
  return first ? inlineText(first.content.content) : "";
}

/** Zusatz für die Meldung: „(Fälligkeit, Priorität gehen nicht mit)“ */
export function lostSuffix(lost: string[]): string {
  return lost.length > 0 ? ` · ${lost.join(", ")} gehen nicht mit` : "";
}
