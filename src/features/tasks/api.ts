"use client";

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { notifyWithUndo } from "@/components/ui/toast";
import { useSupabase } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import { berlinDate, formatDayShort, type IsoDate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import { restoreDeleted, softDelete, trashWithUndo } from "@/lib/save-queue/soft-delete";
import { RPC_TASK_STATUS } from "@/lib/save-queue/supabase-persister";
import { keyAfter } from "@/lib/sort-key";
import { followMilestones } from "../projects/milestone-follow";
import type { MilestoneRow, ProjectRow } from "../projects/types";
import { checklistFollow } from "./checklist";
import { wouldCreateCycle } from "./dependencies";
import { fetchDependencies, fetchTasks, toTask } from "./queries";
import { nextDueDate, reanchorRule } from "./recurrence";
import { applyComplete, applyPendingStatus, applyUndo } from "./status";
import {
  type DependencyRow,
  dependencyId,
  TASK_WRITE_KEYS,
  type TaskRow,
  type TaskStatus,
  type TaskWrite,
  taskTitle,
} from "./types";

export const tasksKey = ["tasks"] as const;
export const dependenciesKey = ["task_dependencies"] as const;
export const projectsKey = ["projects"] as const;
export const milestonesKey = ["milestones"] as const;

/* ------------------------------------------------------------------ */
/* Lesen                                                              */
/* ------------------------------------------------------------------ */

/**
 * Alle Aufgaben (ohne Papierkorb) – eine Quelle für Listen, Heute, Projekte und Auswahlen.
 * `select`: nur ein Ausschnitt (z. B. die Inbox-Zahl der Shell) – dann rendert der Aufrufer nur
 * neu, wenn sich der Ausschnitt ändert (O-7).
 */
export function useTasks<T = TaskRow[]>(select?: (rows: TaskRow[]) => T) {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: tasksKey,
    select,
    queryFn: async () => {
      const before = queue.unconfirmedOps();
      const rows = (
        await fetchWithOverlay(queue, "tasks", () => fetchTasks(getSupabase()), {
          include: () => true,
        })
      ).map((row) => toTask(row as unknown as Record<string, unknown> & { id: string }));
      // noch nicht gespeichertes Erledigen/Rückgängig hat Vorrang vor dem Serverstand
      return applyPendingStatus(rows, [...before, ...queue.unconfirmedOps()]);
    },
  });
}

export function useDependencies() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: dependenciesKey,
    queryFn: () =>
      fetchWithOverlay(queue, "task_dependencies", () => fetchDependencies(getSupabase()), {
        include: () => true,
      }),
  });
}

/* ------------------------------------------------------------------ */
/* Schreiben (optimistisch, über die Speicher-Warteschlange bzw. RPC) */
/* ------------------------------------------------------------------ */

const nowIso = () => new Date().toISOString();

function writeValues(task: TaskRow): TaskWrite {
  const values = {} as Record<string, unknown>;
  for (const key of TASK_WRITE_KEYS) values[key] = task[key];
  return values as unknown as TaskWrite;
}

export interface CreateTaskInput extends Partial<TaskWrite> {
  title?: string;
}

export type BlockerResult = "ok" | "cycle" | "exists";

