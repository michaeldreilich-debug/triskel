/**
 * Kalender-Modell (S2b): alles mit Datum an einem Ort, jedes genau einmal – als reine Funktionen,
 * die Woche, Monat, Tag, Liste, der Tagesablauf auf Heute und die Datenbank-Ansicht „Kalender“
 * (S2c) gleich benutzen. Kein "use client".
 *
 * Regeln (docs/02-design.md › Kalender):
 * - Aufgabe: Tag = geplant › Fokus › fällig. Offenes aus der Vergangenheit steht heute oben mit
 *   „überfällig seit …“; Erledigtes bleibt an seinem Tag, gedämpft.
 * - Fristen = Meilenstein- und Projekt-Zieldaten; wiederkehrende Aufgaben erscheinen an ihren
 *   künftigen Terminen blass (nur vorausberechnet).
 * - Rückblick-Tage: Sonntag Wochenrückblick, Monatsletzter Monatsrückblick.
 * - Feste Ordnung je Tag: ganztägig + Fristen, Termine nach Uhrzeit, Aufgaben darunter.
 */
import type { MilestoneRow, ProjectRow } from "@/features/projects/types";
import type { RecapRow } from "@/features/recaps/types";
import { upcomingOccurrences } from "@/features/tasks/recurrence";
import type { TaskRow } from "@/features/tasks/types";
import {
  addDays,
  addMonths,
  berlinDate,
  berlinMinutes,
  daysBetween,
  endOfMonth,
  formatDateLong,
  formatMonth,
  formatRange,
  type IsoDate,
  isoWeekday,
  isoWeekNumber,
  isoWeekRange,
  parseIsoDate,
  startOfMonth,
} from "@/lib/dates";
import { busyMinutes, splitByDay } from "./events";
import { holidayOn } from "./holidays";
import type { CalendarDaySegment, CalendarEvent, CalendarRange } from "./types";

/** Geplante Aufgabe ohne Dauer: so lang ist ihr Zeitblock (Minuten). */
export const DEFAULT_BLOCK_MIN = 60;
/** Aufgabe ohne Uhrzeit zählt in der Tageslast mit so vielen Minuten, wenn keine Dauer steht. */
export const DEFAULT_TASK_MIN = 30;
/** Tageslast: ab hier „voll“ bzw. „überladen“ (Minuten) */
export const FULL_MIN = 6 * 60;
export const OVERLOADED_MIN = 8 * 60;
export const OVERLOADED_TASKS = 8;
/** Arbeitstag für freie Fenster (Minuten seit Mitternacht) und Mindestlänge eines Fensters */
export const WORKDAY = { from: 8 * 60, to: 18 * 60 };
export const FREE_WINDOW_MIN = 60;

export type CalendarItem =
  | {
      kind: "event";
      id: string;
      date: IsoDate;
      event: CalendarEvent;
      segment: CalendarDaySegment;
    }
  | {
      kind: "task";
      id: string;
      date: IsoDate;
      task: TaskRow;
      /** Minuten seit Mitternacht (Zeitblock), sonst null */
      time: number | null;
      /** Länge des Zeitblocks in Minuten (nur mit `time`) */
      duration: number | null;
      /** offen und aus der Vergangenheit hierher geholt: seit wann */
      overdueSince: IsoDate | null;
      focus: boolean;
      /** Fälligkeit an einem anderen Tag als der Eintrag */
      dueElsewhere: IsoDate | null;
      done: boolean;
    }
  | { kind: "preview"; id: string; date: IsoDate; task: TaskRow }
  | {
      kind: "milestone";
      id: string;
      date: IsoDate;
      milestone: MilestoneRow;
      project: ProjectRow;
      done: boolean;
    }
  | { kind: "target"; id: string; date: IsoDate; project: ProjectRow; done: boolean }
  | {
      kind: "recap";
      id: string;
      date: IsoDate;
      recapKind: "woche" | "monat";
      periodStart: IsoDate;
      recap: RecapRow | null;
    };

export type CalendarItemKind = CalendarItem["kind"];

