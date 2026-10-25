/**
 * Heute (B9) als reine Funktionen: Was gehört heute auf die Startseite?
 * - Fokus = Aufgaben mit Fokus-Tag heute (gewählt in der Abendplanung am Vorabend)
 * - Fällig & überfällig = offen, fällig bis heute, nicht schon im Fokus
 * - Tagesablauf = „geplant für“ heute (Europe/Berlin), nach Uhrzeit
 * - Blockierte Aufgaben erscheinen nirgends (Fokus-Regel 3), nur ihre Anzahl als Hinweis
 * - Abendplanung ab (Abendzeit − 1 h) hervorgehoben, Standard 20:00 → ab 19:00
 */
import { isStale, projectProgress, stuckReasons } from "@/features/projects/rules";
import type { ProjectRow } from "@/features/projects/types";
import type { TaskRow } from "@/features/tasks/types";
import {
  addDays,
  berlinDate,
  berlinMinutes,
  berlinTime,
  type IsoDate,
  timeToMinutes,
} from "@/lib/dates";

export const FOCUS_LIMIT = 3;
export const DEFAULT_EVENING = "20:00";
/** so viele Minuten vor der Abendzeit wird die Planung hervorgehoben */
export const EVENING_LEAD_MIN = 60;

export interface TodayInput {
  tasks: TaskRow[];
  blocked: Set<string>;
  projects: ProjectRow[];
  /** gewählter Bereich (null = alle) */
  area: string | null;
  now: Date;
  eveningTime?: string | null;
}

const byPriority = (a: TaskRow, b: TaskRow) => (a.priority ?? 9) - (b.priority ?? 9);
const bySort = (a: TaskRow, b: TaskRow) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);

export function isEvening(now: Date, eveningTime?: string | null): boolean {
  const evening =
    timeToMinutes(eveningTime ?? DEFAULT_EVENING) ?? timeToMinutes(DEFAULT_EVENING) ?? 1200;
  return berlinMinutes(now) >= evening - EVENING_LEAD_MIN;
}

export function todayData(input: TodayInput) {
  const today = berlinDate(input.now);
  const tomorrow = addDays(today, 1);
  const live = input.tasks.filter((t) => !t.deleted_at);
  const inArea = (t: TaskRow) => !input.area || t.area_id === input.area;
  const isBlocked = (t: TaskRow) => t.status !== "erledigt" && input.blocked.has(t.id);
  const hidden = new Set<string>();
  const show = (t: TaskRow) => {
    if (!inArea(t)) return false;
    if (isBlocked(t)) {
      hidden.add(t.id);
      return false;
    }
    return true;
  };

  const focus = live
    .filter((t) => t.focus_date === today)
    .filter(show)
    .sort((a, b) => byPriority(a, b) || bySort(a, b));
  const focusIds = new Set(focus.map((t) => t.id));

  const due = live
    .filter(
      (t) =>
        t.status !== "erledigt" &&
        t.due_date !== null &&
        t.due_date <= today &&
        !focusIds.has(t.id),
    )
    .filter(show)
    .sort((a, b) => (a.due_date as string).localeCompare(b.due_date as string) || byPriority(a, b));

  const schedule = live
    .filter((t) => t.scheduled_at !== null && berlinDate(t.scheduled_at) === today)
    .filter(show)
    .sort((a, b) => Date.parse(a.scheduled_at as string) - Date.parse(b.scheduled_at as string))
    .map((t) => ({ task: t, time: berlinTime(t.scheduled_at as string) }));

  const inbox = live
    .filter((t) => t.in_inbox && t.status !== "erledigt")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  // Abendplanung: Fokus für morgen
  const planned = live
    .filter((t) => t.focus_date === tomorrow && inArea(t))
    .sort((a, b) => byPriority(a, b) || bySort(a, b));
  const plannedIds = new Set(planned.map((t) => t.id));
  const candidates = live.filter(
    (t) =>
      t.status !== "erledigt" && !isBlocked(t) && !plannedIds.has(t.id) && inArea(t) && !t.in_inbox,
  );
  // Vorschläge: überfällig/fällig bis morgen, dann hohe Priorität, dann heutiger Fokus (offen)
  const suggestions = candidates
    .filter(
      (t) =>
        (t.due_date !== null && t.due_date <= tomorrow) ||
        t.priority === 1 ||
        t.focus_date === today,
    )
    .sort(
      (a, b) =>
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        byPriority(a, b) ||
        bySort(a, b),
    )
    .slice(0, 4);

  const projects = input.projects
    .filter(
      (p) => p.status === "aktiv" && !p.deleted_at && (!input.area || p.area_id === input.area),
    )
    .map((project) => ({
      project,
      progress: projectProgress(project.id, input.tasks),
      stale: isStale(project, input.tasks, input.now.getTime()),
      stuck: stuckReasons(project, input.tasks).length > 0,
      next:
        input.tasks.find((t) => t.id === project.next_task_id && t.status !== "erledigt") ?? null,
    }))
    .sort((a, b) => Number(b.stale) - Number(a.stale) || Number(b.stuck) - Number(a.stuck));

  return {
    today,
    tomorrow,
    focus,
    focusDone: focus.filter((t) => t.status === "erledigt").length,
    due,
    schedule,
    inbox,
    hiddenBlocked: hidden.size,
    planned,
    candidates,
    suggestions,
    projects,
    evening: isEvening(input.now, input.eveningTime),
    eveningTime: (input.eveningTime ?? DEFAULT_EVENING).slice(0, 5),
  };
}

