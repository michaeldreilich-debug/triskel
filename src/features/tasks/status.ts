/**
 * Erledigen/Wiedereröffnen im Client – gleiche Wirkung wie complete_task und undo_complete_task
 * (Migration 07), damit die Ansicht sofort stimmt und ein Neuladen vor dem Speichern nichts
 * zurückdreht (lokaler Stand hat Vorrang).
 */
import type { IsoDate } from "@/lib/dates";
import { mergeOps, opKey, type SaveOp } from "@/lib/save-queue/save-queue";
import { RPC_TASK_STATUS } from "@/lib/save-queue/supabase-persister";
import { shiftScheduledAt, uncheckBody } from "./recurrence";
import type { TaskRow } from "./types";

/** Folgeinstanz einer wiederkehrenden Aufgabe (wie das insert in complete_task). */
export function nextInstance(
  task: TaskRow,
  nextDue: IsoDate,
  nextId: string,
  now: string,
): TaskRow {
  return {
    ...task,
    id: nextId,
    body: uncheckBody(task.body),
    status: "offen",
    due_date: nextDue,
    scheduled_at: shiftScheduledAt(task.scheduled_at, task.due_date, nextDue),
    recurrence_source_id: task.id,
    focus_date: null,
    // Inbox-Aufgaben wiederholen sich in der Inbox (E24, wie complete_task ab Migration 17)
    in_inbox: task.in_inbox,
    completed_at: null,
    sort: `${task.sort}V`,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/** Erledigen anwenden (idempotent: schon erledigt → nichts). */
export function applyComplete(
  rows: TaskRow[],
  id: string,
  next: { due: IsoDate; id: string } | null,
  now: string,
): TaskRow[] {
  const task = rows.find((t) => t.id === id);
  if (!task || task.status === "erledigt") return rows;
  const result = rows.map((t) =>
    t.id === id ? { ...t, status: "erledigt" as const, completed_at: now, updated_at: now } : t,
  );
  if (next && !rows.some((t) => t.id === next.id)) {
    result.push(nextInstance(task, next.due, next.id, now));
  }
  return result;
}

/** Wiedereröffnen anwenden: offen, nicht erledigte Folgeinstanzen fallen weg. */
export function applyUndo(rows: TaskRow[], id: string, now: string): TaskRow[] {
  return rows
    .filter((t) => !(t.recurrence_source_id === id && t.status !== "erledigt"))
    .map((t) =>
      t.id === id && t.status === "erledigt"
        ? { ...t, status: "offen" as const, completed_at: null, updated_at: now }
        : t,
    );
}

/** Noch nicht gespeicherte Erledigen/Rückgängig-Operationen über Serverdaten legen. */
export function applyPendingStatus(rows: TaskRow[], ops: SaveOp[], now = new Date()): TaskRow[] {
  const merged = new Map<string, SaveOp>();
  for (const op of ops) {
    if (op.table !== RPC_TASK_STATUS) continue;
    const key = opKey(op);
    const previous = merged.get(key);
    merged.set(key, previous ? mergeOps(previous, op) : op);
  }
  let result = rows;
  const stamp = now.toISOString();
  for (const op of merged.values()) {
    const { action, p_next_due, p_next_id } = op.values;
    if (action === "complete") {
      const next =
        typeof p_next_due === "string" && typeof p_next_id === "string"
          ? { due: p_next_due, id: p_next_id }
          : null;
      result = applyComplete(result, op.id, next, stamp);
    } else if (action === "undo") {
      result = applyUndo(result, op.id, stamp);
    }
  }
  return result;
}
