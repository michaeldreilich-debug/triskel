/**
 * Termine aus einer gelesenen ICS für einen Zeitraum ausrollen und auf Europe/Berlin
 * normalisieren (S2a) – reine Funktionen, die Server-Route ruft sie, Tests füttern eine ICS.
 *
 * Wiederholungen: rrule rechnet „in UTC“. Deshalb geht die Wanduhrzeit des Termins (in seiner
 * TZID) als falsche UTC hinein und jede Instanz als Wanduhrzeit wieder heraus; erst dann wird sie
 * mit @date-fns/tz zum echten Zeitpunkt. So bleibt ein wöchentlicher 10-Uhr-Termin auch über die
 * Zeitumstellung (25.10.2026) um 10 Uhr. Ganztägige Termine rechnen nur mit Kalendertagen.
 */
import { TZDate } from "@date-fns/tz";
import { RRule } from "rrule";
import { APP_TIME_ZONE, addDays, berlinDate, berlinMinutes, type IsoDate } from "@/lib/dates";
import type { IcsCalendar, IcsEvent, IcsTime } from "./ics";
import type { CalendarColor, CalendarDaySegment, CalendarEvent, CalendarRange } from "./types";

export interface ExpandSource {
  id: string;
  name: string;
  color: CalendarColor;
  /** Kalender-ID (die E-Mail aus der iCal-Adresse) für Links nach Google; null = keine Links */
  calendarId: string | null;
}

export const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 24 * 60;
/** Höchstens so viele Instanzen je Wiederholung und Abfrage (Schutz vor FREQ=MINUTELY o. Ä.) */
export const MAX_OCCURRENCES = 2000;
/** Beschreibungen kürzen (Google hängt oft lange HTML-Texte an) */
const MAX_DESCRIPTION = 2000;
const MAX_TITLE = 300;

const zoneCache = new Map<string, boolean>();

export function isValidTimeZone(tz: string): boolean {
  const known = zoneCache.get(tz);
  if (known !== undefined) return known;
  let valid = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    valid = true;
  } catch {
    valid = false;
  }
  zoneCache.set(tz, valid);
  return valid;
}

type WallTime = Extract<IcsTime, { kind: "datetime" }>;

/** Zone eines Zeitwerts: schwebend und unbekannte Namen gelten in der Zone der App. */
function zoneOf(time: WallTime): string {
  if (time.tz === null) return APP_TIME_ZONE;
  if (time.tz === "UTC") return "UTC";
  return isValidTimeZone(time.tz) ? time.tz : APP_TIME_ZONE;
}

function wallToInstant(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): number {
  if (tz === "UTC") return Date.UTC(y, m - 1, d, h, mi, s);
  return new TZDate(y, m - 1, d, h, mi, s, tz).getTime();
}

/** Zeitpunkt → Wanduhrzeit in der Zone als „falsche UTC“ (Rechenform für rrule). */
function instantToFakeUtc(ms: number, tz: string): number {
  if (tz === "UTC") return ms;
  const t = new TZDate(ms, tz);
  return Date.UTC(
    t.getFullYear(),
    t.getMonth(),
    t.getDate(),
    t.getHours(),
    t.getMinutes(),
    t.getSeconds(),
  );
}

function fakeUtcToInstant(fake: number, tz: string): number {
  const d = new Date(fake);
  return wallToInstant(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    tz,
  );
}

const dateToFakeUtc = (date: IsoDate) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const fakeUtcToDate = (fake: number): IsoDate => new Date(fake).toISOString().slice(0, 10);

/** Mitternacht eines Kalendertags in Europe/Berlin als Zeitpunkt. */
export function berlinMidnight(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new TZDate(y, m - 1, d, 0, 0, 0, APP_TIME_ZONE).getTime();
}

/** Zeitwert → Zeitpunkt (ms). Datum = Mitternacht in Europe/Berlin. */
export function timeToInstant(time: IcsTime): number {
  if (time.kind === "date") return berlinMidnight(time.date);
  return wallToInstant(
    time.year,
    time.month,
    time.day,
    time.hour,
    time.minute,
    time.second,
    zoneOf(time),
  );
}