/** Eintrag mit Uhrzeit im Tagesraster (Termin oder Zeitblock einer Aufgabe). */
export interface TimedEntry {
  item: CalendarItem;
  from: number;
  to: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export type LoadLevel = "frei" | "normal" | "voll" | "ueberladen";

export interface DayLoad {
  /** belegte Termin-Minuten (Überlappungen einmal) */
  busyMinutes: number;
  /** Minuten der offenen Aufgaben (Zeitblöcke und Dauer, sonst DEFAULT_TASK_MIN) */
  taskMinutes: number;
  openTasks: number;
  level: LoadLevel;
}

export const LOAD_LABELS: Record<LoadLevel, string> = {
  frei: "frei",
  normal: "normal",
  voll: "voll",
  ueberladen: "überladen",
};

export interface CalendarDay {
  date: IsoDate;
  /** 0 = Montag … 6 = Sonntag */
  weekday: number;
  holiday: string | null;
  isToday: boolean;
  /** ganztägige Termine, Fristen, Rückblick-Tage */
  allDay: CalendarItem[];
  /** Termine und Zeitblöcke nach Uhrzeit */
  timed: TimedEntry[];
  /** Aufgaben ohne Uhrzeit (überfällig zuerst) und blasse Wiederholungen */
  tasks: CalendarItem[];
  load: DayLoad;
  /** Frist an einem vollen Tag (Warnsymbol) */
  deadlineOnFullDay: boolean;
}

export interface CalendarFilters {
  events: boolean;
  tasks: boolean;
  done: boolean;
  projectId: string | null;
}

export const DEFAULT_FILTERS: CalendarFilters = {
  events: true,
  tasks: true,
  done: true,
  projectId: null,
};

/**
 * Termine erst laden, wenn der heutige Tag im Browser bekannt ist (K-2): vorher stünde der
 * Zeitraum um 2000-01-01, und bei warmem Quellen-Cache ginge ein nutzloser Abruf raus.
 */
export function eventsWanted(input: {
  today: IsoDate | "";
  hasSources: boolean;
  filters: Pick<CalendarFilters, "events">;
}): boolean {
  return input.today !== "" && input.hasSources && input.filters.events;
}

export interface CalendarInput {
  range: CalendarRange;
  today: IsoDate;
  events: CalendarEvent[];
  tasks: TaskRow[];
  projects: ProjectRow[];
  milestones: MilestoneRow[];
  recaps: RecapRow[];
  /** gewählter Bereich (null = alle) */
  area: string | null;
  filters: CalendarFilters;
  /** Rückblick-Tage (So Wochenrückblick, Monatsletzter) – aus, wo nur Datenbankinhalt zählt */
  recapDays?: boolean;
}

export interface CalendarResult {
  days: CalendarDay[];
  /** Aufgaben im Zeitraum, die der Bereichs-Schalter ausblendet */
  hiddenByArea: number;
  /** ihre Tage (je Aufgabe einer) – der Monat zum Durchscrollen zählt nur den sichtbaren (#85) */
  hiddenDates: IsoDate[];
}

const byTitle = (a: string, b: string) => a.localeCompare(b, "de");
const bySort = (a: TaskRow, b: TaskRow) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);
const priorityOf = (t: TaskRow) => t.priority ?? 9;

/** Tag einer Aufgabe im Kalender: geplant › Fokus › fällig. null = ohne Datum. */
export function taskAnchor(task: Pick<TaskRow, "scheduled_at" | "focus_date" | "due_date">) {
  if (task.scheduled_at) return berlinDate(task.scheduled_at);
  return task.focus_date ?? task.due_date ?? null;
}

/** Wo und wie eine Aufgabe erscheint – ein Eintrag, nie zwei. null = nicht im Kalender. */
export function placeTask(
  task: TaskRow,
  today: IsoDate,
): Extract<CalendarItem, { kind: "task" }> | null {
  if (task.deleted_at) return null;
  const anchor = taskAnchor(task);
  if (!anchor) return null;
  const done = task.status === "erledigt";
  const overdue = !done && anchor < today;
  const date = overdue ? today : anchor;
  const scheduledOnDay = task.scheduled_at && berlinDate(task.scheduled_at) === date;
  const time =
    scheduledOnDay && task.scheduled_at ? berlinMinutes(new Date(task.scheduled_at)) : null;
  const dueSince = task.due_date && task.due_date < today ? task.due_date : anchor;
  return {
    kind: "task",
    id: `task:${task.id}`,
    date,
    task,
    time,
    duration: time === null ? null : (task.duration_min ?? DEFAULT_BLOCK_MIN),
    overdueSince: overdue ? dueSince : null,
    focus: task.focus_date === date,
    dueElsewhere: task.due_date && task.due_date !== date ? task.due_date : null,
    done,
  };
}

const inRange = (date: IsoDate | null, range: CalendarRange): date is IsoDate =>
  date !== null && date >= range.start && date <= range.end;

