/**
 * Termine anlegen, Texte ändern und Löschen rückgängig machen (#64, N1c) – reine Rechnung ohne
 * "use client", von Fenster, Hook und Tests geteilt:
 * - Vorbelegung aus Klick/Ziehen im Zeitraster (`gridDraft`) und aus „＋ Termin“ (`dayDraft`),
 * - Entwurf → Zeiten und Eingabe für POST /api/kalender/termin (`draftTimes`, `toCreateBody`),
 * - sofortige Anzeige (`optimisticEvent`),
 * - Daten für Rückgängig: Löschen → Wiederherstellen (`toRestoreBody`), Änderung → alte Werte
 *   (`textChange`).
 */
import { addDays, berlinDateTime, type IsoDate } from "@/lib/dates";
import { MAX_DESCRIPTION, MAX_TITLE } from "./google/events";
import { minutesToTime } from "./layout";
import { applyEventTimes, type EventTimes, eventTimes, MIN_EVENT_MIN } from "./move";
import type { CalendarEvent } from "./types";

/** Standarddauer eines Klicks ins Raster (Minuten). */
export const CLICK_DURATION_MIN = 60;
/** Raster beim Ziehen (Minuten) und Halbstundenfelder beim Klicken. */
const DRAG_STEP = 15;
const SLOT_STEP = 30;
const DAY_MIN = 24 * 60;
export const MAX_LOCATION = 300;
/** Beschreibung beim Anlegen/Ändern – wie in der Route geprüft */
export const MAX_DESCRIPTION_INPUT = 8000;

export interface EventDraft {
  title: string;
  /** Kalenderquelle (Zeile `kind = google`) */
  sourceId: string;
  date: IsoDate;
  /** Beginn „HH:mm“ (ganztägig ohne Bedeutung) */
  time: string;
  durationMin: number;
  allDay: boolean;
  /** ganztägig: letzter Tag (inklusive) */
  endDate: IsoDate;
  location: string;
  description: string;
}

/** Ein Kalender mit Schreibrecht, in dem sich Termine anlegen lassen. */
export interface WritableCalendar {
  sourceId: string;
  name: string;
  color: CalendarEvent["color"];
  primary: boolean;
}

/**
 * Zeitraum aus Klick/Ziehen im Raster: ohne Ziehen 1 h ab dem angeklickten Halbstundenfeld, mit
 * Ziehen von der Zeile des Drückens bis zur Zeile des Loslassens (15-min-Raster, mindestens
 * 15 min; die Zeile des Loslassens zählt mit, egal in welche Richtung gezogen wurde).
 */
export function gridRange(
  pressMinutes: number,
  releaseMinutes: number | null,
): { start: number; duration: number } {
  const clamp = (m: number) => Math.min(DAY_MIN - DRAG_STEP, Math.max(0, m));
  if (releaseMinutes === null) {
    const start = clamp(Math.floor(pressMinutes / SLOT_STEP) * SLOT_STEP);
    return { start, duration: CLICK_DURATION_MIN };
  }
  const a = clamp(Math.floor(pressMinutes / DRAG_STEP) * DRAG_STEP);
  const b = clamp(Math.floor(releaseMinutes / DRAG_STEP) * DRAG_STEP);
  const start = Math.min(a, b);
  const end = Math.max(a, b) + DRAG_STEP;
  return { start, duration: Math.max(MIN_EVENT_MIN, end - start) };
}

const EMPTY = { title: "", location: "", description: "", allDay: false } as const;

/** Entwurf aus dem Raster (Klick oder Ziehen) – Kalender setzt der Aufrufer. */
export function gridDraft(
  sourceId: string,
  date: IsoDate,
  pressMinutes: number,
  releaseMinutes: number | null,
): EventDraft {
  const { start, duration } = gridRange(pressMinutes, releaseMinutes);
  return {
    ...EMPTY,
    sourceId,
    date,
    endDate: date,
    time: minutesToTime(start),
    durationMin: duration,
  };
}

/**
 * Entwurf für „＋ Termin“: der gewählte Tag; heute die nächste volle Stunde (spätestens 22 Uhr),
 * sonst 9 Uhr.
 */