export function createTaskActions(queue: SaveQueue, queryClient: QueryClient) {
  const list = () => queryClient.getQueryData<TaskRow[]>(tasksKey) ?? [];
  const find = (id: string) => list().find((t) => t.id === id);
  const projects = () => queryClient.getQueryData<ProjectRow[]>(projectsKey) ?? [];
  const milestones = () => queryClient.getQueryData<MilestoneRow[]>(milestonesKey) ?? [];
  const deps = () => queryClient.getQueryData<DependencyRow[]>(dependenciesKey) ?? [];

  const setTasks = (update: (old: TaskRow[]) => TaskRow[]) =>
    queryClient.setQueryData<TaskRow[]>(tasksKey, (old) => update(old ?? []));
  const patchCache = (id: string, patch: Partial<TaskRow>) =>
    setTasks((old) => old.map((t) => (t.id === id ? { ...t, ...patch, updated_at: nowIso() } : t)));

  /** `done_at` führt der Trigger (Migration 35): nach dem Speichern den Serverstand holen. */
  const refreshMilestonesWhenSaved = () => {
    const pending = () =>
      queue.unconfirmedOps().some((op) => op.table === "tasks" || op.table === RPC_TASK_STATUS);
    if (!pending()) {
      void queryClient.invalidateQueries({ queryKey: milestonesKey });
      return;
    }
    const unsubscribe = queue.subscribe(() => {
      if (pending()) return;
      unsubscribe();
      void queryClient.invalidateQueries({ queryKey: milestonesKey });
    });
  };

  /**
   * #60: Meilenstein folgt der Aufgabe (wie Migration 35) – sofort in der Ansicht, gespeichert
   * führt es die Datenbank. Gibt den dadurch erreichten Meilenstein zurück.
   */
  const followMilestone = (
    before: TaskRow | undefined,
    after: TaskRow | undefined,
  ): MilestoneRow | null => {
    const patches = followMilestones(before, after, list(), milestones(), nowIso());
    if (patches.length === 0) return null;
    queryClient.setQueryData<MilestoneRow[]>(milestonesKey, (old) =>
      old?.map((m) => {
        const patch = patches.find((p) => p.id === m.id);
        return patch ? { ...m, done_at: patch.done_at, updated_at: nowIso() } : m;
      }),
    );
    refreshMilestonesWhenSaved();
    const reached = patches.find((p) => p.done_at);
    return reached ? (milestones().find((m) => m.id === reached.id) ?? null) : null;
  };

  /** Abgeleitete Werte wie die DB-Trigger: Projekt aus Meilenstein, Bereich aus Projekt. */
  const derive = (task: TaskRow | undefined, patch: Partial<TaskWrite>): Partial<TaskWrite> => {
    const next = { ...patch };
    if (next.milestone_id) {
      const milestone = milestones().find((m) => m.id === next.milestone_id);
      if (milestone) next.project_id = milestone.project_id;
    }
    if (next.project_id !== undefined && next.project_id !== task?.project_id) {
      // anderes Projekt → Meilenstein des alten Projekts entfällt
      const milestone = milestones().find(
        (m) => m.id === (next.milestone_id ?? task?.milestone_id),
      );
      if (milestone && milestone.project_id !== next.project_id) next.milestone_id = null;
    }
    const projectId = next.project_id !== undefined ? next.project_id : task?.project_id;
    if (projectId) {
      const project = projects().find((p) => p.id === projectId);
      if (project) next.area_id = project.area_id;
    }
    // Zugeordnet (Bereich oder Projekt) → nicht mehr in der Inbox (E13)
    if (task?.in_inbox && next.in_inbox === undefined && (next.area_id || next.project_id)) {
      next.in_inbox = false;
    }
    // Fälligkeit geändert → Wiederholung mitziehen (Wochentag/Monatstag)
    if (next.due_date !== undefined && next.recurrence === undefined && task?.recurrence) {
      const rule = reanchorRule(task.recurrence, next.due_date);
      if (rule !== task.recurrence) next.recurrence = rule;
    }
    // Wiederholung ohne Fälligkeit → ab heute
    if (next.recurrence && !(next.due_date ?? task?.due_date)) next.due_date = berlinDate();
    return next;
  };

  const update = (id: string, values: Partial<TaskWrite>) => {
    const task = find(id);
    const { status, ...rest } = values;
    // Erledigen/Wiedereröffnen läuft immer über complete_task bzw. undo (Risiko 8)
    if (status !== undefined && task && status !== task.status) setStatus(id, status);
    const patch = derive(task, rest);
    if (Object.keys(patch).length === 0) return;
    // #38: Titel/Notiz/Checkliste gleich als „zuletzt bearbeitet“ zeigen (gespeichert führt es der Trigger)
    const edited = "title" in patch || "body" in patch ? { edited_at: nowIso() } : {};
    patchCache(id, { ...patch, ...edited });
    queue.enqueue({ table: "tasks", id, mode: "update", values: patch });
    if ("milestone_id" in patch) followMilestone(task, find(id));
    if (task && status === undefined && "body" in patch) followChecklist(task, patch.body);
  };

  /** #86: Aufgabe folgt ihrer Checkliste (Regel `checklistFollow`), mit Meldung und Rückgängig. */
  const followChecklist = (task: TaskRow, body: TaskRow["body"] | undefined) => {
    const target = checklistFollow(task.body, body, task.status);
    if (target === "erledigt") complete(task.id, { reason: "alle Punkte abgehakt" });
    else if (target === "offen") {
      reopen(task.id);
      notifyWithUndo(`„${taskTitle(task)}“ wieder offen · ein Punkt ist offen`, () =>
        complete(task.id, { notify: false }),
      );
    }
  };

  /**
   * Zentrales Erledigen (Risiko 8): sofort in der Ansicht, gespeichert über die Warteschlange als
   * complete_task-Aufruf (atomar, bei Wiederholung mit Folgeinstanz, E12). Die Folgeinstanz-ID
   * erzeugt der Client (E4), damit Ansicht und Datenbank dieselbe Zeile meinen.
   */
  const complete = (id: string, options: { notify?: boolean; reason?: string } = {}) => {
    const task = find(id);
    if (!task || task.status === "erledigt") return;
    // Folgeinstanz übernimmt Bereich bzw. Inbox (E24, complete_task ab Migration 17)
    const nextDue = task.recurrence
      ? nextDueDate(task.recurrence, task.due_date, berlinDate())
      : null;
    const next = nextDue ? { due: nextDue, id: newId() } : null;
    void queryClient.cancelQueries({ queryKey: tasksKey });
    setTasks((old) => applyComplete(old, id, next, nowIso()));
    queue.enqueue({
      table: RPC_TASK_STATUS,
      id,
      mode: "update",
      values: { action: "complete", p_next_due: next?.due ?? null, p_next_id: next?.id ?? null },
    });
    const reached = followMilestone(task, find(id));
    if (options.notify !== false) {
      const parts = [`„${taskTitle(task)}“ erledigt`];
      if (options.reason) parts.push(options.reason);
      if (next) parts.push(`nächste am ${formatDayShort(next.due)}`);
      if (reached) parts.push(`Meilenstein „${reached.title || "Ohne Titel"}“ erreicht`);
      notifyWithUndo(parts.join(" · "), () => reopen(id));
    }
  };

  /** Wieder öffnen (undo_complete_task): entstandene Folgeinstanz kommt in den Papierkorb. */
  const reopen = (id: string, status: TaskStatus = "offen") => {
    const task = find(id);
    if (task?.status !== "erledigt") return;
    void queryClient.cancelQueries({ queryKey: tasksKey });
    setTasks((old) => applyUndo(old, id, nowIso()));
    queue.enqueue({
      table: RPC_TASK_STATUS,
      id,
      mode: "update",
      values: { action: "undo", p_next_due: null, p_next_id: null },
    });
    followMilestone(task, find(id));
    if (status !== "offen") {
      patchCache(id, { status });
      queue.enqueue({ table: "tasks", id, mode: "update", values: { status } });
    }
  };

  const setStatus = (id: string, status: TaskStatus) => {
    const task = find(id);
    if (!task || task.status === status) return;
    if (status === "erledigt") return complete(id);
    if (task.status === "erledigt") return reopen(id, status);
    patchCache(id, { status });
    queue.enqueue({ table: "tasks", id, mode: "update", values: { status } });
  };

  const upsertDependency = (row: DependencyRow) => {
    queryClient.setQueryData<DependencyRow[]>(dependenciesKey, (old) => [
      ...(old ?? []).filter((d) => d.id !== row.id),
      ...(row.deleted_at ? [] : [row]),
    ]);
    queue.enqueue({
      table: "task_dependencies",
      id: row.id,
      mode: "upsert",
      values: {
        task_id: row.task_id,
        blocked_by_task_id: row.blocked_by_task_id,
        deleted_at: row.deleted_at,
      },
    });
  };

  return {
    create(input: CreateTaskInput = {}): TaskRow {
      const derived = derive(undefined, input);
      const task = toTask({
        title: "",
        status: "offen",
        in_inbox: false,
        ...(input as Record<string, unknown>),
        ...(derived as Record<string, unknown>),
        id: newId(),
        sort: input.sort ?? keyAfter(list().map((t) => t.sort)),
        deleted_at: null,
      });
      setTasks((old) => [...old, task]);
      queue.enqueue({
        table: "tasks",
        id: task.id,
        mode: "upsert",
        values: { ...writeValues(task) },
      });
      followMilestone(undefined, task);
      return task;
    },

    update,
    setStatus,
    complete,
    reopen,

    /** Erledigt ↔ offen (Checkbox) */
    toggle(id: string) {
      const task = find(id);
      if (!task) return;
      if (task.status === "erledigt") reopen(id);
      else complete(id);
    },

    setFocus(id: string, date: IsoDate | null) {
      update(id, { focus_date: date });
    },

    /** In den Papierkorb (Soft-Delete) mit „Rückgängig“ (E8) */
    trash(id: string, onTrashed?: () => void) {
      const task = find(id);
      if (!task) return;
      const trashed = { ...task, deleted_at: nowIso() };
      trashWithUndo(queue, queryClient, {
        table: "tasks",
        queryKey: tasksKey,
        row: task,
        message: `„${taskTitle(task)}“ liegt im Papierkorb`,
        onTrashed,
        notify: (message, undo) =>
          notifyWithUndo(message, () => {
            undo();
            followMilestone(trashed, task);
          }),
      });
      followMilestone(task, trashed);
    },

    /**
     * In den Papierkorb ohne eigene Meldung (Umwandeln in eine Notiz, #65): gibt die Umkehrung
     * zurück, die der Aufrufer in seine Meldung mit „Rückgängig“ einbaut. null = nicht gefunden.
     */
    trashQuietly(id: string): (() => void) | null {
      const task = find(id);
      if (!task) return null;
      const trashed = { ...task, deleted_at: nowIso() };
      softDelete(queue, "tasks", id);
      setTasks((old) => old.filter((t) => t.id !== id));
      followMilestone(task, trashed);
      return () => {
        restoreDeleted(queue, "tasks", id);
        setTasks((old) => (old.some((t) => t.id === id) ? old : [...old, task]));
        followMilestone(trashed, task);
      };
    },

    /** „Blockiert durch“ hinzufügen; ein Kreis wird abgelehnt (wie der DB-Trigger). */
    addBlocker(taskId: string, blockerId: string): BlockerResult {
      const all = deps();
      if (wouldCreateCycle(all, taskId, blockerId)) return "cycle";
      const id = dependencyId(taskId, blockerId);
      if (all.some((d) => d.id === id && !d.deleted_at)) return "exists";
      upsertDependency({ id, task_id: taskId, blocked_by_task_id: blockerId, deleted_at: null });
      patchCache(taskId, {});
      return "ok";
    },

    removeBlocker(taskId: string, blockerId: string) {
      upsertDependency({
        id: dependencyId(taskId, blockerId),
        task_id: taskId,
        blocked_by_task_id: blockerId,
        deleted_at: nowIso(),
      });
      patchCache(taskId, {});
    },
  };
}

export type TaskActions = ReturnType<typeof createTaskActions>;

export function useTaskActions(): TaskActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(() => createTaskActions(queue, queryClient), [queue, queryClient]);
}
