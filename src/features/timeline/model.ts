/**
 * Zeitstrahl der Projekte (#55, N2): reine Rechnung ohne Browser-Code und ohne neue Daten.
 * Aus Projekten (Start, Ziel), Meilensteinen (Fälligkeit, erreicht) und Aufgaben entsteht
 * - der Zeitraum (Fenster) mit Monats- und Wochenlinien und der Heute-Linie,
 * - je Projekt eine Zeile mit Balken (Start → Ziel) und Meilenstein-Punkten,
 * - die Kennzahlen im Kopf und die Karten „Nächster Schritt“.
 * Datum und „heute“ kommen von außen (Browser: `berlinDate()`), nichts hier liest die Uhr.
 */
import {
  addDays,
  addMonths,
  berlinDate,
  daysBetween,
  endOfMonth,
  type IsoDate,
  isoWeekday,
  startOfMonth,
} from "@/lib/dates";
import { projectProgress } from "../projects/rules";
import {
  isOpenProject,
  type MilestoneRow,
  type ProjectRow,
  type ProjectStatus,
} from "../projects/types";
import type { TaskRow } from "../tasks/types";

/** Status, die der Zeitstrahl zeigen kann (Archiv bleibt draußen). */
export const TIMELINE_STATUSES = ["aktiv", "geplant", "pausiert", "idee", "abgeschlossen"] as const;
export type TimelineStatus = (typeof TIMELINE_STATUSES)[number];
export const DEFAULT_TIMELINE_STATUSES: TimelineStatus[] = ["aktiv", "geplant"];

export const TIMELINE_ZOOMS = ["3m", "6m", "12m", "alles"] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];
export const ZOOM_LABELS: Record<TimelineZoom, string> = {
  "3m": "3 Monate",
  "6m": "6 Monate",
  "12m": "Jahr",
  alles: "Alles",
};
/** Monate je Fenster und je Schritt mit ‹ ›. */
const ZOOM_MONTHS: Record<Exclude<TimelineZoom, "alles">, { span: number; step: number }> = {
  "3m": { span: 3, step: 1 },
  "6m": { span: 6, step: 3 },
  "12m": { span: 12, step: 6 },
};

export const TIMELINE_SORTS = ["ziel", "start"] as const;
export type TimelineSort = (typeof TIMELINE_SORTS)[number];
export const SORT_LABELS: Record<TimelineSort, string> = { ziel: "Nach Ziel", start: "Nach Start" };

export interface TimelineFilters {
  statuses: TimelineStatus[];
  zoom: TimelineZoom;
  sort: TimelineSort;
}

export const DEFAULT_TIMELINE_FILTERS: TimelineFilters = {
  statuses: DEFAULT_TIMELINE_STATUSES,
  zoom: "6m",
  sort: "ziel",
};

/** Gespeicherte Filter defensiv lesen (alter oder von Hand geänderter Gerätestand). */
export function parseTimelineFilters(raw: unknown): TimelineFilters {
  if (!raw || typeof raw !== "object") return DEFAULT_TIMELINE_FILTERS;
  const v = raw as Record<string, unknown>;
  const statuses = Array.isArray(v.statuses)
    ? TIMELINE_STATUSES.filter((s) => (v.statuses as unknown[]).includes(s))
    : DEFAULT_TIMELINE_STATUSES;
  const zoom = (TIMELINE_ZOOMS as readonly unknown[]).includes(v.zoom)
    ? (v.zoom as TimelineZoom)
    : DEFAULT_TIMELINE_FILTERS.zoom;
  const sort = (TIMELINE_SORTS as readonly unknown[]).includes(v.sort)
    ? (v.sort as TimelineSort)
    : DEFAULT_TIMELINE_FILTERS.sort;
  return { statuses: [...statuses], zoom, sort };
}

export interface TimelineWindow {
  /** erster und letzter Tag (beide eingeschlossen) */
  start: IsoDate;
  end: IsoDate;
}