export type TodayData = ReturnType<typeof todayData>;
export type { IsoDate };

/** Warum steht eine Aufgabe in den Vorschlägen der Abendplanung? (Muster 7, #23) */
export function suggestionReason(
  task: TaskRow,
  today: IsoDate,
  tomorrow: IsoDate,
): { label: string; urgent: boolean } {
  const parts: string[] = [];
  if (task.priority === 1) parts.push("hoch");
  const overdue = task.due_date !== null && task.due_date < today;
  if (overdue) parts.push("überfällig");
  else if (task.due_date === today) parts.push("heute fällig");
  else if (task.due_date === tomorrow) parts.push("morgen fällig");
  else if (task.focus_date === today) parts.push("heute im Fokus");
  return { label: parts.join(" · "), urgent: overdue };
}

/** Zusammenfassung unter dem Titel (Muster 1, #23): was heute zählt, in einer Zeile. */
/** Eintrag mit Uhrzeit („HH:MM“) für „nächster Termin“ und die Zeitleiste. */
export interface TimedEntryLike {
  time: string;
  done?: boolean;
}

const scheduleEntries = (data: TodayData): TimedEntryLike[] =>
  data.schedule.map(({ task, time }) => ({ time, done: task.status === "erledigt" }));

/**
 * Zusammenfassung unter dem Titel. `appointments` = alles mit Uhrzeit heute (Google-Termine und
 * Zeitblöcke aus dem Kalendermodell, S2c); ohne Angabe nur die geplanten Aufgaben.
 */
export function todaySummary(
  data: TodayData,
  nowTime: string,
  appointments: TimedEntryLike[] = scheduleEntries(data),
) {
  return {
    focus: data.focus.length,
    focusDone: data.focusDone,
    overdue: data.due.filter((t) => (t.due_date ?? "") < data.today).length,
    inbox: data.inbox.length,
    nextAppointment:
      [...appointments]
        .sort((a, b) => a.time.localeCompare(b.time))
        .find((a) => !a.done && a.time > nowTime)?.time ?? null,
  };
}

export type TimelineItem<T extends TimedEntryLike = TimedEntryLike> =
  | { kind: "entry"; time: string; entry: T }
  | { kind: "evening"; time: string }
  | { kind: "now"; time: string };

/**
 * Tagesablauf als Zeitleiste (Muster 6, #23): Einträge mit Uhrzeit (Termine, Zeitblöcke) und die
 * Abendplanung nach Uhrzeit, dazwischen die Jetzt-Linie vor dem ersten Eintrag, der noch kommt.
 */
export function timeline<T extends TimedEntryLike>(
  entries: T[],
  nowTime: string,
  eveningTime: string,
): TimelineItem<T>[] {
  const items: TimelineItem<T>[] = [
    ...entries.map((entry) => ({ kind: "entry" as const, time: entry.time, entry })),
    { kind: "evening" as const, time: eveningTime },
  ].sort((a, b) => a.time.localeCompare(b.time));
  const next = items.findIndex((item) => item.time > nowTime);
  items.splice(next === -1 ? items.length : next, 0, { kind: "now", time: nowTime });
  return items;
}
