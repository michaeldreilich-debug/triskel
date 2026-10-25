/**
 * KI-Protokoll (#33, Migration 20) in der App: Einträge lesen, Links zum Eintrag, und was sich
 * zurückholen lässt. Rückgängig läuft wie jede Änderung über die Speicher-Warteschlange
 * (Operationen aus `undoOps`); gelöschte Blöcke und in den Papierkorb gelegte Einträge kommen per
 * `deleted_at = null` zurück.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { TASK_STATUSES } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import type { SaveOp } from "@/lib/save-queue/save-queue";
import { RPC_TASK_STATUS } from "@/lib/save-queue/supabase-persister";
import type { Database } from "@/lib/supabase/database.types";
import { type EventUndo, parseEventUndo } from "./event-undo-model";

export const activityKey = ["ai-activity"] as const;
export const ACTIVITY_LIMIT = 20;

export interface ActivityRow {
  id: string;
  client_id: string;
  tool: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  undo: unknown;
  undone_at: string | null;
  created_at: string;
}

export async function fetchActivity(client: SupabaseClient<Database>): Promise<ActivityRow[]> {
  const { data, error } = await client
    .from("ai_activity")
    .select("id, client_id, tool, entity, entity_id, summary, undo, undone_at, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_LIMIT);
  if (error) throw error;
  return data;
}

/** Wohin der Eintrag in der App führt (Termine: auf den Tag im Kalender, Datum steht in `undo`). */
export function activityHref(
  row: Pick<ActivityRow, "entity" | "entity_id"> & { undo?: unknown },
): string | null {
  if (row.entity === "termin") {
    const date = isObject(row.undo) ? row.undo.date : null;
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? appPath.calendar(date, "tag")
      : null;
  }
  if (!row.entity_id) return null;
  if (row.entity === "notiz") return appPath.note(row.entity_id);
  if (row.entity === "projekt") return appPath.project(row.entity_id);
  if (row.entity === "aufgabe") return appPath.task(row.entity_id);
  if (row.entity === "rueckblick") return appPath.recap(row.entity_id);
  return null;
}

export type Undo =
  | {
      kind: "replace";
      note_id: string;
      removed: string[];
      added: string[];
      note_before?: Record<string, unknown>;
      /** Aufgaben aus `- [ ]` des neuen Inhalts (S-4) */
      tasks_added?: string[];
    }
  | { kind: "append"; note_id: string; added: string[]; tasks_added?: string[] }
  | {
      kind: "update";
      table: UndoTable;
      id: string;
      before: Record<string, unknown>;
      /** Werte nach der KI-Änderung – zum Erkennen späterer eigener Änderungen (D-8) */
      after?: Record<string, unknown>;
      status?: Undo;
      /** Projekt: Meilenstein-Werte vorher (je ID) und neu angelegte Meilensteine (S-10) */
      milestones_before?: Record<string, Record<string, unknown>>;
      milestones_added?: string[];
    }
  | { kind: "complete"; task_id: string }
  /** `restore`: Folgeaufgaben, die das Wiederöffnen in den Papierkorb legte (S-3) */
  | { kind: "status"; task_id: string; before: string; restore?: string[] }
  | { kind: "trash"; table: UndoTable; id: string }
  /** Aufgabe ↔ Notiz umgewandelt (#65): das Original zurückholen, das Neue in den Papierkorb */
  | { kind: "convert"; restore: UndoRef; trash: UndoRef }
  /** Google-Termine (N1d): Rückgängig läuft über die Termin-Routen der App, nicht über die Warteschlange */
  | EventUndo;

/** Rückgängig, das die App über die Routen `/api/kalender/termin*` ausführt (`event-undo.ts`). */
export const isEventUndo = (undo: Undo | null): undo is EventUndo =>
  undo?.kind === "event_create" || undo?.kind === "event_update" || undo?.kind === "event_delete";

export interface UndoRef {
  table: UndoTable;
  id: string;
}

/**
 * Tabellen, deren Rückgängig ein einfaches Update ist (Rückblicke seit Migration 34, update_recap;
 * Termin-Verknüpfungen seit Migration 43: link_event/unlink_event)
 */
export type UndoTable = "notes" | "tasks" | "projects" | "recaps" | "event_links";
const UPDATABLE = new Set<string>(["notes", "tasks", "projects", "recaps", "event_links"]);

