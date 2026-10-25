import type { JSONContent } from "@tiptap/core";
import type { TaskStatus } from "./types";

export interface ChecklistProgress {
  done: number;
  total: number;
}

/**
 * Checklisten-Punkte in der Notiz einer Aufgabe zählen (#42), auch eingerückte. Ohne Punkte
 * null – dann zeigt die Ansicht weder Balken noch „2/5“.
 */
export function checklistProgress(body: JSONContent | null | undefined): ChecklistProgress | null {
  let done = 0;
  let total = 0;
  const walk = (node: JSONContent) => {
    if (node.type === "taskItem") {
      total += 1;
      if (node.attrs?.checked === true) done += 1;
    }
    for (const child of node.content ?? []) walk(child);
  };
  if (body) walk(body);
  return total > 0 ? { done, total } : null;
}

/**
 * #86: Die Aufgabe folgt ihrer Checkliste wie der Meilenstein seinen Aufgaben (#60) –
 * ereignisgesteuert, damit Abhaken und Wieder-Öffnen von Hand möglich bleiben:
 * - Der letzte offene Punkt wird abgehakt → „erledigt“.
 * - Eine erledigte Aufgabe, deren Punkte alle abgehakt waren, hat wieder einen offenen Punkt
 *   (Haken entfernt oder neuer Punkt) → „offen“.
 *
 * Sonst null. Ohne Punkte zählt eine Checkliste als nicht abgehakt: Punkte anlegen und abhaken
 * kommt oft in einem Speichern an (400 ms, Editor), auch das erledigt die Aufgabe. Alle Punkte
 * löschen ändert nichts.
 */
export function checklistFollow(
  before: JSONContent | null | undefined,
  after: JSONContent | null | undefined,
  status: TaskStatus,
): "erledigt" | "offen" | null {
  const was = checklistProgress(before);
  const now = checklistProgress(after);
  if (!now) return null;
  const wasDone = was !== null && was.done === was.total;
  const isDone = now.done === now.total;
  if (status !== "erledigt" && !wasDone && isDone) return "erledigt";
  if (status === "erledigt" && wasDone && !isDone) return "offen";
  return null;
}