// Monatsgrenzen liegen in `@/lib/dates` (auch der Monatsrückblick braucht sie)
export { endOfMonth, startOfMonth };

function loadLevel(minutes: number, openTasks: number): LoadLevel {
  if (minutes >= OVERLOADED_MIN || openTasks >= OVERLOADED_TASKS) return "ueberladen";
  if (minutes >= FULL_MIN) return "voll";
  return minutes > 0 || openTasks > 0 ? "normal" : "frei";
}

const sortAllDay = (a: CalendarItem, b: CalendarItem) => {
  const rank = (i: CalendarItem) =>
    i.kind === "event" ? 0 : i.kind === "target" ? 1 : i.kind === "milestone" ? 2 : 3;
  return rank(a) - rank(b) || byTitle(itemTitle(a), itemTitle(b));
};

/** Titel eines Eintrags (für Sortierung, Screenreader, Listen). */
export function itemTitle(item: CalendarItem): string {
  switch (item.kind) {
    case "event":
      return item.event.title;
    case "task":
    case "preview":
      return item.task.title.trim() || "Ohne Titel";
    case "milestone":
      return item.milestone.title.trim() || "Meilenstein";
    case "target":
      return `Ziel: ${item.project.title.trim() || "Ohne Titel"}`;
    case "recap":
      return item.recapKind === "woche"
        ? `Wochenrückblick KW ${isoWeekNumber(item.periodStart)}`
        : "Monatsrückblick";
  }
}

/**
 * Alle Tage eines Zeitraums mit ihren Einträgen. Bereich und Filter wirken auf Aufgaben, Fristen
 * und Rückblick-Tage; Termine aus Google kennen keinen Bereich.
 */