/**
 * Positivliste der Spalten, die Rückgängig je Tabelle zurückschreibt (M-1/K-4): Die Daten
 * stammen aus `ai_activity`, wo ein KI-Token mit aal1 beliebiges eintragen kann – die App führt
 * das Rückgängig aber mit aal2 aus. Deshalb zählt nur, was die Werkzeuge selbst ändern dürfen:
 * nie `deleted_at` (holt aus dem Papierkorb), `user_id`, `id`, `status` (geht über die RPC),
 * nie Art/Zeitraum eines Rückblicks. Einzige Ausnahme `event_links.deleted_at` (link_event legt
 * seine Verknüpfung beim Rückgängig selbst in den Papierkorb).
 */
const UNDO_COLUMNS: Record<UndoTable | "milestones", ReadonlySet<string>> = {
  notes: new Set(["title", "type", "area_id", "topic_id", "project_id", "task_id", "tags"]),
  tasks: new Set([
    "title",
    "priority",
    "due_date",
    "scheduled_at",
    "duration_min",
    "focus_date",
    "recurrence",
    "area_id",
    "project_id",
    "milestone_id",
    "in_inbox",
    "assignee",
    "body",
    "body_text",
  ]),
  projects: new Set([
    "title",
    "status",
    "priority",
    "start_date",
    "target_date",
    "why",
    "area_id",
    "outcome",
    "links",
    "body",
    "body_text",
    "next_task_id",
  ]),
  recaps: new Set([
    "mood",
    "energy",
    "sport",
    "relations",
    "learning",
    "answers",
    "focus_next",
    "themes",
  ]),
  event_links: new Set(["deleted_at"]),
  milestones: new Set(["title", "due_date", "done_at"]),
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const ids = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
/** optionale ID-Liste nur übernehmen, wenn sie etwas enthält */
const optionalIds = (key: string, value: unknown) => {
  const list = ids(value);
  return list.length ? { [key]: list } : {};
};
/** nur erlaubte Spalten; `deleted_at` (event_links) nur als Zeitpunkt oder null */
function allowedValues(table: UndoTable | "milestones", value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {};
  const allowed = UNDO_COLUMNS[table];
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, v]) =>
        allowed.has(key) && (key !== "deleted_at" || v === null || typeof v === "string"),
    ),
  );
}
/** optionales Objekt nur, wenn nach dem Filtern etwas bleibt */
const optionalValues = (key: string, table: UndoTable | "milestones", value: unknown) => {
  const values = allowedValues(table, value);
  return Object.keys(values).length ? { [key]: values } : {};
};
const milestonesById = (value: unknown) =>
  isObject(value)
    ? Object.fromEntries(
        Object.entries(value)
          .map(([id, values]) => [id, allowedValues("milestones", values)])
          .filter(([, values]) => Object.keys(values as object).length),
      )
    : {};

/** Rückgängig-Daten prüfen (stammen aus der Datenbank, also defensiv lesen). */
export function parseUndo(value: unknown): Undo | null {
  if (!isObject(value)) return null;
  switch (value.kind) {
    case "replace":
    case "append":
      if (typeof value.note_id !== "string") return null;
      return value.kind === "replace"
        ? {
            kind: "replace",
            note_id: value.note_id,
            removed: ids(value.removed),
            added: ids(value.added),
            ...optionalValues("note_before", "notes", value.note_before),
            ...optionalIds("tasks_added", value.tasks_added),
          }
        : {
            kind: "append",
            note_id: value.note_id,
            added: ids(value.added),
            ...optionalIds("tasks_added", value.tasks_added),
          };
    case "update": {
      if (typeof value.table !== "string" || !UPDATABLE.has(value.table)) return null;
      if (typeof value.id !== "string" || !isObject(value.before)) return null;
      const table = value.table as UndoTable;
      const status = value.status ? parseUndo(value.status) : null;
      const milestones = milestonesById(value.milestones_before);
      return {
        kind: "update",
        table,
        id: value.id,
        before: allowedValues(table, value.before),
        ...optionalValues("after", table, value.after),
        ...(status ? { status } : {}),
        ...(table === "projects" && Object.keys(milestones).length
          ? { milestones_before: milestones as Record<string, Record<string, unknown>> }
          : {}),
        ...(table === "projects" ? optionalIds("milestones_added", value.milestones_added) : {}),
      };
    }
    case "complete":
      return typeof value.task_id === "string"
        ? { kind: "complete", task_id: value.task_id }
        : null;
    case "status":
      return typeof value.task_id === "string" &&
        typeof value.before === "string" &&
        (TASK_STATUSES as readonly string[]).includes(value.before)
        ? {
            kind: "status",
            task_id: value.task_id,
            before: value.before,
            ...optionalIds("restore", value.restore),
          }
        : null;
    case "event_create":
    case "event_update":
    case "event_delete":
      return parseEventUndo(value);
    case "trash":
      return typeof value.table === "string" &&
        UPDATABLE.has(value.table) &&
        typeof value.id === "string"
        ? { kind: "trash", table: value.table as UndoTable, id: value.id }
        : null;
    case "convert": {
      const restore = undoRef(value.restore);
      const trash = undoRef(value.trash);
      return restore && trash ? { kind: "convert", restore, trash } : null;
    }
    default:
      return null;
  }
}