/** Tage im Fenster (beide Enden eingeschlossen). */
export const windowDays = (w: TimelineWindow) => daysBetween(w.start, w.end) + 1;

/**
 * Position eines Tags im Fenster in Prozent (0 = links, 100 = rechts; Tage außerhalb liegen
 * darunter bzw. darüber). Ein Tag nimmt seine ganze Breite ein, die Position ist seine Mitte.
 */
export function axisPos(window: TimelineWindow, date: IsoDate): number {
  return ((daysBetween(window.start, date) + 0.5) / windowDays(window)) * 100;
}

/** Linke Kante eines Tags in Prozent (für Balken und Monatslinien). */
const edgePos = (window: TimelineWindow, date: IsoDate) =>
  (daysBetween(window.start, date) / windowDays(window)) * 100;

/** Schritt für ‹ › in Monaten (bei „alles“ gibt es kein Verschieben). */
export const zoomStep = (zoom: TimelineZoom) => (zoom === "alles" ? 0 : ZOOM_MONTHS[zoom].step);

/**
 * Fenster für Zeitraum und Verschiebung. Monate: ein Monat vor dem laufenden bis (Spanne − 1)
 * Monate danach, `offset` Schritte verschoben. „alles“: von `bounds` (frühester/spätester Tag
 * der Zeilen) und heute, auf Monatsgrenzen, mindestens 3 Monate.
 */
export function timelineWindow(
  zoom: TimelineZoom,
  offset: number,
  today: IsoDate,
  bounds?: { from: IsoDate; to: IsoDate } | null,
): TimelineWindow {
  if (zoom === "alles") {
    const from = bounds && bounds.from < today ? bounds.from : today;
    const to = bounds && bounds.to > today ? bounds.to : today;
    const start = startOfMonth(from);
    let end = endOfMonth(to);
    if (daysBetween(start, end) < 88) end = endOfMonth(addMonths(start, 2));
    return { start, end };
  }
  const { span, step } = ZOOM_MONTHS[zoom];
  const start = startOfMonth(addMonths(today, -1 + offset * step));
  return { start, end: endOfMonth(addMonths(start, span - 1)) };
}

