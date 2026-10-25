/**
 * Tagesraster (S2b): überlappende Einträge nebeneinander, freie Fenster, sichtbarer
 * Stundenbereich. Reine Funktionen für Woche und Tag (und den Tagesablauf auf Heute, S2c).
 */
import { FREE_WINDOW_MIN, type TimedEntry, WORKDAY } from "./model";

export interface PlacedEntry<T extends { from: number; to: number } = TimedEntry> {
  entry: T;
  /** Spalte innerhalb der Überlappungsgruppe (0-basiert) und Spaltenzahl der Gruppe */
  column: number;
  columns: number;
}

/** Höhe eines Eintrags im Raster mindestens so viele Minuten (Lesbarkeit) */
export const MIN_VISUAL_MIN = 30;

/**
 * Überlappende Einträge bekommen eigene Spalten (Intervallgraph-Färbung): Gruppen zusammenhängender
 * Überlappungen teilen sich die Breite. Dauer 0 zählt wie MIN_VISUAL_MIN.
 */
export function placeEntries<T extends { from: number; to: number }>(
  entries: T[],
): PlacedEntry<T>[] {
  const sorted = [...entries].sort((a, b) => a.from - b.from || b.to - a.to);
  const out: PlacedEntry<T>[] = [];
  let group: Array<{ entry: T; column: number; end: number }> = [];
  let groupEnd = -1;
  const flush = () => {
    const columns = group.reduce((max, g) => Math.max(max, g.column + 1), 0);
    for (const g of group) out.push({ entry: g.entry, column: g.column, columns });
    group = [];
  };
  for (const entry of sorted) {
    const end = Math.max(entry.to, entry.from + MIN_VISUAL_MIN);
    if (group.length > 0 && entry.from >= groupEnd) flush();
    // erste Spalte, deren letzter Eintrag schon zu Ende ist
    const columnEnds: number[] = [];
    for (const g of group) columnEnds[g.column] = Math.max(columnEnds[g.column] ?? 0, g.end);
    let column = columnEnds.findIndex((e) => e <= entry.from);
    if (column === -1) column = columnEnds.length;
    group.push({ entry, column, end });
    groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return out;
}

export interface FreeWindow {
  from: number;
  to: number;
}

/**
 * Freie Fenster im Arbeitstag (8–18 Uhr): Lücken von mindestens FREE_WINDOW_MIN Minuten zwischen
 * den Einträgen. Ein leerer Tag ergibt ein Fenster über den ganzen Arbeitstag.
 */
export function freeWindows(
  entries: Array<{ from: number; to: number }>,
  workday = WORKDAY,
  minLength = FREE_WINDOW_MIN,
): FreeWindow[] {
  const spans = entries
    .map((e) => ({ from: Math.max(workday.from, e.from), to: Math.min(workday.to, e.to) }))
    .filter((e) => e.to > e.from)
    .sort((a, b) => a.from - b.from);
  const out: FreeWindow[] = [];
  let cursor = workday.from;
  for (const span of spans) {
    if (span.from - cursor >= minLength) out.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (workday.to - cursor >= minLength) out.push({ from: cursor, to: workday.to });
  return out;
}

/** Sichtbare Stunden: mindestens `from`–`to`, erweitert um frühere/spätere Einträge (volle Stunden). */
export function visibleHours(
  entries: Array<{ from: number; to: number }>,
  base = { from: 7, to: 20 },
): { from: number; to: number } {
  let from = base.from;
  let to = base.to;
  for (const e of entries) {
    from = Math.min(from, Math.floor(e.from / 60));
    to = Math.max(to, Math.ceil(Math.max(e.to, e.from + MIN_VISUAL_MIN) / 60));
  }
  return { from: Math.max(0, from), to: Math.min(24, to) };
}

/** „09:30“ aus Minuten seit Mitternacht (1440 = 24:00). */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** „1 h 30 min“, „45 min“, „2 h“ */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/**
 * Aufgaben je Tag im Band über dem Wochenraster (#97, Rückmeldung: „abhängig von der Fensterhöhe, aber
 * mindestens 3“): bis 800 px Fensterhöhe 3 – so bleibt die Woche bei 1440×800 ohne Seiten-Scrollen
 * erfassbar –, darüber je drei Zeilenhöhen eine Aufgabe mehr; den Rest bekommt das Raster.
 */
export const WEEK_TASK_BAND = { min: 3, baseHeight: 800 };

export function weekTaskLimit(windowHeight: number, rowHeight: number): number {
  const extra = Math.max(0, windowHeight - WEEK_TASK_BAND.baseHeight);
  return WEEK_TASK_BAND.min + Math.floor(extra / (3 * Math.max(1, rowHeight)));
}

/** Minuten auf das Raster runden (z. B. 15) und in 0–1440 halten. */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.min(24 * 60 - step, Math.max(0, Math.round(minutes / step) * step));
}