export function buildCalendarDays(input: CalendarInput): CalendarResult {
  const { range, today, area, filters } = input;
  const days = new Map<IsoDate, CalendarDay>();
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    days.set(d, {
      date: d,
      weekday: isoWeekday(d),
      holiday: holidayOn(d),
      isToday: d === today,
      allDay: [],
      timed: [],
      tasks: [],
      load: { busyMinutes: 0, taskMinutes: 0, openTasks: 0, level: "frei" },
      deadlineOnFullDay: false,
    });
  }
  const day = (d: IsoDate) => days.get(d);
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  const inArea = (areaId: string | null | undefined) => !area || areaId === area;
  const inProject = (projectId: string | null | undefined) =>
    !filters.projectId || projectId === filters.projectId;
  const hiddenDates: IsoDate[] = [];

  // Termine
  if (filters.events) {
    for (const segment of splitByDay(input.events, range)) {
      const target = day(segment.date);
      if (!target) continue;
      const item: CalendarItem = {
        kind: "event",
        id: `event:${segment.event.id}:${segment.date}`,
        date: segment.date,
        event: segment.event,
        segment,
      };
      if (segment.event.allDay) target.allDay.push(item);
      else
        target.timed.push({
          item,
          from: segment.from,
          to: segment.to,
          continuesBefore: segment.continuesBefore,
          continuesAfter: segment.continuesAfter,
        });
    }
  }

  // Aufgaben (ein Eintrag je Aufgabe) und blasse Wiederholungen
  if (filters.tasks) {
    const live = input.tasks.filter((t) => !t.deleted_at);
    const placed = live
      .map((t) => placeTask(t, today))
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .filter((p) => inRange(p.date, range));
    for (const item of placed) {
      if (!inArea(item.task.area_id)) {
        hiddenDates.push(item.date);
        continue;
      }
      if (!inProject(item.task.project_id)) continue;
      if (item.done && !filters.done) continue;
      const target = day(item.date);
      if (!target) continue;
      if (item.time !== null) {
        const to = Math.min(24 * 60, item.time + (item.duration ?? DEFAULT_BLOCK_MIN));
        target.timed.push({
          item,
          from: item.time,
          to,
          continuesBefore: false,
          continuesAfter: false,
        });
      } else {
        target.tasks.push(item);
      }
    }
    for (const task of live) {
      if (!task.recurrence || !task.due_date || task.status === "erledigt") continue;
      if (!inArea(task.area_id) || !inProject(task.project_id)) continue;
      for (const date of upcomingOccurrences(
        task.recurrence,
        task.due_date,
        range.start,
        range.end,
      )) {
        day(date)?.tasks.push({ kind: "preview", id: `preview:${task.id}:${date}`, date, task });
      }
    }
  }

  // Fristen: Meilensteine und Projekt-Zieldaten
  for (const project of input.projects) {
    if (project.deleted_at || !inArea(project.area_id) || !inProject(project.id)) continue;
    if (inRange(project.target_date, range)) {
      const done = project.status === "abgeschlossen" || project.status === "archiv";
      if (done && !filters.done) continue;
      day(project.target_date)?.allDay.push({
        kind: "target",
        id: `target:${project.id}`,
        date: project.target_date,
        project,
        done,
      });
    }
  }
  for (const milestone of input.milestones) {
    if (milestone.deleted_at || !inRange(milestone.due_date, range)) continue;
    const project = projectById.get(milestone.project_id);
    if (!project || project.deleted_at || !inArea(project.area_id) || !inProject(project.id)) {
      continue;
    }
    const done = milestone.done_at !== null;
    if (done && !filters.done) continue;
    day(milestone.due_date)?.allDay.push({
      kind: "milestone",
      id: `milestone:${milestone.id}`,
      date: milestone.due_date,
      milestone,
      project,
      done,
    });
  }

  // Rückblick-Tage (nur ohne Projektfilter – sie gehören zu keinem Projekt)
  if (!filters.projectId && input.recapDays !== false) {
    const recapFor = (kind: "woche" | "monat", start: IsoDate) =>
      input.recaps.find((r) => !r.deleted_at && r.kind === kind && r.period_start === start) ??
      null;
    for (const target of days.values()) {
      if (target.weekday === 6) {
        const { start } = isoWeekRange(target.date);
        target.allDay.push({
          kind: "recap",
          id: `recap:woche:${start}`,
          date: target.date,
          recapKind: "woche",
          periodStart: start,
          recap: recapFor("woche", start),
        });
      }
      if (target.date === endOfMonth(target.date)) {
        const start = startOfMonth(target.date);
        target.allDay.push({
          kind: "recap",
          id: `recap:monat:${start}`,
          date: target.date,
          recapKind: "monat",
          periodStart: start,
          recap: recapFor("monat", start),
        });
      }
    }
  }

  // Ordnung je Tag und Tageslast
  const byTime = (a: TimedEntry, b: TimedEntry) =>
    a.from - b.from ||
    b.to - a.to ||
    Number(a.item.kind === "task") - Number(b.item.kind === "task") ||
    byTitle(itemTitle(a.item), itemTitle(b.item));
  const byTask = (a: CalendarItem, b: CalendarItem) => {
    const rank = (i: CalendarItem) => {
      if (i.kind === "preview") return 4;
      if (i.kind !== "task") return 5;
      if (i.overdueSince) return i.done ? 3 : 0;
      return i.done ? 3 : i.focus ? 1 : 2;
    };
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.kind === "task" && b.kind === "task") {
      return (
        (a.overdueSince ?? "").localeCompare(b.overdueSince ?? "") ||
        priorityOf(a.task) - priorityOf(b.task) ||
        bySort(a.task, b.task)
      );
    }
    return byTitle(itemTitle(a), itemTitle(b));
  };
  for (const target of days.values()) {
    target.allDay.sort(sortAllDay);
    target.timed.sort(byTime);
    target.tasks.sort(byTask);
    const eventSegments = target.timed
      .filter((e) => e.item.kind === "event")
      .map((e) => (e.item as Extract<CalendarItem, { kind: "event" }>).segment);
    const busy = busyMinutes(eventSegments);
    let taskMinutes = 0;
    let openTasks = 0;
    for (const entry of target.timed) {
      if (entry.item.kind === "task" && !entry.item.done) {
        taskMinutes += entry.to - entry.from;
        openTasks++;
      }
    }
    for (const item of target.tasks) {
      if (item.kind === "task" && !item.done) {
        taskMinutes += item.task.duration_min ?? DEFAULT_TASK_MIN;
        openTasks++;
      }
    }
    const level = loadLevel(busy + taskMinutes, openTasks);
    target.load = { busyMinutes: busy, taskMinutes, openTasks, level };
    target.deadlineOnFullDay =
      (level === "voll" || level === "ueberladen") &&
      target.allDay.some((i) => (i.kind === "milestone" || i.kind === "target") && !i.done);
  }

  return { days: [...days.values()], hiddenByArea: hiddenDates.length, hiddenDates };
}