const MONTHS_SHORT = [
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

export interface AxisMonth {
  /** erster Tag des Monats */
  date: IsoDate;
  label: string;
  /** linke Kante in Prozent (kann bei angeschnittenem ersten Monat 0 sein) */
  left: number;
  width: number;
}

/** Monate des Fensters; der Januar und der erste Monat tragen die Jahreszahl („Jan 27“). */
export function axisMonths(window: TimelineWindow): AxisMonth[] {
  const out: AxisMonth[] = [];
  let cursor = startOfMonth(window.start);
  while (cursor <= window.end) {
    const next = addMonths(cursor, 1);
    const from = cursor < window.start ? window.start : cursor;
    const lastDay = addDays(next, -1);
    const to = lastDay > window.end ? window.end : lastDay;
    const month = Number(cursor.slice(5, 7));
    const label = `${MONTHS_SHORT[month - 1]}${month === 1 || out.length === 0 ? ` ${cursor.slice(2, 4)}` : ""}`;
    out.push({
      date: cursor,
      label,
      left: edgePos(window, from),
      width: edgePos(window, addDays(to, 1)) - edgePos(window, from),
    });
    cursor = next;
  }
  return out;
}

/** Montage im Fenster als Wochenlinien (Prozent von links), nur sinnvoll bei kurzen Fenstern. */
export function axisWeeks(window: TimelineWindow): number[] {
  const out: number[] = [];
  let day = addDays(window.start, (7 - isoWeekday(window.start)) % 7);
  while (day <= window.end) {
    if (day !== window.start) out.push(edgePos(window, day));
    day = addDays(day, 7);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Zeilen                                                              */
/* ------------------------------------------------------------------ */

export type MilestoneState = "done" | "open" | "overdue";

export interface TimelineMilestone {
  id: string;
  title: string;
  /** Tag auf der Achse: Fälligkeit, sonst der Tag, an dem er erreicht wurde */
  date: IsoDate;
  due: IsoDate | null;
  doneOn: IsoDate | null;
  state: MilestoneState;
  pos: number;
  tasksDone: number;
  tasksTotal: number;
}

export interface TimelineBar {
  /** Prozent von links und Breite, auf das Fenster zugeschnitten */
  left: number;
  width: number;
  /** nur abgeleitet (nur Start oder nur Ziel gesetzt) – gestrichelt gezeichnet */
  inferred: boolean;
  /** Balken läuft links bzw. rechts über das Fenster hinaus */
  cutLeft: boolean;
  cutRight: boolean;
  from: IsoDate;
  to: IsoDate;
}

export interface TimelineRow {
  project: ProjectRow;
  bar: TimelineBar | null;
  /** Punkte im Fenster */
  milestones: TimelineMilestone[];
  milestoneTotal: number;
  milestoneDone: number;
  overdue: number;
  /** frühester/spätester Tag des Projekts auf der Achse */
  from: IsoDate;
  to: IsoDate;
}

export interface TimelineInput {
  projects: ProjectRow[];
  milestones: MilestoneRow[];
  tasks: TaskRow[];
  /** gewählter Bereich (Bereichs-Schalter), null = alle */
  area: string | null;
  filters: TimelineFilters;
  offset: number;
  today: IsoDate;
}

export interface TimelineModel {
  window: TimelineWindow;
  months: AxisMonth[];
  weeks: number[];
  /** Position der Heute-Linie in Prozent, null wenn heute außerhalb liegt */
  todayPos: number | null;
  rows: TimelineRow[];
  /** Projekte ohne jedes Datum (keine Achse möglich) */
  undated: ProjectRow[];
  /** passende Projekte in anderen Bereichen (Hinweis „N weitere“) */
  hiddenByArea: number;
}

const createdDay = (project: ProjectRow): IsoDate => berlinDate(project.created_at);

/** Meilenstein auf der Achse: nur mit Datum (Fälligkeit oder Erreicht-Tag), nie gelöscht. */
function placeMilestones(
  project: ProjectRow,
  milestones: MilestoneRow[],
  tasks: TaskRow[],
  today: IsoDate,
): TimelineMilestone[] {
  const out: TimelineMilestone[] = [];
  for (const m of milestones) {
    if (m.project_id !== project.id || m.deleted_at) continue;
    const doneOn = m.done_at ? berlinDate(m.done_at) : null;
    const date = m.due_date ?? doneOn;
    if (!date) continue;
    const own = tasks.filter((t) => t.milestone_id === m.id && !t.deleted_at);
    out.push({
      id: m.id,
      title: m.title,
      date,
      due: m.due_date,
      doneOn,
      state: doneOn ? "done" : m.due_date && m.due_date < today ? "overdue" : "open",
      pos: 0,
      tasksDone: own.filter((t) => t.status === "erledigt").length,
      tasksTotal: own.length,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

interface Draft {
  project: ProjectRow;
  ms: TimelineMilestone[];
  barFrom: IsoDate | null;
  barTo: IsoDate | null;
  inferred: boolean;
  from: IsoDate | null;
  to: IsoDate | null;
}

/** Spanne eines Projekts: Balken (Start → Ziel, sonst abgeleitet) und früheste/späteste Daten. */
function draft(
  project: ProjectRow,
  milestones: MilestoneRow[],
  tasks: TaskRow[],
  today: IsoDate,
): Draft {
  const ms = placeMilestones(project, milestones, tasks, today);
  const first = ms[0]?.date ?? null;
  const last = ms[ms.length - 1]?.date ?? null;
  const { start_date: start, target_date: target } = project;
  let barFrom: IsoDate | null = null;
  let barTo: IsoDate | null = null;
  let inferred = false;
  if (start && target) {
    barFrom = start <= target ? start : target;
    barTo = start <= target ? target : start;
  } else if (start) {
    inferred = true;
    barFrom = start;
    barTo = last && last > start ? last : start;
    if (project.status === "aktiv" && today > barTo) barTo = today;
  } else if (target) {
    inferred = true;
    const created = createdDay(project);
    barTo = target;
    barFrom = created < target ? created : target;
    if (first && first < barFrom) barFrom = first;
  }
  const dates = [barFrom, barTo, first, last].filter((d): d is IsoDate => d !== null);
  dates.sort();
  return {
    project,
    ms,
    barFrom,
    barTo,
    inferred,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}

const bySort = (sort: TimelineSort) => (a: Draft, b: Draft) => {
  const key = (d: Draft) =>
    sort === "ziel"
      ? (d.project.target_date ?? d.to ?? "9999-12-31")
      : (d.project.start_date ?? d.from ?? "9999-12-31");
  const ka = key(a);
  const kb = key(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.project.title.localeCompare(b.project.title, "de");
};

/**
 * Alles für die Achse: Projekte nach Bereich und Status gefiltert, im Fenster sichtbar,
 * sortiert. Ohne jedes Datum → `undated`. Projekte in anderen Bereichen zählt `hiddenByArea`.
 */
export function buildTimeline(input: TimelineInput): TimelineModel {
  const { projects, milestones, tasks, area, filters, offset, today } = input;
  const wanted = new Set<string>(filters.statuses);
  const matching = projects.filter((p) => !p.deleted_at && wanted.has(p.status));
  const inArea = matching.filter((p) => !area || p.area_id === area);
  const drafts = inArea.map((p) => draft(p, milestones, tasks, today)).sort(bySort(filters.sort));

  const dated = drafts.filter((d) => d.from && d.to);
  const undated = drafts.filter((d) => !d.from).map((d) => d.project);
  const bounds =
    dated.length > 0
      ? {
          from: dated.reduce((m, d) => (d.from && d.from < m ? d.from : m), "9999-12-31"),
          to: dated.reduce((m, d) => (d.to && d.to > m ? d.to : m), "0000-01-01"),
        }
      : null;
  const window = timelineWindow(filters.zoom, offset, today, bounds);

  const rows: TimelineRow[] = [];
  for (const d of dated) {
    const from = d.from as IsoDate;
    const to = d.to as IsoDate;
    if (from > window.end || to < window.start) continue;
    let bar: TimelineBar | null = null;
    if (d.barFrom && d.barTo) {
      const cutLeft = d.barFrom < window.start;
      const cutRight = d.barTo > window.end;
      const a = cutLeft ? window.start : d.barFrom;
      const b = cutRight ? window.end : d.barTo;
      bar = {
        left: edgePos(window, a),
        width: edgePos(window, addDays(b, 1)) - edgePos(window, a),
        inferred: d.inferred,
        cutLeft,
        cutRight,
        from: d.barFrom,
        to: d.barTo,
      };
    }
    const inWindow = d.ms
      .filter((m) => m.date >= window.start && m.date <= window.end)
      .map((m) => ({ ...m, pos: axisPos(window, m.date) }));
    const all = milestones.filter((m) => m.project_id === d.project.id && !m.deleted_at);
    rows.push({
      project: d.project,
      bar,
      milestones: inWindow,
      milestoneTotal: all.length,
      milestoneDone: all.filter((m) => m.done_at).length,
      overdue: d.ms.filter((m) => m.state === "overdue").length,
      from,
      to,
    });
  }

  return {
    window,
    months: axisMonths(window),
    weeks: filters.zoom === "3m" ? axisWeeks(window) : [],
    todayPos: today >= window.start && today <= window.end ? axisPos(window, today) : null,
    rows,
    undated,
    hiddenByArea: area ? matching.filter((p) => p.area_id !== area).length : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Kennzahlen und Karten                                               */
/* ------------------------------------------------------------------ */

export interface TimelineStats {
  active: number;
  /** Meilensteine mit Fälligkeit im laufenden Monat (offener Projekte) und davon erreicht */
  monthMilestones: number;
  monthDone: number;
  overdueMilestones: number;
  /** Projekte, in denen sie überfällig sind */
  overdueProjects: number;
  taskDone: number;
  taskTotal: number;
  /** 0–1, null ohne Aufgaben */
  progress: number | null;
}

/**
 * Kennzahlen im Kopf: aktive Projekte im gewählten Bereich, Meilensteine dieses Monats und
 * überfällige (offene Projekte), Fortschritt = erledigte ÷ alle Aufgaben der aktiven Projekte.
 * Unabhängig von Status- und Zeitraum-Filter, damit die Zahlen ruhig bleiben.
 */
export function timelineStats(
  projects: ProjectRow[],
  milestones: MilestoneRow[],
  tasks: TaskRow[],
  area: string | null,
  today: IsoDate,
): TimelineStats {
  const scope = projects.filter((p) => !p.deleted_at && (!area || p.area_id === area));
  const active = scope.filter((p) => p.status === "aktiv");
  const open = new Map(scope.filter(isOpenProject).map((p) => [p.id, p]));
  const month = today.slice(0, 7);
  let monthMilestones = 0;
  let monthDone = 0;
  let overdueMilestones = 0;
  const overdueProjects = new Set<string>();
  for (const m of milestones) {
    if (m.deleted_at || !open.has(m.project_id)) continue;
    if (m.due_date?.startsWith(month)) {
      monthMilestones += 1;
      if (m.done_at) monthDone += 1;
    }
    if (!m.done_at && m.due_date && m.due_date < today) {
      overdueMilestones += 1;
      overdueProjects.add(m.project_id);
    }
  }
  let taskDone = 0;
  let taskTotal = 0;
  for (const p of active) {
    const progress = projectProgress(p.id, tasks);
    taskDone += progress.done;
    taskTotal += progress.total;
  }
  return {
    active: active.length,
    monthMilestones,
    monthDone,
    overdueMilestones,
    overdueProjects: overdueProjects.size,
    taskDone,
    taskTotal,
    progress: taskTotal === 0 ? null : Math.round((taskDone / taskTotal) * 10_000) / 10_000,
  };
}

export interface NextStepCard {
  project: ProjectRow;
  /** nächster Schritt des Projekts (offen), sonst null */
  task: TaskRow | null;
  /** nächster offener Meilenstein: mit Fälligkeit zuerst, dann nach Reihenfolge */
  milestone: MilestoneRow | null;
}

/** Karten „Nächster Schritt“: aktive Projekte im Bereich, mit Ziel zuerst (frühestes oben). */
export function nextStepCards(
  projects: ProjectRow[],
  milestones: MilestoneRow[],
  tasks: TaskRow[],
  area: string | null,
): NextStepCard[] {
  const cards = projects
    .filter((p) => !p.deleted_at && p.status === "aktiv" && (!area || p.area_id === area))
    .map((project): NextStepCard => {
      const next = tasks.find((t) => t.id === project.next_task_id);
      const open = milestones
        .filter((m) => m.project_id === project.id && !m.deleted_at && !m.done_at)
        .sort((a, b) => {
          if (a.due_date && b.due_date)
            return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0;
        });
      return {
        project,
        task: next && !next.deleted_at && next.status !== "erledigt" ? next : null,
        milestone: open[0] ?? null,
      };
    });
  return cards.sort((a, b) => {
    const ka = a.project.target_date ?? "9999-12-31";
    const kb = b.project.target_date ?? "9999-12-31";
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.project.title.localeCompare(b.project.title, "de");
  });
}

export const isTimelineStatus = (status: ProjectStatus): status is TimelineStatus =>
  (TIMELINE_STATUSES as readonly string[]).includes(status);
