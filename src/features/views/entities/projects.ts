import type { AreaSummary } from "@/features/areas/defaults";
import { isStale, lastActivity, projectProgress, stuckReasons } from "@/features/projects/rules";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type ProjectRow,
  projectTitle,
} from "@/features/projects/types";
import { PRIORITIES, PRIORITY_LABELS, type TaskRow, taskTitle } from "@/features/tasks/types";
import type { FieldDef, ViewConfig } from "../engine";

export interface ProjectViewCtx {
  tasks: TaskRow[];
  areas: AreaSummary[];
  /** Zeitpunkt für „14 Tage still“ */
  now: number;
}

const hint = (p: ProjectRow, ctx: ProjectViewCtx) =>
  isStale(p, ctx.tasks, ctx.now)
    ? "still"
    : stuckReasons(p, ctx.tasks).length > 0
      ? "festgefahren"
      : "ok";

export const PROJECT_FIELDS: FieldDef<ProjectRow, ProjectViewCtx>[] = [
  {
    key: "title",
    label: "Titel",
    type: "text",
    value: (p) => projectTitle(p),
    sortable: true,
    column: true,
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    value: (p) => p.status,
    options: () => PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] })),
    filterable: true,
    sortable: true,
    groupable: true,
    // #74: aktive Projekte oben; das Board behält den Ablauf Idee → … → Archiv
    groupOrder: ["aktiv", "geplant", "pausiert", "idee", "abgeschlossen", "archiv"],
    column: true,
  },
  {
    key: "area",
    label: "Bereich",
    type: "enum",
    value: (p) => p.area_id,
    options: (ctx) => ctx.areas.map((a) => ({ value: a.id, label: a.name })),
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    key: "priority",
    label: "Priorität",
    type: "enum",
    value: (p) => (p.priority ? String(p.priority) : ""),
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
    key: "progress",
    label: "Fortschritt",
    type: "number",
    value: (p, ctx) => {
      const ratio = projectProgress(p.id, ctx.tasks).ratio;
      return ratio === null ? null : Math.round(ratio * 100);
    },
    sortable: true,
    column: true,
  },
  {
    key: "next_step",
    label: "Nächster Schritt",
    type: "text",
    value: (p, ctx) => {
      const next = ctx.tasks.find((t) => t.id === p.next_task_id && t.status !== "erledigt");
      return next ? taskTitle(next) : null;
    },
    column: true,
  },
  {
    key: "hint",
    label: "Hinweis",
    type: "enum",
    value: hint,
    options: () => [
      { value: "festgefahren", label: "Festgefahren" },
      { value: "still", label: "14 Tage still" },
      { value: "ok", label: "Läuft" },
    ],
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    key: "target_date",
    label: "Ziel",
    type: "date",
    value: (p) => p.target_date,
    filterable: true,
    sortable: true,
    column: true,
  },
  {
    key: "start_date",
    label: "Start",
    type: "date",
    value: (p) => p.start_date,
    sortable: true,
  },
  {
    key: "activity",
    label: "Zuletzt bewegt",
    type: "timestamp",
    value: (p, ctx) => new Date(lastActivity(p, ctx.tasks)).toISOString(),
    sortable: true,
    column: true,
  },
];

export const PROJECT_BOARD_FIELDS = ["status", "priority", "area"];

export const PROJECT_DEFAULTS: ViewConfig = {
  type: "liste",
  filters: [
    {
      field: "status",
      op: "in",
      values: ["idee", "geplant", "aktiv", "pausiert", "abgeschlossen"],
    },
  ],
  sort: { field: "activity", dir: "desc" },
  // Muster 5 (#23): Status als Gruppe statt Pille in jeder Zeile
  group: "status",
  board: "status",
  columns: ["title", "status", "area", "progress", "next_step", "hint", "target_date"],
};
