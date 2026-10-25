"use client";

/**
 * Kalender im Client (S2b):
 * - `useCalendarPrefs`: Ansicht, Filter und Einplanen-Spalte je Gerät (localStorage).
 * - `useCalendarData`: Termine (Server), Aufgaben, Projekte, Meilensteine, Rückblicke → Tage über
 *   das Modell (`buildCalendarDays`) – eine Quelle für alle Ansichten, Heute und die
 *   Datenbank-Ansicht (S2c).
 * - `useCalendarMove`: Aufgaben auf Tag/Uhrzeit verschieben, Datum entfernen, Dauer ändern – immer
 *   mit „Rückgängig“ (auch ⌘Z).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyWithUndo } from "@/components/ui/toast";
import { useRecaps } from "@/features/recaps/api";
import { useTaskActions } from "@/features/tasks/api";
import type { TaskContext } from "@/features/tasks/components/task-item";
import { useTaskData } from "@/features/tasks/hooks";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import {
  berlinDate,
  berlinDateTime,
  berlinTime,
  formatDue,
  type IsoDate,
  isoWeekday,
} from "@/lib/dates";
import { useLocalFlag } from "@/lib/local-pref";
import { useUi } from "@/lib/ui-store";
import { useCalendarEventMonths, useCalendarEvents, useCalendarSourcesActive } from "./api";
import { minutesToTime } from "./layout";
import {
  buildCalendarDays,
  type CalendarDay,
  type CalendarFilters,
  type CalendarView,
  DEFAULT_FILTERS,
  eventsWanted,
  monthOf,
  monthsOfRange,
  parseCalendarView,
} from "./model";
import type { CalendarRange, CalendarSourceStatus } from "./types";

const VIEW_KEY = "sz:kalender-ansicht";
const FILTER_KEY = "sz:kalender-filter";
const PLAN_KEY = "sz:kalender-einplanen";

function readFilters(): CalendarFilters {
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<CalendarFilters>;
    return {
      events: parsed.events !== false,
      tasks: parsed.tasks !== false,
      done: parsed.done !== false,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** Ansicht, Filter, Einplanen-Spalte – je Gerät gemerkt, erst nach dem Einhängen gelesen. */
export function useCalendarPrefs(initialView: CalendarView | null) {
  const [view, setViewState] = useState<CalendarView>(initialView ?? "woche");
  const [filters, setFiltersState] = useState<CalendarFilters>(DEFAULT_FILTERS);
  const [planOpen, setPlanOpen] = useLocalFlag(PLAN_KEY, true);
  useEffect(() => {
    try {
      const stored = parseCalendarView(window.localStorage.getItem(VIEW_KEY));
      if (!initialView && stored) setViewState(stored);
    } catch {
      // kein Speicher
    }
    setFiltersState(readFilters());
  }, [initialView]);
  const setView = useCallback((next: CalendarView) => {
    setViewState(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // nur Bequemlichkeit
    }
  }, []);
  const setFilters = useCallback((patch: Partial<CalendarFilters>) => {
    setFiltersState((old) => {
      const next = { ...old, ...patch };
      try {
        window.localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      } catch {
        // nur Bequemlichkeit
      }
      return next;
    });
  }, []);
  return { view, setView, filters, setFilters, planOpen, setPlanOpen };
}