export function dayDraft(
  sourceId: string,
  date: IsoDate,
  today: IsoDate,
  nowMinutes: number | null,
): EventDraft {
  const hour =
    date === today && nowMinutes !== null ? Math.min(22, Math.floor(nowMinutes / 60) + 1) : 9;
  return {
    ...EMPTY,
    sourceId,
    date,
    endDate: date,
    time: minutesToTime(hour * 60),
    durationMin: CLICK_DURATION_MIN,
  };
}

/** Zeiten des Entwurfs in der Form der Schnittstelle (ganztägig: Ende exklusiv). */
export function draftTimes(draft: EventDraft): EventTimes {
  if (draft.allDay) {
    const last = draft.endDate < draft.date ? draft.date : draft.endDate;
    return { allDay: true, start: draft.date, end: addDays(last, 1) };
  }
  const start = berlinDateTime(draft.date, draft.time || "00:00");
  return {
    allDay: false,
    start,
    end: new Date(
      Date.parse(start) + Math.max(MIN_EVENT_MIN, draft.durationMin) * 60_000,
    ).toISOString(),
  };
}

/** Was am Entwurf fehlt oder nicht passt (Text für das Fenster), sonst null. */
export function draftIssue(draft: EventDraft): string | null {
  const title = draft.title.trim();
  if (!title) return "Bitte einen Titel eingeben.";
  if (title.length > MAX_TITLE) return `Der Titel ist zu lang (höchstens ${MAX_TITLE} Zeichen).`;
  if (draft.location.trim().length > MAX_LOCATION) {
    return `Der Ort ist zu lang (höchstens ${MAX_LOCATION} Zeichen).`;
  }
  if (draft.description.length > MAX_DESCRIPTION_INPUT) {
    return `Die Beschreibung ist zu lang (höchstens ${MAX_DESCRIPTION_INPUT} Zeichen).`;
  }
  if (!draft.sourceId) return "Bitte einen Kalender wählen.";
  if (!draft.date) return "Bitte einen Tag wählen.";
  if (draft.allDay) {
    if (!draft.endDate || draft.endDate < draft.date) return "Das Ende liegt vor dem Beginn.";
  } else if (!/^\d{2}:\d{2}$/.test(draft.time)) return "Bitte eine Uhrzeit angeben.";
  return null;
}

/** Eingabe für POST /api/kalender/termin. */
export interface CreateEventBody {
  sourceId: string;
  summary: string;
  location: string;
  description: string;
  allDay: boolean;
  start: string;
  end: string;
  timeZone: string | null;
}

export function toCreateBody(draft: EventDraft): CreateEventBody {
  const times = draftTimes(draft);
  return {
    sourceId: draft.sourceId,
    summary: draft.title.trim(),
    location: draft.location.trim(),
    description: draft.description,
    allDay: times.allDay,
    start: times.start,
    end: times.end,
    timeZone: times.allDay ? null : "Europe/Berlin",
  };
}

/** Termin so, wie er sofort angezeigt wird (bis Google antwortet): noch nicht änderbar. */
export function optimisticEvent(
  draft: EventDraft,
  calendar: Pick<WritableCalendar, "sourceId" | "name" | "color">,
  tempId: string,
): CalendarEvent {
  const base: CalendarEvent = {
    id: "",
    sourceId: calendar.sourceId,
    sourceName: calendar.name,
    color: calendar.color,
    uid: tempId,
    title: draft.title.trim() || "Ohne Titel",
    location: draft.location.trim() || null,
    description: draft.description.trim() ? draft.description : null,
    allDay: draft.allDay,
    start: "",
    end: "",
    date: draft.date,
    endDate: draft.date,
    startMinutes: null,
    endMinutes: null,
    busy: true,
    recurring: false,
    link: null,
    google: {
      calendarId: "",
      eventId: tempId,
      etag: "",
      editable: false,
      recurringEventId: null,
      timeZone: draft.allDay ? null : "Europe/Berlin",
    },
  };
  return applyEventTimes(base, draftTimes(draft));
}

/** Eingabe für POST /api/kalender/termin/wiederherstellen: alle Angaben des gelöschten Termins. */
export interface RestoreEventBody extends CreateEventBody {
  eventId: string;
}

export function toRestoreBody(event: CalendarEvent): RestoreEventBody | null {
  if (!event.google) return null;
  const times = eventTimes(event);
  return {
    sourceId: event.sourceId,
    eventId: event.google.eventId,
    summary: event.title,
    location: event.location ?? "",
    description: event.description ?? "",
    allDay: times.allDay,
    start: times.start,
    end: times.end,
    timeZone: event.google.timeZone,
  };
}

