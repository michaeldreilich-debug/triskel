/**
 * Zeiteingaben der Termin-Werkzeuge (#64, N1d) in die Form der Google-Schnittstelle bringen –
 * rein, ohne Server-Abhängigkeiten. Wanduhrzeiten sind immer Europe/Berlin; ein Termin behält
 * seine eigene Zone (nur der Zeitpunkt wird gesetzt).
 */
import { DEFAULT_TIME_ZONE } from "@/features/calendar/google/event-input";
import type { PatchTimes } from "@/features/calendar/google/events-api";
import { type ParseResult, parseTimes } from "@/features/calendar/google/patch-input";
import { type EventTimes, sameTimes } from "@/features/calendar/move";
import { addDays, berlinDate, berlinDateTime, daysBetween, timeToMinutes } from "@/lib/dates";

export const DEFAULT_DURATION_MIN = 60;
const MINUTE_MS = 60_000;

export interface TimeInput {
  /** „JJJJ-MM-TT HH:MM“ (Berlin); ganztägig reicht „JJJJ-MM-TT“ */
  beginn?: string;
  dauer_min?: number;
  dauer_tage?: number;
  ganztaegig?: boolean;
}

/** Datum und Uhrzeit aus „JJJJ-MM-TT“ bzw. „JJJJ-MM-TT HH:MM“ (auch mit „T“). */
export function splitBeginn(value: string): { date: string; time: string | null } | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const time = match[2] ?? null;
  if (time && timeToMinutes(time) === null) return null;
  return { date: match[1] as string, time };
}

const bad = (error: string): ParseResult<never> => ({ ok: false, error });

export interface ResolvedTimes {
  /** Zeiten für Google; null = nichts zu ändern */
  patch: PatchTimes | null;
  /** Zeiten in der Form der App (für Protokoll und Vergleich) */
  times: EventTimes | null;
}

/**
 * Neue Zeiten aus der Eingabe. `current` = Stand des Termins (Ändern) oder null (Anlegen: dann
 * ist `beginn` Pflicht). Ohne zeitbezogene Eingabe: nichts ändern.
 */
export function resolveTimes(
  input: TimeInput,
  current: EventTimes | null,
  timeZone: string | null,
): ParseResult<ResolvedTimes> {
  const given =
    input.beginn !== undefined ||
    input.dauer_min !== undefined ||
    input.dauer_tage !== undefined ||
    input.ganztaegig !== undefined;
  if (!given) return { ok: true, value: { patch: null, times: null } };

  const allDay = input.ganztaegig ?? current?.allDay ?? false;
  const beginn = input.beginn === undefined ? null : splitBeginn(input.beginn);
  if (input.beginn !== undefined && !beginn) {
    return bad("beginn muss „JJJJ-MM-TT HH:MM“ (Berlin) sein, ganztägig „JJJJ-MM-TT“.");
  }
  if (!current && !beginn) return bad("beginn fehlt („JJJJ-MM-TT HH:MM“, Berlin).");

  let start: string;
  let end: string;
  if (allDay) {
    if (input.dauer_min !== undefined && input.dauer_tage === undefined) {
      return bad("Ganztägige Termine haben keine Dauer in Minuten – dauer_tage nutzen.");
    }
    const day =
      beginn?.date ??
      (current?.allDay ? current.start : berlinDate(new Date((current as EventTimes).start)));
    const days =
      input.dauer_tage ??
      (current?.allDay ? Math.max(1, daysBetween(current.start, current.end)) : 1);
    start = day;
    end = addDays(day, days);
  } else {
    if (input.dauer_tage !== undefined) {
      return bad("dauer_tage gilt nur für ganztägige Termine – dauer_min nutzen.");
    }
    if (beginn && !beginn.time) {
      return bad("beginn braucht eine Uhrzeit („JJJJ-MM-TT HH:MM“), außer bei ganztaegig.");
    }
    if (!beginn && current?.allDay) {
      return bad("Für einen Termin mit Uhrzeit fehlt beginn („JJJJ-MM-TT HH:MM“).");
    }
    start = beginn
      ? berlinDateTime(beginn.date, beginn.time as string)
      : new Date(Date.parse((current as EventTimes).start)).toISOString();
    const minutes =
      input.dauer_min ??
      (current && !current.allDay
        ? Math.max(1, Math.round((Date.parse(current.end) - Date.parse(current.start)) / MINUTE_MS))
        : DEFAULT_DURATION_MIN);
    end = new Date(Date.parse(start) + minutes * MINUTE_MS).toISOString();
  }
  const parsed = parseTimes(allDay, start, end, timeZone ?? DEFAULT_TIME_ZONE);
  if (!parsed.ok) return parsed;
  const times: EventTimes = { allDay, start, end };
  // unverändert (gleiche Zeitpunkte) → nichts zu tun
  if (current && sameInstants(current, times))
    return { ok: true, value: { patch: null, times: null } };
  return { ok: true, value: { patch: parsed.value, times } };
}

function sameInstants(a: EventTimes, b: EventTimes): boolean {
  if (a.allDay !== b.allDay) return false;
  if (a.allDay) return sameTimes(a, b);
  return Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);
}