/** Zeitraum einer Ansicht um ein Datum: Tag, Woche (Mo–So), Monat (Raster Mo–So) oder Liste (14 Tage). */
export type CalendarView = "tag" | "woche" | "monat" | "liste";
export const CALENDAR_VIEWS: CalendarView[] = ["tag", "woche", "monat", "liste"];
export const VIEW_LABELS: Record<CalendarView, string> = {
  tag: "Tag",
  woche: "Woche",
  monat: "Monat",
  liste: "Liste",
};
export const AGENDA_DAYS = 14;

/** `?tag=` aus der Adresse: nur ein echter Kalendertag (K-3: „2026-13-45“ ließ die Seite abstürzen). */
export function parseDateParam(value: string | null | undefined): IsoDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return parseIsoDate(value) ? value : null;
}

export function parseCalendarView(value: unknown): CalendarView | null {
  return (CALENDAR_VIEWS as unknown[]).includes(value) ? (value as CalendarView) : null;
}

export function viewRange(view: CalendarView, date: IsoDate): CalendarRange {
  switch (view) {
    case "tag":
      return { start: date, end: date };
    case "woche":
      return isoWeekRange(date);
    case "monat": {
      const start = isoWeekRange(startOfMonth(date)).start;
      const end = isoWeekRange(endOfMonth(date)).end;
      return { start, end };
    }
    case "liste":
      return { start: date, end: addDays(date, AGENDA_DAYS - 1) };
  }
}

/** Überschrift des Zeitraums je Ansicht. */
export function periodLabel(view: CalendarView, date: IsoDate): string {
  const range = viewRange(view, date);
  switch (view) {
    case "tag": {
      const parsed = parseIsoDate(date);
      return `${parsed ? formatDateLong(parsed) : date} · KW ${isoWeekNumber(date)}`;
    }
    case "woche":
      return `KW ${isoWeekNumber(date)} · ${formatRange(range.start, range.end)}`;
    case "monat":
      return formatMonth(date);
    case "liste":
      return `${formatRange(range.start, range.end)} · 14 Tage`;
  }
}

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

/**
 * Große Seitenüberschrift (#67): Monat und Jahr des Zeitraums. Reicht er über zwei Monate,
 * „Okt – Nov 2026“, über den Jahreswechsel „Dez 2026 – Jan 2027“.
 */
export function periodTitle(view: CalendarView, date: IsoDate): string {
  if (view === "monat" || view === "tag") return formatMonth(date);
  const { start, end } = viewRange(view, date);
  const [y1, m1] = start.split("-").map(Number) as [number, number];
  const [y2, m2] = end.split("-").map(Number) as [number, number];
  if (y1 === y2 && m1 === m2) return formatMonth(start);
  const a = MONTHS_SHORT[m1 - 1] ?? "";
  const b = MONTHS_SHORT[m2 - 1] ?? "";
  return y1 === y2 ? `${a} – ${b} ${y2}` : `${a} ${y1} – ${b} ${y2}`;
}

/** Kleine Zeile über der Überschrift: „Kalender“ plus der genaue Zeitraum (außer im Monat). */
export function periodMeta(view: CalendarView, date: IsoDate): string {
  return view === "monat" ? "Kalender" : `Kalender · ${periodLabel(view, date)}`;
}

/** Datum nach ←/→: ein Tag, eine Woche, ein Monat bzw. 14 Tage weiter. */
export function stepDate(view: CalendarView, date: IsoDate, by: -1 | 1): IsoDate {
  switch (view) {
    case "tag":
      return addDays(date, by);
    case "woche":
      return addDays(date, 7 * by);
    case "monat": {
      const [y, m] = date.split("-").map(Number) as [number, number];
      const target = new Date(Date.UTC(y, m - 1 + by, 1));
      return target.toISOString().slice(0, 10);
    }
    case "liste":
      return addDays(date, AGENDA_DAYS * by);
  }
}

/** Zusammenfassung unter dem Titel (Muster 1): Termine, Aufgaben, überfällig, vollster Tag. */
export function calendarSummary(days: CalendarDay[], range: CalendarRange) {
  const within = days.filter((d) => d.date >= range.start && d.date <= range.end);
  let events = 0;
  let tasks = 0;
  let overdue = 0;
  let fullest: CalendarDay | null = null;
  for (const d of within) {
    events += d.allDay.filter((i) => i.kind === "event").length;
    events += d.timed.filter((e) => e.item.kind === "event").length;
    const open = [...d.tasks, ...d.timed.map((e) => e.item)].filter(
      (i): i is Extract<CalendarItem, { kind: "task" }> => i.kind === "task" && !i.done,
    );
    tasks += open.length;
    overdue += open.filter((i) => i.overdueSince !== null).length;
    const minutes = d.load.busyMinutes + d.load.taskMinutes;
    if (
      (d.load.level === "voll" || d.load.level === "ueberladen") &&
      (!fullest || minutes > fullest.load.busyMinutes + fullest.load.taskMinutes)
    ) {
      fullest = d;
    }
  }
  return { events, tasks, overdue, fullest };
}