/** Ein Zeitwert in der Rechenform des Termins (Wanduhrzeit in dessen Zone bzw. Kalendertag). */
function timeToFake(time: IcsTime, allDay: boolean, tz: string): number {
  if (allDay) {
    if (time.kind === "date") return dateToFakeUtc(time.date);
    return dateToFakeUtc(berlinDate(new Date(timeToInstant(time))));
  }
  if (time.kind === "date") return dateToFakeUtc(time.date);
  return instantToFakeUtc(timeToInstant(time), tz);
}

/** UNTIL aus der RRULE in die Rechenform (Datum ohne Uhrzeit = bis Tagesende). */
function untilFake(rrule: string, allDay: boolean, tz: string): Date | null {
  const match = /(?:^|;)UNTIL=([^;]+)/i.exec(rrule);
  if (!match) return null;
  const raw = (match[1] ?? "").trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const base = Date.UTC(Number(y), Number(m) - 1, Number(d));
    return new Date(allDay ? base : base + DAY_MS - 1000);
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw);
  if (!dt) return null;
  const [, y, m, d, h, mi, s, z] = dt;
  const wall = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? "0"),
  );
  if (allDay) return new Date(dateToFakeUtc(fakeUtcToDate(wall)));
  return new Date(z ? instantToFakeUtc(wall, tz) : wall);
}

/** Link zum Termin in Google Kalender (eid = base64 von „<id> <kalender>“), sonst null. */
export function googleEventLink(uid: string, calendarId: string | null): string | null {
  if (!calendarId || !uid) return null;
  const id = uid.replace(/@google\.com$/i, "");
  if (!/^[A-Za-z0-9_-]+$/.test(id) || !/^[\w.+-]+@[\w.-]+$/.test(calendarId)) return null;
  const eid = btoa(`${id} ${calendarId}`).replace(/=+$/, "");
  return `https://calendar.google.com/calendar/event?eid=${eid}`;
}

/** Dauer in ms (ganztägig: Vielfache eines Tages, mindestens ein Tag; sonst mindestens 0). */
function durationOf(event: IcsEvent, allDay: boolean, tz: string): number {
  const start = event.start as IcsTime;
  if (event.end) {
    const ms = allDay
      ? timeToFake(event.end, true, tz) - timeToFake(start, true, tz)
      : timeToInstant(event.end) - timeToInstant(start);
    if (allDay) return Math.max(DAY_MS, Math.round(ms / DAY_MS) * DAY_MS);
    return Math.max(0, ms);
  }
  if (event.durationSeconds !== null) {
    const ms = Math.max(0, event.durationSeconds * 1000);
    return allDay ? Math.max(DAY_MS, Math.round(ms / DAY_MS) * DAY_MS) : ms;
  }
  return allDay ? DAY_MS : 0;
}

/** Instanzen (Rechenform) im Fenster: Einzeltermin, RRULE und RDATE. */
function occurrences(
  event: IcsEvent,
  allDay: boolean,
  tz: string,
  fakeFrom: number,
  fakeTo: number,
): number[] {
  const base = timeToFake(event.start as IcsTime, allDay, tz);
  const out = new Set<number>();
  if (event.rrule) {
    try {
      const options = RRule.parseString(event.rrule);
      options.dtstart = new Date(base);
      const until = untilFake(event.rrule, allDay, tz);
      if (until) options.until = until;
      const rule = new RRule(options);
      let n = 0;
      for (const date of rule.between(
        new Date(fakeFrom),
        new Date(fakeTo),
        true,
        () => n++ < MAX_OCCURRENCES,
      )) {
        out.add(date.getTime());
      }
    } catch {
      out.add(base);
    }
  } else {
    out.add(base);
  }
  for (const rdate of event.rdates) out.add(timeToFake(rdate, allDay, tz));
  return [...out].sort((a, b) => a - b);
}

const cut = (text: string | null, max: number) =>
  text && text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Tage und Minuten eines Termins in Europe/Berlin aus Beginn (ms) und Dauer – gemeinsam für iCal und Google. */
