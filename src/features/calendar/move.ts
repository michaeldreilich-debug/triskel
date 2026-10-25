/**
 * Termine verschieben und verlängern (#64, N1b) – reine Zeitrechnung für Google-Termine, ohne
 * "use client": Ziehen im Raster (15 min), „Verschieben auf …“, Uhrzeit und Dauer im Termin-Fenster
 * und Rückgängig laufen alle über diese Funktionen. Die Zeiten stehen in der Form der Schnittstelle
 * (`EventTimes`): ganztägig als Kalendertage (Ende exklusiv), sonst als Zeitpunkte (ISO, UTC).
 * Wanduhrzeiten rechnen in Europe/Berlin; die Dauer bleibt beim Verschieben gleich (Zeitumstellung
 * inklusive: 10–11 Uhr bleibt eine Stunde).
 */
import {
  addDays,
  berlinDate,
  berlinDateTime,
  berlinTime,
  daysBetween,
  formatDue,
} from "@/lib/dates";
import { DAY_MS, eventSpan } from "./events";
import { minutesToTime } from "./layout";
import type { CalendarEvent } from "./types";

export interface EventTimes {
  allDay: boolean;
  /** ganztägig `JJJJ-MM-TT`, sonst ISO-Zeitpunkt */
  start: string;
  /** ganztägig `JJJJ-MM-TT` (exklusiv), sonst ISO-Zeitpunkt */
  end: string;
}

/** Kürzeste Dauer eines Termins im Raster (Minuten). */
export const MIN_EVENT_MIN = 15;
const MINUTE_MS = 60_000;

/** Zeiten des Termins in der Form der Schnittstelle. */
export function eventTimes(event: CalendarEvent): EventTimes {
  if (event.allDay) {
    return { allDay: true, start: event.date, end: addDays(event.endDate, 1) };
  }
  return { allDay: false, start: event.start, end: event.end };
}

export const sameTimes = (a: EventTimes, b: EventTimes) =>
  a.allDay === b.allDay && a.start === b.start && a.end === b.end;

const durationMs = (event: CalendarEvent) =>
  Math.max(0, Date.parse(event.end) - Date.parse(event.start));

const timed = (startIso: string, ms: number): EventTimes => ({
  allDay: false,
  start: startIso,
  end: new Date(Date.parse(startIso) + ms).toISOString(),
});

/**
 * Auf einen anderen Tag: ganztägig wandert um die Tage zwischen `fromDate` (der gegriffene Tag,
 * bei Terminen über mehrere Tage nicht unbedingt der erste) und `date`; mit Uhrzeit bleiben Uhrzeit
 * und Dauer.
 */
export function moveEventToDay(
  event: CalendarEvent,
  date: string,
  fromDate: string = event.date,
): EventTimes {
  const delta = daysBetween(fromDate, date);
  if (event.allDay) {
    return {
      allDay: true,
      start: addDays(event.date, delta),
      end: addDays(event.endDate, delta + 1),
    };
  }
  const start = berlinDateTime(addDays(event.date, delta), berlinTime(event.start));
  return timed(start, durationMs(event));
}

/** Auf eine Uhrzeit (Minuten seit Mitternacht): nur Termine mit Uhrzeit, Dauer bleibt. */
export function moveEventToSlot(
  event: CalendarEvent,
  date: string,
  minutes: number,
): EventTimes | null {
  if (event.allDay) return null;
  return timed(berlinDateTime(date, minutesToTime(minutes)), durationMs(event));
}

/** Ende am unteren Rand gezogen: neuer letzter Tag und Minute; mindestens 15 min nach dem Beginn. */
export function setEventEnd(
  event: CalendarEvent,
  endDate: string,
  endMinutes: number,
): EventTimes | null {
  if (event.allDay) return null;
  const end =
    endMinutes >= 24 * 60
      ? berlinDateTime(addDays(endDate, 1), "00:00")
      : berlinDateTime(endDate, minutesToTime(endMinutes));
  const earliest = Date.parse(event.start) + MIN_EVENT_MIN * MINUTE_MS;
  return {
    allDay: false,
    start: event.start,
    end: new Date(Math.max(Date.parse(end), earliest)).toISOString(),
  };
}

/** Neue Dauer in Minuten (Beginn bleibt); auf das Raster gerundet, mindestens 15 min. */
export function setEventDuration(event: CalendarEvent, minutes: number): EventTimes | null {
  if (event.allDay) return null;
  const value = Math.max(MIN_EVENT_MIN, Math.round(minutes / 15) * 15);
  return timed(event.start, value * MINUTE_MS);
}

/** Neue Uhrzeit („HH:mm“) und Dauer (Minuten) am selben Tag – Termin-Fenster, ein Aufruf. */
export function setEventSchedule(
  event: CalendarEvent,
  time: string,
  minutes: number,
): EventTimes | null {
  if (event.allDay) return null;
  const value = Math.max(MIN_EVENT_MIN, Math.round(minutes / 15) * 15);
  return timed(berlinDateTime(event.date, time), value * MINUTE_MS);
}

/** Neue Uhrzeit („HH:mm“) am selben Tag; Dauer bleibt. */
export function setEventStartTime(event: CalendarEvent, time: string): EventTimes | null {
  if (event.allDay) return null;
  return timed(berlinDateTime(event.date, time), durationMs(event));
}

/** Dauer des Termins in Minuten (ganztägig: null). */
export function eventDurationMin(event: CalendarEvent): number | null {
  return event.allDay ? null : Math.round(durationMs(event) / MINUTE_MS);
}

/** Termin mit neuen Zeiten (Tage, Minuten, Kennung neu berechnet) – für die sofortige Anzeige. */
export function applyEventTimes(event: CalendarEvent, times: EventTimes): CalendarEvent {
  let span: ReturnType<typeof eventSpan>;
  if (times.allDay) {
    const [y, m, d] = times.start.split("-").map(Number) as [number, number, number];
    span = eventSpan(
      true,
      Date.UTC(y, m - 1, d),
      Math.max(1, daysBetween(times.start, times.end)) * DAY_MS,
    );
  } else {
    const start = Date.parse(times.start);
    span = eventSpan(false, start, Math.max(0, Date.parse(times.end) - start));
  }
  return {
    ...event,
    id: `${event.sourceId}:${event.uid}:${span.start}`,
    allDay: times.allDay,
    start: span.start,
    end: span.end,
    date: span.date,
    endDate: span.endDate,
    startMinutes: span.startMinutes,
    endMinutes: span.endMinutes,
  };
}

/** Termine, die die App ändern darf: Google, `editable`, und – mit Uhrzeit – an einem Tag. */
export function isMovable(event: CalendarEvent): boolean {
  return event.google?.editable === true && (event.allDay || event.date === event.endDate);
}

/** Meldungstext für das Rückgängig-Toast: „„Titel“ → morgen, 14:00–15:00“. */
export function moveMessage(event: CalendarEvent, times: EventTimes, today: string): string {
  const title = event.title.length > 60 ? `${event.title.slice(0, 59)}…` : event.title;
  const day = times.allDay ? times.start : berlinDate(times.start);
  const label = formatDue(day, today);
  return times.allDay
    ? `„${title}“ → ${label}`
    : `„${title}“ → ${label}, ${berlinTime(times.start)}–${berlinTime(times.end)}`;
}
