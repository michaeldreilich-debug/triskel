/**
 * Geführtes Wochenreview (S1c) als reine Funktionen: welche Woche, welche Schritte, welche
 * Projekte in welcher Reihenfolge, Vorschläge für den Fokus und der Hinweis auf Heute.
 * Der Stand (Schritt, durchgesehene Projekte, fertig) liegt am Wochenrückblick (recaps.review).
 */
import { isStale, stuckReasons } from "@/features/projects/rules";
import type { ProjectRow } from "@/features/projects/types";
import type { TaskRow } from "@/features/tasks/types";
import {
  addDays,
  endOfMonth,
  formatMonth,
  type IsoDate,
  isoWeekday,
  isoWeekRange,
} from "@/lib/dates";
import { findRecap, REVIEW_STEP_COUNT, weekLabel } from "./model";
import type { RecapRow, ReviewState } from "./types";

export const REVIEW_STEPS = [
  { key: "inbox", title: "Inbox leeren", sub: "Jeden Eintrag zuordnen, erledigen oder wegwerfen" },
  {
    key: "projekte",
    title: "Projekte durchgehen",
    sub: "Festgefahrene und stille zuerst – hat jedes einen nächsten Schritt?",
  },
  {
    key: "faellig",
    title: "Fälliges der nächsten Woche",
    sub: "Termine, Aufgaben und Fristen – wo wird es eng?",
  },
  { key: "rueckblick", title: "Wochenrückblick schreiben", sub: "Wie war die Woche?" },
  { key: "fokus", title: "Fokus nächste Woche", sub: "Drei Punkte, die zählen" },
] as const;

export type ReviewStepKey = (typeof REVIEW_STEPS)[number]["key"];

if (REVIEW_STEPS.length !== REVIEW_STEP_COUNT) throw new Error("REVIEW_STEP_COUNT passt nicht");

export const EMPTY_REVIEW: ReviewState = {
  step: 0,
  projects: [],
  started_at: null,
  finished_at: null,
};

/**
 * Woche, um die es geht: sonst die laufende, am Montag noch die vergangene (das Review gehört
 * zum Sonntag davor). `?woche=` in der Adresse wählt eine andere.
 */
export function reviewWeek(
  today: IsoDate,
  requested?: string | null,
): { start: IsoDate; end: IsoDate } {
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(requested))) {
    return isoWeekRange(requested);
  }
  return isoWeekRange(isoWeekday(today) === 0 ? addDays(today, -7) : today);
}

/** Die Woche nach der Review-Woche (Schritt „Fälliges“). */
export const nextWeek = (week: { start: IsoDate }) => isoWeekRange(addDays(week.start, 7));

export interface ReviewProject {
  project: ProjectRow;
  /** Gründe für „festgefahren“ */
  stuck: ReturnType<typeof stuckReasons>;
  stale: boolean;
  next: TaskRow | null;
}

/**
 * Aktive Projekte fürs Review: festgefahrene und 14 Tage stille zuerst (sie stehen auf der
 * Review-Liste, Fokus-Regel 2 und 4), dann nach Titel.
 */