export interface EventSpan {
  start: string;
  end: string;
  date: IsoDate;
  endDate: IsoDate;
  startMinutes: number | null;
  endMinutes: number | null;
}

/**
 * Zeitangaben eines Termins. Ganztägig: `startMs` ist der Tag als „falsche UTC“ (Mitternacht UTC),
 * `durationMs` ein Vielfaches eines Tages. Sonst: `startMs` der Zeitpunkt.
 */
export function eventSpan(allDay: boolean, startMs: number, durationMs: number): EventSpan {
  const endMs = startMs + durationMs;
  if (allDay) {
    const date = fakeUtcToDate(startMs);
    const endDate = addDays(date, Math.max(1, Math.round(durationMs / DAY_MS)) - 1);
    return {
      date,
      endDate,
      startMinutes: null,
      endMinutes: null,
      start: new Date(berlinMidnight(date)).toISOString(),
      end: new Date(berlinMidnight(addDays(endDate, 1))).toISOString(),
    };
  }
  const start = new Date(startMs);
  const end = new Date(endMs);
  const date = berlinDate(start);
  const startMinutes = berlinMinutes(start);
  let endDate: IsoDate;
  let endMinutes: number;
  if (durationMs === 0) {
    endDate = date;
    endMinutes = startMinutes;
  } else {
    const endDay = berlinDate(end);
    const minutes = berlinMinutes(end);
    if (minutes === 0) {
      // Ende um Mitternacht gehört zum Vortag (20:00–24:00)
      endDate = addDays(endDay, -1);
      endMinutes = MINUTES_PER_DAY;
    } else {
      endDate = endDay;
      endMinutes = minutes;
    }
  }
  return {
    date,
    endDate,
    startMinutes,
    endMinutes,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/** Eine Instanz zum normalisierten Termin. */
function toCalendarEvent(
  source: ExpandSource,
  event: IcsEvent,
  allDay: boolean,
  startMs: number,
  durationMs: number,
): CalendarEvent {
  const span = eventSpan(allDay, startMs, durationMs);
  const { date, endDate, startMinutes, endMinutes, start: startIso, end: endIso } = span;
  return {
    id: `${source.id}:${event.uid}:${startIso}`,
    sourceId: source.id,
    sourceName: source.name,
    color: source.color,
    uid: event.uid,
    title: cut(event.summary, MAX_TITLE) || "Ohne Titel",
    location: cut(event.location, MAX_TITLE),
    description: cut(event.description, MAX_DESCRIPTION),
    allDay,
    start: startIso,
    end: endIso,
    date,
    endDate,
    startMinutes,
    endMinutes,
    busy: !event.transparent,
    recurring: Boolean(event.rrule) || event.recurrenceId !== null,
    link: googleEventLink(event.uid, source.calendarId),
  };
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return (
    a.date.localeCompare(b.date) ||
    Number(b.allDay) - Number(a.allDay) ||
    (a.startMinutes ?? 0) - (b.startMinutes ?? 0) ||
    a.title.localeCompare(b.title, "de") ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Alle Termine einer Quelle, die den Zeitraum (Kalendertage in Europe/Berlin, inklusive)
 * berühren – Wiederholungen ausgerollt, Ausnahmen (RECURRENCE-ID) ersetzen ihre Instanz,
 * Abgesagtes fällt weg. Sortiert nach Tag, ganztägig zuerst, dann Uhrzeit.
 */
export function expandCalendar(
  calendar: IcsCalendar,
  range: CalendarRange,
  source: ExpandSource,
): CalendarEvent[] {
  const rangeStart = berlinMidnight(range.start);
  const rangeEnd = berlinMidnight(addDays(range.end, 1));
  const overlaps = (start: number, end: number) =>
    start < rangeEnd && (end > rangeStart || (end === start && start >= rangeStart));

  // Ausnahmen je Serie: welche Instanz (Zeitpunkt) ein eigener Eintrag ersetzt
  const replaced = new Map<string, Set<number>>();
  for (const event of calendar.events) {
    if (!event.recurrenceId) continue;
    const set = replaced.get(event.uid) ?? new Set<number>();
    set.add(timeToInstant(event.recurrenceId));
    replaced.set(event.uid, set);
  }

  const out: CalendarEvent[] = [];
  for (const event of calendar.events) {
    if (event.cancelled || !event.start) continue;
    const allDay = event.start.kind === "date";
    const tz = event.start.kind === "datetime" ? zoneOf(event.start) : APP_TIME_ZONE;
    const duration = durationOf(event, allDay, tz);
    if (event.recurrenceId) {
      // verschobene Instanz: steht für sich, mit eigener Zeit
      const start = allDay ? timeToFake(event.start, true, tz) : timeToInstant(event.start);
      const [s, e] = allDay
        ? [berlinMidnight(fakeUtcToDate(start)), berlinMidnight(fakeUtcToDate(start + duration))]
        : [start, start + duration];
      if (overlaps(s, e)) out.push(toCalendarEvent(source, event, allDay, start, duration));
      continue;
    }
    // Fenster in der Rechenform mit einem Tag Spiel je Seite (Zonenversatz) und der Dauer
    const fakeFrom = dateToFakeUtc(range.start) - duration - DAY_MS;
    const fakeTo = dateToFakeUtc(addDays(range.end, 1)) + DAY_MS;
    const skip = new Set(event.exdates.map(timeToInstant));
    const taken = replaced.get(event.uid);
    for (const fake of occurrences(event, allDay, tz, fakeFrom, fakeTo)) {
      const instant = allDay ? berlinMidnight(fakeUtcToDate(fake)) : fakeUtcToInstant(fake, tz);
      if (skip.has(instant) || taken?.has(instant)) continue;
      const startMs = allDay ? fake : instant;
      const [s, e] = allDay
        ? [instant, berlinMidnight(fakeUtcToDate(fake + duration))]
        : [instant, instant + duration];
      if (!overlaps(s, e)) continue;
      out.push(toCalendarEvent(source, event, allDay, startMs, duration));
    }
  }
  return out.sort(byStart);
}

/** Termine, die einen Kalendertag berühren. */
export function eventsOnDay(events: CalendarEvent[], date: IsoDate): CalendarEvent[] {
  return events.filter((e) => e.date <= date && date <= e.endDate);
}

/**
 * Termine in Tagesabschnitte zerlegen (Woche/Tag: eine Spalte je Tag; Tageslast; freie Fenster).
 * Mehrtägiges erscheint an jedem Tag, mit Markierung „läuft weiter“.
 */
export function splitByDay(events: CalendarEvent[], range: CalendarRange): CalendarDaySegment[] {
  const out: CalendarDaySegment[] = [];
  for (const event of events) {
    const first = event.date < range.start ? range.start : event.date;
    const last = event.endDate > range.end ? range.end : event.endDate;
    for (let day = first; day <= last; day = addDays(day, 1)) {
      const from = day === event.date && !event.allDay ? (event.startMinutes ?? 0) : 0;
      const to =
        day === event.endDate && !event.allDay ? (event.endMinutes ?? from) : MINUTES_PER_DAY;
      out.push({
        event,
        date: day,
        from,
        to,
        continuesBefore: day > event.date,
        continuesAfter: day < event.endDate,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(b.event.allDay) - Number(a.event.allDay) ||
      a.from - b.from ||
      b.to - a.to ||
      a.event.id.localeCompare(b.event.id),
  );
}

/** Belegte Minuten eines Tages (Überlappungen zählen einmal; ganztägig und „frei“ zählen nicht). */
export function busyMinutes(segments: CalendarDaySegment[]): number {
  const spans = segments
    .filter((s) => s.event.busy && !s.event.allDay && s.to > s.from)
    .map((s) => [s.from, s.to] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [from, to] of spans) {
    if (current && from <= current[1]) {
      current[1] = Math.max(current[1], to);
    } else {
      if (current) total += current[1] - current[0];
      current = [from, to];
    }
  }
  if (current) total += current[1] - current[0];
  return total;
}
