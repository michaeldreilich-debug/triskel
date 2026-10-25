/**
 * Wiederholung (E12): Vorgaben → RRULE, nächster Termin, Anzeige.
 *
 * - Gespeichert wird die RRULE ohne DTSTART (Check in Migration 04: `^(RRULE:)?FREQ=`).
 *   Bezugstag (DTSTART) ist die Fälligkeit der Aufgabe.
 * - Die nächste Instanz entsteht beim Erledigen am ersten Termin der RRULE NACH
 *   max(Fälligkeit, heute). Gerechnet wird nur mit Kalendertagen (UTC-Mitternacht), die
 *   Zeitumstellung (z. B. 25.10.2026) verschiebt also nichts.
 */
import type { JSONContent } from "@tiptap/core";
import { RRule } from "rrule";
import {
  addDays,
  berlinDate,
  berlinDateTime,
  berlinTime,
  daysBetween,
  type IsoDate,
  isoWeekday,
} from "@/lib/dates";

export const RECURRENCE_PRESETS = [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
] as const;
export type RecurrencePreset = (typeof RECURRENCE_PRESETS)[number];

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const dayOf = (value: IsoDate) => Number(value.slice(8, 10));
const monthOf = (value: IsoDate) => Number(value.slice(5, 7));

/** Monatlich am Tag X; ab dem 29. „am X. bzw. am Monatsletzten“ (sonst fielen Monate aus). */
function monthlyRule(anchor: IsoDate): string {
  const day = dayOf(anchor);
  if (day <= 28) return `FREQ=MONTHLY;BYMONTHDAY=${day}`;
  const days = Array.from({ length: day - 27 }, (_, i) => 28 + i).join(",");
  return `FREQ=MONTHLY;BYMONTHDAY=${days};BYSETPOS=-1`;
}

/** Vorgabe → RRULE (null = keine Wiederholung). Bezugstag für Wochentag/Monatstag: anchor. */
export function presetToRule(preset: RecurrencePreset, anchor: IsoDate): string | null {
  const weekday = BYDAY[isoWeekday(anchor)];
  switch (preset) {
    case "none":
      return null;
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${weekday}`;
    case "biweekly":
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${weekday}`;
    case "monthly":
      return monthlyRule(anchor);
    case "yearly":
      return `FREQ=YEARLY;BYMONTH=${monthOf(anchor)};BYMONTHDAY=${dayOf(anchor)}`;
  }
}

const normalize = (rule: string) =>
  rule
    .replace(/^RRULE:/i, "")
    .trim()
    .toUpperCase();