export interface CalendarData {
  days: CalendarDay[];
  hiddenByArea: number;
  /** Tage der ausgeblendeten Aufgaben (der Monat zum Durchscrollen zählt nur die sichtbaren) */
  hiddenDates: IsoDate[];
  ctx: TaskContext;
  tasks: TaskRow[];
  today: IsoDate;
  /** gewählter Bereich (nur, wenn es ihn gibt) */
  area: string | null;
  sources: CalendarSourceStatus[];
  /** Fehler beim Laden der Termine (Aufgaben sind trotzdem da) */
  eventsError: string | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

/**
 * Alle Tage eines Zeitraums mit Terminen, Aufgaben, Fristen – fertig fürs Rendern. Mit
 * `focusMonth` (Monat zum Durchscrollen, #85) kommen die Termine monatsweise, geladen nur für
 * diesen Monat und seine Nachbarn – der Zeitraum ist dann ein ganzes Fenster aus Monaten.
 */
export function useCalendarData(
  range: CalendarRange,
  filters: CalendarFilters,
  today: IsoDate,
  focusMonth: IsoDate | null = null,
): CalendarData {
  const area = useUi((s) => s.area);
  const data = useTaskData({ forMe: true });
  const recaps = useRecaps();
  // nur id + an/aus (K-1): die geheime Adresse bleibt den Einstellungen vorbehalten
  const sources = useCalendarSourcesActive();
  const hasSources = (sources.data ?? []).some((s) => s.enabled);
  // erst mit bekanntem heutigen Tag (K-2) – sonst ginge ein Abruf um 2000-01-01 raus
  const wanted = eventsWanted({ today, hasSources, filters });
  const single = useCalendarEvents(range, { enabled: wanted && !focusMonth });
  const months = useMemo(() => (focusMonth ? monthsOfRange(range) : []), [focusMonth, range]);
  const active = useMemo(
    () => (focusMonth ? [-1, 0, 1].map((by) => monthOf(focusMonth, by)) : []),
    [focusMonth],
  );
  const monthly = useCalendarEventMonths(months, active, { enabled: wanted && !!focusMonth });
  const events = focusMonth ? monthly : single;
  const activeArea = area && data.ctx.areas.some((a) => a.id === area) ? area : null;
  const eventList = events.data?.events;
  const recapList = recaps.data;
  const result = useMemo(
    () =>
      buildCalendarDays({
        range,
        today,
        events: wanted ? (eventList ?? []) : [],
        tasks: data.tasks,
        projects: data.ctx.projects,
        milestones: data.ctx.milestones,
        recaps: recapList ?? [],
        area: activeArea,
        filters,
      }),
    [
      range,
      today,
      wanted,
      filters,
      eventList,
      data.tasks,
      data.ctx.projects,
      data.ctx.milestones,
      recapList,
      activeArea,
    ],
  );
  const ctx = useMemo(() => ({ ...data.ctx, today }), [data.ctx, today]);
  return {
    days: result.days,
    hiddenByArea: result.hiddenByArea,
    hiddenDates: result.hiddenDates,
    ctx,
    tasks: data.tasks,
    today,
    area: activeArea,
    sources: events.data?.sources ?? [],
    eventsError: events.isError && !events.data ? "Termine ließen sich nicht laden." : null,
    loading: data.loading || recaps.isPending || sources.isPending,
    error: data.error,
    retry: () => {
      data.retry();
      void recaps.refetch();
      void events.refetch();
    },
  };
}

type Snapshot = Pick<TaskRow, "due_date" | "scheduled_at" | "focus_date" | "duration_min">;
const snapshot = (task: TaskRow): Snapshot => ({
  due_date: task.due_date,
  scheduled_at: task.scheduled_at,
  focus_date: task.focus_date,
  duration_min: task.duration_min,
});

/** Verschieben-Ziele für Menüs: heute, morgen, nächster Montag, in einer Woche. */
export function moveTargets(today: IsoDate): Array<{ id: string; label: string; date: IsoDate }> {
  const add = (days: number) => {
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  const nextMonday = add(7 - isoWeekday(today));
  return [
    { id: "heute", label: "Heute", date: today },
    { id: "morgen", label: "Morgen", date: add(1) },
    { id: "montag", label: `Nächster Montag (${formatDue(nextMonday, today)})`, date: nextMonday },
    { id: "woche", label: `In einer Woche (${formatDue(add(7), today)})`, date: add(7) },
  ];
}

/** Verschieben mit Rückgängig (Leitlinie: Ziehen = Fälligkeit bzw. Zeitblock, immer mit ⌘Z). */
export function useCalendarMove() {
  const actions = useTaskActions();
  const today = berlinDate();

  const apply = useCallback(
    (task: TaskRow, patch: Partial<Snapshot>, message: string) => {
      const before = snapshot(task);
      const changed = (Object.keys(patch) as Array<keyof Snapshot>).some(
        (key) => patch[key] !== before[key],
      );
      if (!changed) return;
      actions.update(task.id, patch);
      notifyWithUndo(message, () => actions.update(task.id, before));
    },
    [actions],
  );

  /** Auf einen Tag ziehen: Fälligkeit; ein Zeitblock wandert mit (gleiche Uhrzeit). */
  const moveToDay = useCallback(
    (task: TaskRow, date: IsoDate) => {
      const patch: Partial<Snapshot> = { due_date: date };
      if (task.scheduled_at)
        patch.scheduled_at = berlinDateTime(date, berlinTime(task.scheduled_at));
      if (task.focus_date && task.focus_date !== date) patch.focus_date = null;
      apply(task, patch, `„${taskTitle(task)}“ → ${formatDue(date, today)}`);
    },
    [apply, today],
  );

  /** Auf eine Uhrzeit ziehen: Zeitblock; eine frühere Fälligkeit rückt nach. */
  const moveToSlot = useCallback(
    (task: TaskRow, date: IsoDate, minutes: number) => {
      const time = minutesToTime(minutes);
      const patch: Partial<Snapshot> = { scheduled_at: berlinDateTime(date, time) };
      if (task.due_date && task.due_date < date) patch.due_date = date;
      if (task.focus_date && task.focus_date !== date) patch.focus_date = null;
      apply(task, patch, `„${taskTitle(task)}“ → ${formatDue(date, today)}, ${time}`);
    },
    [apply, today],
  );

  /** Zurück in die Einplanen-Spalte: ohne Datum. */
  const unschedule = useCallback(
    (task: TaskRow) => {
      apply(
        task,
        { due_date: null, scheduled_at: null, focus_date: null },
        `„${taskTitle(task)}“ ohne Datum`,
      );
    },
    [apply],
  );

  /** Uhrzeit entfernen, Tag bleibt (Zeitblock → Aufgabe des Tages). */
  const clearTime = useCallback(
    (task: TaskRow) => {
      if (!task.scheduled_at) return;
      const date = berlinDate(task.scheduled_at);
      apply(
        task,
        { scheduled_at: null, due_date: task.due_date ?? date },
        `„${taskTitle(task)}“ ohne Uhrzeit`,
      );
    },
    [apply],
  );

  /** Dauer am Rand gezogen (Minuten). */
  const setDuration = useCallback(
    (task: TaskRow, minutes: number) => {
      const value = Math.max(15, Math.round(minutes / 15) * 15);
      apply(task, { duration_min: value }, `„${taskTitle(task)}“: ${value} min`);
    },
    [apply],
  );

  return useMemo(
    () => ({ moveToDay, moveToSlot, unschedule, clearTime, setDuration }),
    [moveToDay, moveToSlot, unschedule, clearTime, setDuration],
  );
}

export type CalendarMove = ReturnType<typeof useCalendarMove>;
