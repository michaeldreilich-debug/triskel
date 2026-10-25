import { format, isValid, parse } from "date-fns";
import { de } from "date-fns/locale";

/** Kalendertag als „YYYY-MM-DD“ (Postgres `date`) – ohne Zeitzonen-Verschiebung. */
export type IsoDate = string;

export function parseIsoDate(value: IsoDate | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parse(value, "yyyy-MM-dd", new Date(2000, 0, 1));
  return isValid(date) ? date : null;
}

export function toIsoDate(date: Date): IsoDate {
  return format(date, "yyyy-MM-dd");
}

/** 18.10.2026 */
export function formatDateShort(value: IsoDate | null | undefined): string {
  const date = parseIsoDate(value);
  return date ? format(date, "dd.MM.yyyy") : "";
}

/** Samstag, 10. Oktober 2026 */
export function formatDateLong(date: Date): string {
  return format(date, "EEEE, d. MMMM yyyy", { locale: de });
}

/** Kurzes Datum für Listen: „02.10.“ im laufenden Jahr, sonst „02.10.25“ (Europe/Berlin). */
export function formatListDate(timestamp: string | null | undefined, now = new Date()): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const sameYear =
    new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(
      date,
    ) ===
    new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(now);
  return sameYear
    ? `${get("day")}.${get("month")}.`
    : `${get("day")}.${get("month")}.${get("year")}`;
}

/* ------------------------------------------------------------------ */
/* Europe/Berlin: „heute“, Uhrzeiten, Kalenderrechnung (E5)            */
/* ------------------------------------------------------------------ */

export const APP_TIME_ZONE = "Europe/Berlin";

const berlinParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(date: Date) {
  const parts = berlinParts.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** Kalendertag in Europe/Berlin (unabhängig von der Zeitzone des Geräts). */
export function berlinDate(at: Date | string = new Date()): IsoDate {
  return partsOf(typeof at === "string" ? new Date(at) : at).date;
}

/** Minuten seit Mitternacht in Europe/Berlin. */
export function berlinMinutes(at: Date = new Date()): number {
  const { hour, minute } = partsOf(at);
  return hour * 60 + minute;
}

/** Uhrzeit „HH:mm“ eines Zeitpunkts in Europe/Berlin. */
export function berlinTime(at: Date | string): string {
  const { hour, minute } = partsOf(typeof at === "string" ? new Date(at) : at);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** „HH:mm“ bzw. „HH:mm:ss“ (Postgres time) → Minuten seit Mitternacht. */
export function timeToMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/** Kalendertage addieren – reine Datumsrechnung, die Zeitumstellung spielt keine Rolle. */
export function addDays(value: IsoDate, days: number): IsoDate {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Abstand in Kalendertagen (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const toUtc = (v: IsoDate) => {
    const [y, m, d] = v.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Wochentag 0 = Montag … 6 = Sonntag (ISO). */
export function isoWeekday(value: IsoDate): number {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Montag und Sonntag der ISO-Woche (E15: Woche Mo–So). */
export function isoWeekRange(value: IsoDate): { start: IsoDate; end: IsoDate } {
  const start = addDays(value, -isoWeekday(value));
  return { start, end: addDays(start, 6) };
}

/** Erster Tag des Monats eines Datums. */
export const startOfMonth = (date: IsoDate): IsoDate => `${date.slice(0, 7)}-01`;

/** Letzter Tag des Monats eines Datums. */
export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Erster und letzter Tag des Monats (Monatsrückblick, S1a). */
export const monthRange = (date: IsoDate) => ({ start: startOfMonth(date), end: endOfMonth(date) });

const MONTHS_LONG = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** „Oktober 2026“, mit `year: false` nur „Oktober“. */
export function formatMonth(date: IsoDate, { year = true } = {}): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const name = MONTHS_LONG[m - 1] ?? "";
  return year ? `${name} ${y}` : name;
}

/**
 * Wanduhrzeit in Europe/Berlin → Zeitpunkt (ISO, UTC). Zweideutige Zeiten bei der Umstellung
 * (z. B. 02:30 am 25.10.) nimmt die erste, nicht existierende (29.03., 02:30) die spätere.
 */
export function berlinDateTime(date: IsoDate, time: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const minutes = timeToMinutes(time) ?? 0;
  // Wanduhrzeit als UTC, dann mit den Berliner Versätzen vor und nach dem Tag korrigieren
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const offsetAt = (ms: number) => {
    const p = partsOf(new Date(ms));
    const [py, pm, pd] = p.date.split("-").map(Number) as [number, number, number];
    return Date.UTC(py, pm - 1, pd, p.hour, p.minute) - ms;
  };
  const candidates = [...new Set([offsetAt(wall - 86_400_000), offsetAt(wall + 86_400_000)])].map(
    (offset) => wall - offset,
  );
  const matching = candidates.filter((ms) => {
    const p = partsOf(new Date(ms));
    return p.date === date && p.hour * 60 + p.minute === minutes;
  });
  const chosen = matching.length > 0 ? Math.min(...matching) : Math.max(...candidates);
  return new Date(chosen).toISOString();
}

const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * Fälligkeit relativ zu heute: „heute“, „morgen“, „gestern“, sonst Wochentag und Datum
 * („Mi 14.10.“, anderes Jahr „Di 05.01.27“). Muster 4 (#23): Der Wochentag hilft beim Einordnen.
 */
export function formatDue(value: IsoDate | null | undefined, today: IsoDate): string {
  if (!value) return "";
  const diff = daysBetween(today, value);
  if (diff === 0) return "heute";
  if (diff === 1) return "morgen";
  if (diff === -1) return "gestern";
  const [y, m, d] = value.split("-");
  const date = y === today.slice(0, 4) ? `${d}.${m}.` : `${d}.${m}.${y?.slice(2)}`;
  return `${WEEKDAYS_SHORT[isoWeekday(value)]} ${date}`;
}

export type DueTone = "over" | "today" | "soon" | "later";

/** Dringlichkeit einer Fälligkeit (Muster 4): überfällig, heute, morgen, später. */
export function dueTone(value: IsoDate | null | undefined, today: IsoDate): DueTone | null {
  if (!value) return null;
  if (value < today) return "over";
  if (value === today) return "today";
  return daysBetween(today, value) === 1 ? "soon" : "later";
}

/** „Mo, 12.10.“ */
export function formatDayShort(value: IsoDate): string {
  const [, m, d] = value.split("-");
  return `${WEEKDAYS_SHORT[isoWeekday(value)]}, ${d}.${m}.`;
}

/**
 * „Zuletzt geändert …“ (#41): „heute um 14:32“, „gestern um 09:10“, „am Mi, 14.10. um 17:05“,
 * aus früheren Jahren „am 02.10.2025“ (Europe/Berlin).
 */
export function formatEdited(timestamp: string | null | undefined, now = new Date()): string {
  if (!timestamp) return "";
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return "";
  const day = berlinDate(at);
  const today = berlinDate(now);
  const time = berlinTime(at);
  if (day === today) return `heute um ${time}`;
  if (day === addDays(today, -1)) return `gestern um ${time}`;
  if (day.slice(0, 4) === today.slice(0, 4)) return `am ${formatDayShort(day)} um ${time}`;
  const [y, m, d] = day.split("-");
  return `am ${d}.${m}.${y}`;
}

/** ISO-Kalenderwoche (1–53): Die Woche mit dem ersten Donnerstag des Jahres ist KW 1. */
export function isoWeekNumber(value: IsoDate): number {
  const thursday = addDays(value, 3 - isoWeekday(value));
  const [y] = thursday.split("-").map(Number) as [number];
  return Math.floor(daysBetween(`${y}-01-01`, thursday) / 7) + 1;
}

/** Jahr der ISO-Kalenderwoche (29.12.2025 gehört zu KW 1/2026). */
export function isoWeekYear(value: IsoDate): number {
  return Number(addDays(value, 3 - isoWeekday(value)).slice(0, 4));
}

/** Monate addieren; gibt es den Tag im Zielmonat nicht (31.03. − 1 Monat), dann der Monatsletzte. */
export function addMonths(value: IsoDate, months: number): IsoDate {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Zeitraum kurz: „12.–18.10.2026“, „28.09.–04.10.2026“, „29.12.2025–04.01.2026“. */
export function formatRange(start: IsoDate, end: IsoDate): string {
  const [sy, sm, sd] = start.split("-");
  const [ey, em, ed] = end.split("-");
  if (sy !== ey) return `${sd}.${sm}.${sy}–${ed}.${em}.${ey}`;
  if (sm !== em) return `${sd}.${sm}.–${ed}.${em}.${ey}`;
  return `${sd}.–${ed}.${em}.${ey}`;
}