export function reviewProjects(
  projects: ProjectRow[],
  tasks: TaskRow[],
  now: number,
): ReviewProject[] {
  const rank = (p: ReviewProject) => (p.stuck.length ? 0 : p.stale ? 1 : 2);
  return projects
    .filter((p) => !p.deleted_at && p.status === "aktiv")
    .map((project) => {
      const next = tasks.find(
        (t) => t.id === project.next_task_id && !t.deleted_at && t.status !== "erledigt",
      );
      return {
        project,
        stuck: stuckReasons(project, tasks),
        stale: isStale(project, tasks, now),
        next: next ?? null,
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.project.title.localeCompare(b.project.title, "de"));
}

export interface FocusSuggestion {
  id: string;
  title: string;
  /** warum vorgeschlagen: „nächster Schritt · Werkstatt“, „fällig Mi, 21.10.“ */
  reason: string;
}

/**
 * Vorschläge für den Fokus der nächsten Woche: nächste Schritte aktiver Projekte und wichtige
 * oder fällige Aufgaben der nächsten Woche – je Titel einmal, höchstens `limit`.
 */
export function focusSuggestions(input: {
  projects: ReviewProject[];
  tasks: TaskRow[];
  week: { start: IsoDate; end: IsoDate };
  taken: string[];
  formatDay: (date: IsoDate) => string;
  limit?: number;
}): FocusSuggestion[] {
  const limit = input.limit ?? 6;
  const seen = new Set(input.taken.map((t) => t.trim().toLocaleLowerCase("de")).filter(Boolean));
  const result: FocusSuggestion[] = [];
  const add = (id: string, title: string, reason: string) => {
    const key = title.trim().toLocaleLowerCase("de");
    if (!key || seen.has(key) || result.length >= limit) return;
    seen.add(key);
    result.push({ id, title: title.trim(), reason });
  };
  const due = input.tasks
    .filter((t) => !t.deleted_at && t.status !== "erledigt" && !t.in_inbox)
    .filter((t) => t.due_date && t.due_date >= input.week.start && t.due_date <= input.week.end)
    .sort(
      (a, b) =>
        (a.priority ?? 9) - (b.priority ?? 9) || (a.due_date ?? "").localeCompare(b.due_date ?? ""),
    );
  // wichtige Fälligkeiten zuerst, dann die nächsten Schritte, dann die übrigen Fälligkeiten
  for (const t of due.filter((t) => t.priority === 1))
    add(t.id, t.title, `hoch · fällig ${input.formatDay(t.due_date as IsoDate)}`);
  for (const p of input.projects)
    if (p.next)
      add(p.next.id, p.next.title, `nächster Schritt · ${p.project.title.trim() || "Projekt"}`);
  for (const t of due) add(t.id, t.title, `fällig ${input.formatDay(t.due_date as IsoDate)}`);
  return result;
}

export interface TodayHint {
  kind: "woche" | "monat";
  text: string;
  action: string;
  href: string;
}

/**
 * Hinweise auf Heute: sonntags das Wochenreview (bis es fertig ist), montags nur ein
 * angefangenes; am Monatsletzten und in den ersten drei Tagen danach der Monatsrückblick, solange
 * er nicht abgeschlossen ist.
 */
export function todayHints(
  recaps: RecapRow[],
  today: IsoDate,
  paths: { review: string; month: (start: IsoDate) => string },
): TodayHint[] {
  const hints: TodayHint[] = [];
  const weekday = isoWeekday(today);
  if (weekday === 6 || weekday === 0) {
    const week = reviewWeek(today);
    const recap = findRecap(recaps, "woche", week.start);
    const review = recap?.review;
    const started = !!review?.started_at;
    if (!review?.finished_at && (weekday === 6 || started)) {
      hints.push({
        kind: "woche",
        text: started
          ? `Wochenreview ${weekLabel(week.start)} · Schritt ${(review?.step ?? 0) + 1} von ${REVIEW_STEP_COUNT}`
          : `Sonntag: Zeit fürs Wochenreview (${weekLabel(week.start)})`,
        action: started ? "Weitermachen" : "Starten",
        href: paths.review,
      });
    }
  }
  const day = Number(today.slice(8, 10));
  const monthStart =
    today === endOfMonth(today)
      ? `${today.slice(0, 7)}-01`
      : day <= 3
        ? `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`
        : null;
  if (monthStart) {
    const recap = findRecap(recaps, "monat", monthStart);
    if (!recap?.closed_at) {
      hints.push({
        kind: "monat",
        text: `${today === endOfMonth(today) ? "Monatsende" : "Monat vorbei"}: Monatsrückblick ${formatMonth(monthStart)}`,
        action: recap ? "Weiterschreiben" : "Schreiben",
        href: paths.month(monthStart),
      });
    }
  }
  return hints;
}
