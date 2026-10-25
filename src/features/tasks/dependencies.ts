/**
 * „Blockiert durch“ im Client – gleiche Regeln wie in der Datenbank:
 * - Zyklus-/Selbstverweis-Sperre wie der Trigger task_dependencies_check_cycle (Migration 04)
 * - blockiert wie v_tasks.is_blocked (Migration 07): mindestens eine aktive Abhängigkeit auf
 *   eine nicht gelöschte, nicht erledigte Aufgabe
 * Der Client prüft vorab (sofortige Rückmeldung), die Datenbank bleibt die Sicherung.
 */
import type { DependencyRow, TaskRow } from "./types";

const active = (deps: DependencyRow[]) => deps.filter((d) => !d.deleted_at);

/** Würde „taskId ist blockiert durch blockerId“ einen Kreis bilden (oder auf sich selbst zeigen)? */
export function wouldCreateCycle(
  deps: DependencyRow[],
  taskId: string,
  blockerId: string,
): boolean {
  if (taskId === blockerId) return true;
  // Wovon ist blockerId (direkt oder indirekt) blockiert? Steht taskId darunter → Kreis.
  const blockedBy = new Map<string, string[]>();
  for (const d of active(deps)) {
    const list = blockedBy.get(d.task_id) ?? [];
    list.push(d.blocked_by_task_id);
    blockedBy.set(d.task_id, list);
  }
  const seen = new Set<string>();
  const stack = [blockerId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const next of blockedBy.get(current) ?? []) {
      if (next === taskId) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/** IDs der Aufgaben, die noch auf eine offene Aufgabe warten. */
export function blockedTaskIds(tasks: TaskRow[], deps: DependencyRow[]): Set<string> {
  const open = new Set(
    tasks.filter((t) => !t.deleted_at && t.status !== "erledigt").map((t) => t.id),
  );
  const result = new Set<string>();
  for (const d of active(deps)) {
    if (open.has(d.blocked_by_task_id)) result.add(d.task_id);
  }
  return result;
}

/** Aufgaben, die taskId blockieren (aktive Abhängigkeiten, ohne Papierkorb). */
export function blockersOf(taskId: string, tasks: TaskRow[], deps: DependencyRow[]): TaskRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return active(deps)
    .filter((d) => d.task_id === taskId)
    .map((d) => byId.get(d.blocked_by_task_id))
    .filter((t): t is TaskRow => Boolean(t && !t.deleted_at));
}

/** Aufgaben, die auf taskId warten. */
export function dependentsOf(taskId: string, tasks: TaskRow[], deps: DependencyRow[]): TaskRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return active(deps)
    .filter((d) => d.blocked_by_task_id === taskId)
    .map((d) => byId.get(d.task_id))
    .filter((t): t is TaskRow => Boolean(t && !t.deleted_at));
}