function undoRef(value: unknown): UndoRef | null {
  return isObject(value) &&
    typeof value.table === "string" &&
    UPDATABLE.has(value.table) &&
    typeof value.id === "string"
    ? { table: value.table as UndoTable, id: value.id }
    : null;
}

export const canUndo = (row: Pick<ActivityRow, "undo" | "undone_at">) =>
  !row.undone_at && parseUndo(row.undo) !== null;

/**
 * Notizen, die ein Rückgängig berührt (Titel, Eigenschaften, Blöcke, Papierkorb). Ist eine davon
 * öffentlich freigegeben, fragt die App nach (M-1/K-4): Rückgängig läuft mit aal2 und würde die
 * Sperre aus Migration 46 umgehen – gelöschte Blöcke oder die ganze Notiz kämen auf die
 * öffentliche Seite.
 */
export function undoNoteIds(undo: Undo | null): string[] {
  if (!undo) return [];
  switch (undo.kind) {
    case "replace":
    case "append":
      return [undo.note_id];
    case "update":
    case "trash":
      return undo.table === "notes" ? [undo.id] : [];
    case "convert":
      return [undo.restore, undo.trash].filter((r) => r.table === "notes").map((r) => r.id);
    default:
      return [];
  }
}

/**
 * Von der KI eingefügte Blöcke, die seitdem bearbeitet wurden (K-2): Einfügen setzt `created_at`
 * und `updated_at` gleich, jede spätere Änderung (auch vom iPhone) rückt `updated_at` vor.
 * Rückgängig würde sie weich löschen – die App fragt dann wie bei Feldern (D-8) nach.
 */
export function editedBlockIds(
  rows: Array<{ id: string; created_at: string; updated_at: string }>,
): string[] {
  return rows
    .filter((row) => Date.parse(row.updated_at) > Date.parse(row.created_at))
    .map((row) => row.id);
}