/** Welche Vorgabe ist das? „custom“ für eigene RRULEs. */
export function detectPreset(rule: string | null | undefined): RecurrencePreset | "custom" {
  if (!rule) return "none";
  const r = normalize(rule);
  if (r === "FREQ=DAILY") return "daily";
  if (r === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return "weekdays";
  if (/^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/.test(r)) return "weekly";
  if (/^FREQ=WEEKLY;INTERVAL=2;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/.test(r)) return "biweekly";
  if (/^FREQ=MONTHLY;BYMONTHDAY=\d{1,2}(,\d{1,2})*(;BYSETPOS=-1)?$/.test(r)) return "monthly";
  if (/^FREQ=YEARLY;BYMONTH=\d{1,2};BYMONTHDAY=\d{1,2}$/.test(r)) return "yearly";
  return "custom";
}

/** Anzeige, z. B. „Wöchentlich (So)“, „Monatlich (am 12.)“. */
export function recurrenceLabel(rule: string | null | undefined): string {
  const preset = detectPreset(rule);
  const r = normalize(rule ?? "");
  const weekday = () => {
    const code = /BYDAY=([A-Z]{2})$/.exec(r)?.[1];
    const index = BYDAY.indexOf(code as (typeof BYDAY)[number]);
    return index >= 0 ? WEEKDAY_LABELS[index] : "";
  };
  switch (preset) {
    case "none":
      return "Keine";
    case "daily":
      return "Täglich";
    case "weekdays":
      return "Werktags (Mo–Fr)";
    case "weekly":
      return `Wöchentlich (${weekday()})`;
    case "biweekly":
      return `Alle 2 Wochen (${weekday()})`;
    case "monthly": {
      const days = /BYMONTHDAY=([\d,]+)/.exec(r)?.[1]?.split(",") ?? [];
      const last = days.at(-1);
      return days.length > 1
        ? `Monatlich (am ${last}. oder Monatsletzten)`
        : `Monatlich (am ${last}.)`;
    }
    case "yearly": {
      const month = /BYMONTH=(\d+)/.exec(r)?.[1] ?? "";
      const day = /BYMONTHDAY=(\d+)/.exec(r)?.[1] ?? "";
      return `Jährlich (${day.padStart(2, "0")}.${month.padStart(2, "0")}.)`;
    }
    case "custom":
      return "Eigene Regel";
  }
}

export const PRESET_LABELS: Record<RecurrencePreset, string> = {
  none: "Keine",
  daily: "Täglich",
  weekdays: "Werktags (Mo–Fr)",
  weekly: "Wöchentlich",
  biweekly: "Alle 2 Wochen",
  monthly: "Monatlich",
  yearly: "Jährlich",
};

/** Vorgaben, die vom Bezugstag abhängen (bei geänderter Fälligkeit neu ausrichten). */
const ANCHORED: RecurrencePreset[] = ["weekly", "biweekly", "monthly", "yearly"];

/** Fälligkeit geändert → Wochentag/Monatstag der Vorgabe mitziehen; eigene Regeln bleiben. */
export function reanchorRule(rule: string | null, due: IsoDate | null): string | null {
  if (!rule || !due) return rule;
  const preset = detectPreset(rule);
  if (preset === "custom" || !ANCHORED.includes(preset)) return rule;
  return presetToRule(preset, due);
}

const toUtc = (value: IsoDate) => {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

/**
 * Nächster Termin: erster Termin der RRULE nach max(Fälligkeit, heute) (E12).
 * Bezugstag (DTSTART) ist die Fälligkeit, ohne Fälligkeit heute. null bei ungültiger Regel.
 */
export function nextDueDate(
  rule: string | null | undefined,
  due: IsoDate | null,
  today: IsoDate,
): IsoDate | null {
  if (!rule) return null;
  try {
    const options = RRule.parseString(normalize(rule));
    const anchor = due ?? today;
    const after = due && due > today ? due : today;
    const next = new RRule({ ...options, dtstart: toUtc(anchor), tzid: null }).after(
      toUtc(after),
      false,
    );
    return next ? next.toISOString().slice(0, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Künftige Termine einer Wiederholung im Zeitraum (Kalender, S2b): alle Termine der RRULE nach der
 * Fälligkeit bis `end` (Kalendertage, inklusive), höchstens `limit`. Die Fälligkeit selbst zählt
 * nicht – sie ist die echte Aufgabe, die Termine danach sind nur vorausberechnet.
 */
export function upcomingOccurrences(
  rule: string | null | undefined,
  due: IsoDate | null,
  start: IsoDate,
  end: IsoDate,
  limit = 12,
): IsoDate[] {
  if (!rule || !due || end < start) return [];
  try {
    const options = RRule.parseString(normalize(rule));
    const from = start > due ? start : addDays(due, 1);
    if (from > end) return [];
    const out: IsoDate[] = [];
    new RRule({ ...options, dtstart: toUtc(due), tzid: null }).between(
      toUtc(from),
      toUtc(end),
      true,
      (date, i) => {
        out.push(date.toISOString().slice(0, 10));
        return i < limit - 1;
      },
    );
    return out.filter((d) => d > due);
  } catch {
    return [];
  }
}

/**
 * „Geplant für“ der Folgeinstanz: gleiche Uhrzeit in Europe/Berlin, um die Differenz der
 * Fälligkeiten verschoben (wie complete_task in Migration 07).
 */
export function shiftScheduledAt(
  scheduledAt: string | null,
  oldDue: IsoDate | null,
  newDue: IsoDate,
): string | null {
  if (!scheduledAt || !oldDue) return null;
  const date = addDays(berlinDate(scheduledAt), daysBetween(oldDue, newDue));
  return berlinDateTime(date, berlinTime(scheduledAt));
}

/** Checklisten-Punkte der Folgeinstanz starten unerledigt (wie complete_task). */
export function uncheckBody(body: JSONContent | null): JSONContent | null {
  if (!body) return null;
  const walk = (node: JSONContent): JSONContent => ({
    ...node,
    ...(node.attrs && node.attrs.checked === true
      ? { attrs: { ...node.attrs, checked: false } }
      : {}),
    ...(node.content ? { content: node.content.map(walk) } : {}),
  });
  return walk(body);
}