/** Tage, die ein Tag vom heutigen entfernt ist (für „in 3 Tagen“ u. Ä.). */
export const daysFromToday = (date: IsoDate, today: IsoDate) => daysBetween(today, date);

/* ------------------------------------------------------------------ */
/* Monat zum Durchscrollen (#85)                                      */
/* ------------------------------------------------------------------ */

/**
 * Fenster der Monatsansicht auf /kalender (#85): so viele Monate vor und nach dem gewählten,
 * beim Scrollen an ein Ende `step` Monate dazu, höchstens `max` auf einmal (das ferne Ende fällt
 * dann weg) – genug Vorlauf zum Scrollen, ohne Hunderte Wochen im Raster.
 */
export const MONTH_WINDOW = { before: 3, after: 3, step: 3, max: 15 } as const;

/** Monate eines Fensters, je als erster Tag („JJJJ-MM-01“), beide inklusive. */
export interface MonthWindow {
  first: IsoDate;
  last: IsoDate;
}

/** Erster Tag des Monats eines Datums, um `by` Monate verschoben. */
export const monthOf = (date: IsoDate, by = 0): IsoDate => addMonths(startOfMonth(date), by);

const monthIndex = (date: IsoDate) => {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return y * 12 + m - 1;
};

/** Abstand zweier Monate (b − a) in Monaten. */
export const monthsBetween = (a: IsoDate, b: IsoDate) => monthIndex(b) - monthIndex(a);

export function monthWindowAround(date: IsoDate): MonthWindow {
  return { first: monthOf(date, -MONTH_WINDOW.before), last: monthOf(date, MONTH_WINDOW.after) };
}

export function inMonthWindow(window: MonthWindow, date: IsoDate): boolean {
  const month = monthOf(date);
  return month >= window.first && month <= window.last;
}

/** Fenster nach oben (−1) bzw. unten (1) verlängern; über `max` fällt das andere Ende weg. */
export function extendMonthWindow(window: MonthWindow, direction: -1 | 1): MonthWindow {
  const keep = MONTH_WINDOW.max - 1;
  if (direction < 0) {
    const first = monthOf(window.first, -MONTH_WINDOW.step);
    const last = monthsBetween(first, window.last) > keep ? monthOf(first, keep) : window.last;
    return { first, last };
  }
  const last = monthOf(window.last, MONTH_WINDOW.step);
  const first = monthsBetween(window.first, last) > keep ? monthOf(last, -keep) : window.first;
  return { first, last };
}

/** Tage des Fensters: ganze Wochen vom Montag vor dem ersten bis zum Sonntag nach dem letzten Monat. */
export function monthWindowRange(window: MonthWindow): CalendarRange {
  return {
    start: isoWeekRange(window.first).start,
    end: isoWeekRange(endOfMonth(window.last)).end,
  };
}

/** Erste Tage aller Monate, die ein Zeitraum berührt (Termine werden monatsweise geladen). */
export function monthsOfRange(range: CalendarRange): IsoDate[] {
  const months: IsoDate[] = [];
  for (let month = monthOf(range.start); month <= range.end; month = monthOf(month, 1)) {
    months.push(month);
  }
  return months;
}

/**
 * Monat, der im Bild „dran“ ist (#85): der mit den meisten sichtbaren Tagen; eine Woche zählt mit
 * dem Anteil, zu dem sie zu sehen ist (0–1). Bei Gleichstand der frühere. null = nichts zu sehen.
 */
export function dominantMonth(weeks: Array<{ start: IsoDate; visible: number }>): IsoDate | null {
  const score = new Map<IsoDate, number>();
  for (const week of weeks) {
    if (week.visible <= 0) continue;
    for (let i = 0; i < 7; i++) {
      const month = monthOf(addDays(week.start, i));
      score.set(month, (score.get(month) ?? 0) + week.visible);
    }
  }
  let best: IsoDate | null = null;
  let bestScore = 0;
  for (const [month, value] of [...score].sort(([a], [b]) => a.localeCompare(b))) {
    if (value > bestScore + 1e-6) {
      best = month;
      bestScore = value;
    }
  }
  return best;
}