/** Operationen für die Speicher-Warteschlange; zuletzt wird der Eintrag als zurückgeholt markiert. */
export function undoOps(row: Pick<ActivityRow, "id" | "undo">, now: string): SaveOp[] {
  const undo = parseUndo(row.undo);
  if (!undo) return [];
  // Termine: erst die Routen (ai-section), danach nur noch der Vermerk „zurückgeholt“
  if (isEventUndo(undo)) {
    return [{ table: "ai_activity", id: row.id, mode: "update", values: { undone_at: now } }];
  }
  const ops: SaveOp[] = [];
  const trashTasks = (list: string[] | undefined) => {
    for (const id of list ?? [])
      ops.push({ table: "tasks", id, mode: "update", values: { deleted_at: now } });
  };
  const add = (current: Undo) => {
    switch (current.kind) {
      case "replace":
        for (const id of current.removed)
          ops.push({ table: "note_blocks", id, mode: "update", values: { deleted_at: null } });
        for (const id of current.added)
          ops.push({ table: "note_blocks", id, mode: "update", values: { deleted_at: now } });
        if (current.note_before)
          ops.push({
            table: "notes",
            id: current.note_id,
            mode: "update",
            values: current.note_before,
          });
        trashTasks(current.tasks_added);
        break;
      case "append":
        for (const id of current.added)
          ops.push({ table: "note_blocks", id, mode: "update", values: { deleted_at: now } });
        trashTasks(current.tasks_added);
        break;
      case "update":
        if (Object.keys(current.before).length > 0)
          ops.push({
            table: current.table,
            id: current.id,
            mode: "update",
            values: current.before,
          });
        for (const [id, values] of Object.entries(current.milestones_before ?? {}))
          ops.push({ table: "milestones", id, mode: "update", values });
        for (const id of current.milestones_added ?? [])
          ops.push({ table: "milestones", id, mode: "update", values: { deleted_at: now } });
        if (current.status) add(current.status);
        break;
      case "complete":
        ops.push({
          table: RPC_TASK_STATUS,
          id: current.task_id,
          mode: "update",
          values: { action: "undo" },
        });
        break;
      case "status":
        // vom Wiederöffnen weggeräumte Folgeaufgaben zurück; abhaken dann ohne neue (S-3)
        for (const id of current.before === "erledigt" ? (current.restore ?? []) : [])
          ops.push({ table: "tasks", id, mode: "update", values: { deleted_at: null } });
        ops.push(
          current.before === "erledigt"
            ? {
                table: RPC_TASK_STATUS,
                id: current.task_id,
                mode: "update",
                values: { action: "complete" },
              }
            : {
                table: "tasks",
                id: current.task_id,
                mode: "update",
                values: { status: current.before },
              },
        );
        break;
      case "trash":
        ops.push({
          table: current.table,
          id: current.id,
          mode: "update",
          values: { deleted_at: null },
        });
        break;
      case "convert":
        ops.push(
          {
            table: current.restore.table,
            id: current.restore.id,
            mode: "update",
            values: { deleted_at: null },
          },
          {
            table: current.trash.table,
            id: current.trash.id,
            mode: "update",
            values: { deleted_at: now },
          },
        );
        break;
    }
  };
  add(undo);
  ops.push({ table: "ai_activity", id: row.id, mode: "update", values: { undone_at: now } });
  return ops;
}

/** Gleicher Wert? Objekte ohne Rücksicht auf die Schlüssel-Reihenfolge (jsonb), Zeitpunkte als Zeitpunkt. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "string" && typeof b === "string") {
    const timestamp = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
    return timestamp.test(a) && timestamp.test(b) && Date.parse(a) === Date.parse(b);
  }
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && sameValue(a[key], b[key]))
    );
  }
  return false;
}

/** abgeleitete Spalten (aus `body` berechnet) zählen nicht als eigene Änderung */
const DERIVED = new Set(["body_text"]);

/**
 * Felder, die seit der KI-Änderung anders sind (D-8): Rückgängig würde dort spätere eigene
 * Änderungen überschreiben – die App fragt dann nach. Ohne `after` (ältere Einträge) leer.
 */
export function undoConflicts(undo: Undo | null, current: Record<string, unknown>): string[] {
  if (undo?.kind !== "update" || !undo.after) return [];
  const after = undo.after;
  return Object.keys(undo.before).filter(
    (key) => !DERIVED.has(key) && key in after && !sameValue(current[key], after[key]),
  );
}

const FIELD_LABELS: Record<string, string> = {
  title: "Titel",
  body: "Notiz",
  status: "Status",
  priority: "Priorität",
  due_date: "Fälligkeit",
  scheduled_at: "Geplant",
  duration_min: "Dauer",
  focus_date: "Fokus",
  recurrence: "Wiederholung",
  area_id: "Bereich",
  project_id: "Projekt",
  milestone_id: "Meilenstein",
  topic_id: "Thema",
  type: "Typ",
  tags: "Tags",
  goal: "Ziel",
  outcome: "Ergebnis",
  links: "Links",
  start_date: "Start",
  target_date: "Ziel-Datum",
  next_task_id: "Nächster Schritt",
  mood: "Stimmung",
  energy: "Energie",
  sport: "Sport",
  relations: "Beziehungen",
  learning: "Lernen",
  answers: "Antworten",
  focus_next: "Fokus",
  themes: "Themen",
  /** von der KI eingefügte Blöcke, seitdem bearbeitet (K-2) */
  blocks: "Inhalt",
};

/** Feldname für die Rückfrage („Titel, Notiz“). */
export const fieldLabel = (key: string) => FIELD_LABELS[key] ?? key;
