/**
 * Meilenstein folgt seinen Aufgaben (#60) – dieselbe Regel wie der Trigger in Migration 35,
 * damit die Ansicht sofort stimmt. Gespeichert wird nichts davon: `done_at` führt die
 * Datenbank, die App holt nach dem Speichern den Serverstand.
 * Kommt eine offene Aufgabe in einen Meilenstein, ist er wieder offen; geht die letzte offene
 * (erledigt, Papierkorb, hinausverschoben) und bleibt mindestens eine Aufgabe, ist er erreicht.
 * Ohne Aufgaben bleibt er von Hand.
 */
import type { TaskRow } from "../tasks/types";
import type { MilestoneRow } from "./types";

type TaskState = Pick<TaskRow, "milestone_id" | "status" | "deleted_at">;

const openIn = (task: TaskState | undefined): string | null =>
  task?.milestone_id && !task.deleted_at && task.status !== "erledigt" ? task.milestone_id : null;

export interface MilestonePatch {
  id: string;
  done_at: string | null;
}

/**
 * Änderungen an Meilensteinen, wenn eine Aufgabe von `before` zu `after` wechselt.
 * `tasks` ist die Aufgabenliste NACH der Änderung (ohne Papierkorb oder mit `deleted_at`).
 */
export function followMilestones(
  before: TaskState | undefined,
  after: TaskState | undefined,
  tasks: TaskState[],
  milestones: Pick<MilestoneRow, "id" | "done_at" | "deleted_at">[],
  now: string,
): MilestonePatch[] {
  const wasOpen = openIn(before);
  const isOpen = openIn(after);
  if (wasOpen === isOpen) return [];
  const find = (id: string) => milestones.find((m) => m.id === id && !m.deleted_at);
  const patches: MilestonePatch[] = [];
  if (isOpen && find(isOpen)?.done_at) patches.push({ id: isOpen, done_at: null });
  if (wasOpen) {
    const milestone = find(wasOpen);
    const active = tasks.filter((t) => t.milestone_id === wasOpen && !t.deleted_at);
    if (
      milestone &&
      !milestone.done_at &&
      active.length > 0 &&
      active.every((t) => t.status === "erledigt")
    ) {
      patches.push({ id: wasOpen, done_at: now });
    }
  }
  return patches;
}
