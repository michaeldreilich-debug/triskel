/**
 * Server-Abfragen für Aufgaben, Abhängigkeiten, Projekte und Meilensteine – reine Funktionen auf
 * einem Supabase-Client (in der App aus dem DataProvider, in Integrationstests als Testnutzer).
 * Gefiltert wird im Client (Bereich, Status, Ansicht); hier nur „nicht im Papierkorb“.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JSONContent } from "@tiptap/core";
import { parseLinks } from "@/features/projects/links";
import { fetchAll } from "@/lib/data/fetch-all";
import type { Database } from "@/lib/supabase/database.types";
import {
  type MilestoneRow,
  type ProjectRow,
  parseOutcome,
  parseProjectStatus,
  parseReflection,
} from "../projects/types";
import {
  type DependencyRow,
  dependencyId,
  parseAssignee,
  parseCreatedBy,
  parsePriority,
  parseTaskStatus,
  type TaskRow,
} from "./types";

type Client = SupabaseClient<Database>;

export const TASK_COLUMNS =
  "id, area_id, project_id, milestone_id, title, body, body_text, status, priority, due_date, scheduled_at, duration_min, recurrence, recurrence_source_id, focus_date, in_inbox, completed_at, sort, created_at, updated_at, deleted_at, edited_at, created_by, assignee";

/** Zeile aus Server oder Warteschlange in eine vollständige, typisierte Aufgabe bringen. */
export function toTask(row: Record<string, unknown> & { id: string }): TaskRow {
  const now = new Date().toISOString();
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  return {
    id: row.id,
    area_id: text("area_id"),
    project_id: text("project_id"),
    milestone_id: text("milestone_id"),
    title: text("title") ?? "",
    body:
      row.body && typeof row.body === "object" && !Array.isArray(row.body)
        ? (row.body as JSONContent)
        : null,
    body_text: text("body_text") ?? "",
    status: parseTaskStatus(text("status")),
    priority: parsePriority(row.priority),
    due_date: text("due_date"),
    scheduled_at: text("scheduled_at"),
    duration_min: typeof row.duration_min === "number" ? row.duration_min : null,
    recurrence: text("recurrence"),
    recurrence_source_id: text("recurrence_source_id"),
    focus_date: text("focus_date"),
    in_inbox: row.in_inbox === true,
    completed_at: text("completed_at"),
    sort: text("sort") ?? "a0",
    created_at: text("created_at") ?? now,
    updated_at: text("updated_at") ?? now,
    deleted_at: text("deleted_at"),
    edited_at: text("edited_at"),
    created_by: parseCreatedBy(row.created_by),
    assignee: parseAssignee(row.assignee),
  };
}

/** Alle Aufgaben (ohne Papierkorb), auch erledigte. */
export async function fetchTasks(client: Client): Promise<TaskRow[]> {
  const rows = await fetchAll<Record<string, unknown> & { id: string }>(async (from, to) => {
    const result = await client
      .from("tasks")
      .select(TASK_COLUMNS)
      .is("deleted_at", null)
      .order("sort")
      .order("id")
      .range(from, to);
    return result as unknown as {
      data: Array<Record<string, unknown> & { id: string }>;
      error: unknown;
    };
  });
  return rows.map(toTask);
}

/** Aktive „Blockiert durch“-Beziehungen; id = „task_id:blocked_by_task_id“ (lokaler Schlüssel). */
export async function fetchDependencies(client: Client): Promise<DependencyRow[]> {
  const rows = await fetchAll<Omit<DependencyRow, "id">>(async (from, to) =>
    client
      .from("task_dependencies")
      .select("task_id, blocked_by_task_id, deleted_at")
      .is("deleted_at", null)
      .order("task_id")
      .order("blocked_by_task_id")
      .range(from, to),
  );
  return rows.map((row) => ({ ...row, id: dependencyId(row.task_id, row.blocked_by_task_id) }));
}

export const PROJECT_COLUMNS =
  "id, area_id, title, status, priority, start_date, target_date, why, outcome, links, body, body_text, next_task_id, last_activity_at, closing_reflection, sort, created_at, updated_at, deleted_at";

export function toProject(row: Record<string, unknown> & { id: string }): ProjectRow {
  const now = new Date().toISOString();
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  return {
    id: row.id,
    area_id: text("area_id") ?? "",
    title: text("title") ?? "",
    status: parseProjectStatus(text("status")),
    priority: parsePriority(row.priority),
    start_date: text("start_date"),
    target_date: text("target_date"),
    why: text("why") ?? "",
    outcome: parseOutcome(row.outcome),
    links: parseLinks(row.links),
    body:
      row.body && typeof row.body === "object" && !Array.isArray(row.body)
        ? (row.body as JSONContent)
        : null,
    body_text: text("body_text") ?? "",
    next_task_id: text("next_task_id"),
    last_activity_at: text("last_activity_at") ?? text("updated_at") ?? now,
    closing_reflection: parseReflection(row.closing_reflection),
    sort: text("sort") ?? "a0",
    created_at: text("created_at") ?? now,
    updated_at: text("updated_at") ?? now,
    deleted_at: text("deleted_at"),
  };
}

export async function fetchProjects(client: Client): Promise<ProjectRow[]> {
  const rows = await fetchAll<Record<string, unknown> & { id: string }>(async (from, to) => {
    const result = await client
      .from("projects")
      .select(PROJECT_COLUMNS)
      .is("deleted_at", null)
      .order("sort")
      .order("id")
      .range(from, to);
    return result as unknown as {
      data: Array<Record<string, unknown> & { id: string }>;
      error: unknown;
    };
  });
  return rows.map(toProject);
}

export async function fetchMilestones(client: Client): Promise<MilestoneRow[]> {
  return fetchAll<MilestoneRow>(async (from, to) =>
    client
      .from("milestones")
      .select("id, project_id, title, due_date, done_at, sort, created_at, updated_at, deleted_at")
      .is("deleted_at", null)
      .order("sort")
      .order("id")
      .range(from, to),
  );
}

/** Notizen, deren Blöcke auf diese Aufgabe zeigen („Block → Aufgabe“). */
export async function fetchTaskSourceNoteIds(client: Client, taskId: string): Promise<string[]> {
  const { data, error } = await client
    .from("note_blocks")
    .select("note_id")
    .eq("task_id", taskId)
    .is("deleted_at", null);
  if (error) throw error;
  return [...new Set(data.map((row) => row.note_id))];
}