/** Texte eines Termins, die man ändern kann. */
export interface EventTexts {
  summary: string;
  location: string;
  description: string;
}

export const eventTexts = (event: CalendarEvent): EventTexts => ({
  summary: event.title,
  location: event.location ?? "",
  description: event.description ?? "",
});

/** Beim Lesen gekürzter Text (… am Ende, volle Länge): würde beim Speichern Inhalt verlieren. */
export function isCut(text: string | null, max: number): boolean {
  return text !== null && text.length >= max && text.endsWith("…");
}

/** Felder, die sich beim Bearbeiten nicht sicher speichern lassen (zu lang gekürzt gelesen). */
export function lockedTexts(event: CalendarEvent): Array<keyof EventTexts> {
  const locked: Array<keyof EventTexts> = [];
  if (isCut(event.title, MAX_TITLE)) locked.push("summary");
  if (isCut(event.location, MAX_TITLE)) locked.push("location");
  if (isCut(event.description, MAX_DESCRIPTION)) locked.push("description");
  return locked;
}

/**
 * Änderung von Titel/Ort/Beschreibung: nur die Felder, die sich wirklich ändern (Titel getrimmt,
 * leerer Titel zählt nicht), samt den alten Werten fürs Rückgängig. null = nichts zu tun.
 */
export function textChange(
  event: CalendarEvent,
  next: Partial<EventTexts>,
): { changes: Partial<EventTexts>; previous: Partial<EventTexts> } | null {
  const before = eventTexts(event);
  const changes: Partial<EventTexts> = {};
  const previous: Partial<EventTexts> = {};
  const norm = (key: keyof EventTexts, value: string) =>
    key === "summary"
      ? value.trim()
      : key === "location"
        ? value.trim()
        : value.replace(/\s+$/u, "");
  for (const key of ["summary", "location", "description"] as const) {
    const value = next[key];
    if (value === undefined) continue;
    const clean = norm(key, value);
    if (key === "summary" && !clean) continue;
    if (clean === (key === "description" ? before[key].replace(/\s+$/u, "") : before[key].trim())) {
      continue;
    }
    changes[key] = clean;
    previous[key] = before[key];
  }
  return Object.keys(changes).length > 0 ? { changes, previous } : null;
}

/** Text für das Rückgängig-Toast einer Änderung: „Titel geändert: „Neu““ usw. */
export function textChangeMessage(event: CalendarEvent, changes: Partial<EventTexts>): string {
  const cut = (text: string) => (text.length > 50 ? `${text.slice(0, 49)}…` : text);
  const parts: string[] = [];
  if (changes.summary !== undefined) parts.push("Titel");
  if (changes.location !== undefined) parts.push("Ort");
  if (changes.description !== undefined) parts.push("Beschreibung");
  const what = parts.join(" und ");
  const title = changes.summary ?? event.title;
  return `${what} geändert: „${cut(title)}“`;
}

/** Meldungen: Termin angelegt / gelöscht. */
export const createdMessage = (title: string) => `Termin „${cut60(title)}“ angelegt`;
export const deletedMessage = (title: string, series: boolean) =>
  `Termin „${cut60(title)}“ gelöscht${series ? " (nur dieser Termin der Serie)" : ""}`;
const cut60 = (text: string) => (text.length > 60 ? `${text.slice(0, 59)}…` : text);

/** Kalender für einen neuen Termin: zuletzt benutzter (wenn noch beschreibbar), sonst primärer, sonst erster. */
export function defaultCalendar(
  calendars: WritableCalendar[],
  lastSourceId: string | null,
): WritableCalendar | null {
  return (
    calendars.find((c) => c.sourceId === lastSourceId) ??
    calendars.find((c) => c.primary) ??
    calendars[0] ??
    null
  );
}

/** Beschreibbare Google-Kalender aus dem Status der Quellen (Antwort von /api/kalender). */
export function writableCalendars(
  sources: Array<{
    id: string;
    name: string;
    color: CalendarEvent["color"];
    writable?: boolean;
    primary?: boolean;
  }>,
): WritableCalendar[] {
  return sources
    .filter((s) => s.writable)
    .map((s) => ({ sourceId: s.id, name: s.name, color: s.color, primary: s.primary === true }));
}
