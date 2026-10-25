import type { JSONContent } from "@tiptap/core";
import type { IsoDate } from "@/lib/dates";

/** Status (Check in Migration 04) mit Anzeigenamen. */
export const TASK_STATUSES = ["offen", "in_arbeit", "wartet", "erledigt"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  offen: "Offen",
  in_arbeit: "In Arbeit",
  wartet: "Wartet",
  erledigt: "Erledigt",
};

export const parseTaskStatus = (value: string | null | undefined): TaskStatus =>
  (TASK_STATUSES as readonly string[]).includes(value ?? "") ? (value as TaskStatus) : "offen";

export type Priority = 1 | 2 | 3;
export const PRIORITIES: Priority[] = [1, 2, 3];
export const PRIORITY_LABELS: Record<Priority, string> = { 1: "Hoch", 2: "Mittel", 3: "Niedrig" };

export const parsePriority = (value: unknown): Priority | null =>
  value === 1 || value === 2 || value === 3 ? value : null;

export interface TaskRow {
  id: string;
  /** null nur in der Inbox */
  area_id: string | null;
  project_id: string | null;
  milestone_id: string | null;
  title: string;
  /** Notiz/Checkliste als TipTap-JSON */
  body: JSONContent | null;
  body_text: string;
  status: TaskStatus;
  priority: Priority | null;
  due_date: IsoDate | null;
  /** geplant für (Datum + Uhrzeit) */
  scheduled_at: string | null;
  duration_min: number | null;
  /** RRULE ohne DTSTART, z. B. FREQ=WEEKLY;BYDAY=SU */
  recurrence: string | null;
  recurrence_source_id: string | null;
  /** Fokus-Tag (Abendplanung) */
  focus_date: IsoDate | null;
  in_inbox: boolean;
  completed_at: string | null;
  sort: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /**
   * Zuletzt inhaltlich bearbeitet (#38): Titel, Notiz oder Checkliste – nicht Abhaken, Datum,
   * Status, Anlegen. Führt der Trigger (Migration 23); die App zeigt es nur vorab an.
   */
  edited_at: string | null;
  /**
   * Angelegt von (#69, Migration 40): "ai" setzt der Trigger bei Anfragen eines KI-Zugangs, die
   * App schreibt die Spalte nie und kann sie nicht ändern.
   */
  created_by: TaskCreatedBy;
  /**
   * Zuständig (#77, Migration 42): "ai" = Arbeitsschritt der KI – überall ausgeblendet außer
   * dezent im Projekt; "user" = Aufgabe des Nutzers, egal wer sie angelegt hat. App und KI setzen
   * den Wert, Folgeaufgaben erben ihn (Trigger).
   */
  assignee: TaskAssignee;
}

export type TaskCreatedBy = "user" | "ai";

export const parseCreatedBy = (value: unknown): TaskCreatedBy => (value === "ai" ? "ai" : "user");

export type TaskAssignee = "user" | "ai";

export const parseAssignee = (value: unknown): TaskAssignee => (value === "ai" ? "ai" : "user");

export const ASSIGNEE_LABELS: Record<TaskAssignee, string> = { user: "Ich", ai: "KI" };

/** Eigene Aufgabe? Heute, Inbox, Kalender, Wochenreview und „Zuletzt“ zeigen nur diese. */
export const isForMe = (task: Pick<TaskRow, "assignee">) => task.assignee !== "ai";

/** Spalten, die die App schreibt (completed_at, edited_at und created_by setzen Trigger). */
export type TaskWrite = Omit<
  TaskRow,
  "id" | "completed_at" | "created_at" | "updated_at" | "edited_at" | "created_by"
>;

export const TASK_WRITE_KEYS = [
  "area_id",
  "project_id",
  "milestone_id",
  "title",
  "body",
  "body_text",
  "status",
  "priority",
  "due_date",
  "scheduled_at",
  "duration_min",
  "recurrence",
  "recurrence_source_id",
  "focus_date",
  "in_inbox",
  "sort",
  "deleted_at",
  "assignee",
] as const satisfies ReadonlyArray<keyof TaskWrite>;

/** „Blockiert durch“: task_id wartet auf blocked_by_task_id. id = „task_id:blocked_by_task_id“. */
export interface DependencyRow {
  id: string;
  task_id: string;
  blocked_by_task_id: string;
  deleted_at: string | null;
}

export const dependencyId = (taskId: string, blockedById: string) => `${taskId}:${blockedById}`;

export const taskTitle = (task: Pick<TaskRow, "title"> | undefined) =>
  task?.title.trim() ? task.title : "Ohne Titel";

export const isDone = (task: Pick<TaskRow, "status">) => task.status === "erledigt";
