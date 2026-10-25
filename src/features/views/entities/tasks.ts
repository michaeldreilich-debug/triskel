import type { TaskContext } from "@/features/tasks/components/task-item";
import { recurrenceLabel } from "@/features/tasks/recurrence";
import {
  ASSIGNEE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskRow,
  taskTitle,
} from "@/features/tasks/types";
import { berlinDate } from "@/lib/dates";
import type { FieldDef, Filter, ViewConfig } from "../engine";

export interface TaskViewCtx extends TaskContext {
  /** Titel der blockierenden Aufgaben je Aufgabe */
  blockersOf: (taskId: string) => TaskRow[];
}

const projectTitleOf = (task: TaskRow, ctx: TaskViewCtx) =>
  ctx.projects.find((p) => p.id === task.project_id)?.title ?? null;

export const TASK_FIELDS: FieldDef<TaskRow, TaskViewCtx>[] = [
  {
    key: "title",
    label: "Titel",
    type: "text",
    value: (t) => taskTitle(t),
    sortable: true,
    column: true,
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    value: (t) => t.status,
    options: () => TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] })),
    filterable: true,
    sortable: true,
    groupable: true,
    column: true,
  },
  {
    key: "priority",
    label: "Priorität",
    type: "enum",
    value: (t) => (t.priority ? String(t.priority) : ""),
    options: () => [
      ...PRIORITIES.map((p) => ({ value: String(p), label: PRIORITY_LABELS[p] })),
      { value: "", label: "Keine" },
    ],
    filterable: true,
    sortable: true,
    groupable: true,
    column: true,
  },
  {
    key: "due_date",
    label: "Fällig",
    type: "date",
    value: (t) => t.due_date,
    filterable: true,
    sortable: true,
    groupable: true,
    column: true,
  },
  {
    key: "scheduled_at",
    label: "Geplant",
    type: "date",
    value: (t) => (t.scheduled_at ? berlinDate(t.scheduled_at) : null),
    filterable: true,
    sortable: true,
    column: true,
  },
  {
    key: "project",
    label: "Projekt",
    type: "enum",
    value: (t) => t.project_id ?? "",
    options: (ctx) => [
      ...[...ctx.projects]
        .sort((a, b) => a.title.localeCompare(b.title, "de"))
        .map((p) => ({ value: p.id, label: p.title.trim() || "Ohne Titel" })),
      { value: "", label: "Ohne Projekt" },
    ],
    // #79: Aufgaben ohne Projekt stehen in Liste und Tabelle oben
    groupOrder: [""],
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    key: "area",
    label: "Bereich",
    type: "enum",
    value: (t) => t.area_id ?? "",
    options: (ctx) => [
      ...ctx.areas.map((a) => ({ value: a.id, label: a.name })),
      { value: "", label: "Inbox" },
    ],
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    key: "blocked",
    label: "Blockiert",
    type: "enum",
    value: (t, ctx) => (ctx.blocked.has(t.id) && t.status !== "erledigt" ? "ja" : "nein"),
    options: () => [
      { value: "ja", label: "Blockiert" },
      { value: "nein", label: "Nicht blockiert" },
    ],
    filterable: true,
    groupable: true,
  },
  {
    key: "blocked_by",
    label: "Blockiert durch",
    type: "text",
    value: (t, ctx) =>
      ctx
        .blockersOf(t.id)
        .filter((b) => b.status !== "erledigt")
        .map((b) => taskTitle(b))
        .join(", ") || null,
    column: true,
  },
  {
    key: "recurrence",
    label: "Wiederholung",
    type: "enum",
    value: (t) => (t.recurrence ? "ja" : "nein"),
    options: () => [
      { value: "ja", label: "Wiederkehrend" },
      { value: "nein", label: "Einmalig" },
    ],
    filterable: true,
    column: true,
  },
  {
    // #69: die KI legt oft dutzende Aufgaben an – ein-/ausblenden (Standard: alle)
    key: "created_by",
    label: "Angelegt von",
    type: "enum",
    value: (t) => t.created_by,
    options: () => [
      { value: "user", label: "Ich" },
      { value: "ai", label: "KI" },
    ],
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    // #77: für wen die Aufgabe ist – die Aufgaben-Datenbank zeigt standardmäßig nur „Ich“,
    // Arbeitsschritte der KI stehen dezent im Projekt
    key: "assignee",
    label: "Zuständig",
    type: "enum",
    value: (t) => t.assignee,
    options: () => [
      { value: "user", label: ASSIGNEE_LABELS.user },
      { value: "ai", label: ASSIGNEE_LABELS.ai },
    ],
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    key: "focus_date",
    label: "Fokus-Tag",
    type: "date",
    value: (t) => t.focus_date,
    filterable: true,
    sortable: true,
  },
  {
    key: "updated_at",
    label: "Zuletzt bearbeitet",
    type: "timestamp",
    value: (t) => t.updated_at,
    sortable: true,
    column: true,
  },
  {
    key: "created_at",
    label: "Erstellt",
    type: "timestamp",
    value: (t) => t.created_at,
    sortable: true,
  },
];

export const TASK_BOARD_FIELDS = ["status", "priority"];

/** #77: nur Aufgaben des Nutzers – Vorgabe der Aufgaben-Datenbank (im Projekt nicht). */
export const FOR_ME_FILTER: Filter = { field: "assignee", op: "in", values: ["user"] };

/** #77: bisheriger Stand eines Geräts bleibt, der Filter „Zuständig: Ich“ kommt einmal dazu. */
export function withForMeFilter(old: Record<string, unknown>): Partial<ViewConfig> {
  const filters = Array.isArray(old.filters) ? (old.filters as Filter[]) : TASK_DEFAULTS.filters;
  return {
    filters: [...filters.filter((f) => f?.field !== FOR_ME_FILTER.field), FOR_ME_FILTER],
  };
}

export const TASK_DEFAULTS: ViewConfig = {
  type: "liste",
  filters: [{ field: "status", op: "in", values: ["offen", "in_arbeit", "wartet"] }],
  sort: { field: "updated_at", dir: "desc" },
  // #48: Die Arbeit läuft über das Projekt – nach Projekt gruppiert (Fälligkeit im Menü „Gruppieren“)
  group: "project",
  board: "status",
  columns: ["title", "status", "priority", "due_date", "project", "blocked_by", "updated_at"],
};

/** Projektname für Kontextzeilen */
export { projectTitleOf, recurrenceLabel };
