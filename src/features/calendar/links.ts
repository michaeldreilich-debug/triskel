/**
 * Termine mit Aufgaben und Notizen verknüpfen (#68, Migration 43) – reines Modell ohne
 * „use client“ (App, KI-Werkzeuge, Export). Eine Verknüpfung hängt an einem Google-Termin
 * (Kalender-ID + Termin-ID) oder an seiner ganzen Serie und zeigt auf genau eine Aufgabe oder
 * Notiz; Titel und Zeit stehen als Schnappschuss mit, damit sie lesbar bleibt, wenn Google den
 * Termin nicht mehr liefert.
 */
import { berlinDate, berlinTime, formatDayShort } from "@/lib/dates";
import type { CalendarEvent } from "./types";

export const EVENT_LINK_SCOPES = ["occurrence", "series"] as const;
export type EventLinkScope = (typeof EVENT_LINK_SCOPES)[number];

export interface EventLinkRow {
  id: string;
  google_calendar_id: string;
  /** Termin-ID in Google (bei Serien: das Vorkommen, an dem verknüpft wurde) */
  event_id: string;
  recurring_event_id: string | null;
  scope: EventLinkScope;
  task_id: string | null;
  note_id: string | null;
  event_title: string;
  event_start: string;
  event_end: string;
  event_all_day: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Spalten, die die App schreibt (Server setzt user_id und Zeitstempel). */
export const EVENT_LINK_WRITE_KEYS = [
  "google_calendar_id",
  "event_id",
  "recurring_event_id",
  "scope",
  "task_id",
  "note_id",
  "event_title",
  "event_start",
  "event_end",
  "event_all_day",
  "deleted_at",
] as const satisfies ReadonlyArray<keyof EventLinkRow>;

export const EVENT_LINK_COLUMNS =
  "id, google_calendar_id, event_id, recurring_event_id, scope, task_id, note_id, event_title, event_start, event_end, event_all_day, created_at, updated_at, deleted_at";

export function toEventLink(row: Record<string, unknown> & { id: string }): EventLinkRow {
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  const now = new Date().toISOString();
  return {
    id: row.id,
    google_calendar_id: text("google_calendar_id") ?? "",
    event_id: text("event_id") ?? "",
    recurring_event_id: text("recurring_event_id"),
    scope: row.scope === "series" ? "series" : "occurrence",
    task_id: text("task_id"),
    note_id: text("note_id"),
    event_title: text("event_title") ?? "",
    event_start: text("event_start") ?? now,
    event_end: text("event_end") ?? text("event_start") ?? now,
    event_all_day: row.event_all_day === true,
    created_at: text("created_at") ?? now,
    updated_at: text("updated_at") ?? now,
    deleted_at: text("deleted_at"),
  };
}

/** Was eine Verknüpfung vom Termin braucht – nur Google-Termine lassen sich verknüpfen. */
export interface LinkableEvent {
  calendarId: string;
  eventId: string;
  recurringEventId: string | null;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export function linkableEvent(event: CalendarEvent): LinkableEvent | null {
  if (!event.google) return null;
  return {
    calendarId: event.google.calendarId,
    eventId: event.google.eventId,
    recurringEventId: event.google.recurringEventId,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
  };
}

/** Gilt die Verknüpfung für diesen Termin (das Vorkommen bzw. jedes Vorkommen der Serie)? */
export function linkMatches(
  link: Pick<EventLinkRow, "scope" | "event_id" | "recurring_event_id">,
  event: Pick<LinkableEvent, "eventId" | "recurringEventId">,
): boolean {
  if (link.scope === "series") {
    return link.recurring_event_id !== null && link.recurring_event_id === event.recurringEventId;
  }
  return link.event_id === event.eventId;
}

/**
 * Dieselbe Verknüpfung im Sinn des Index `event_links_unique` (Termin bzw. Serie und Ziel) – beim
 * Zurückholen einer gelösten Verknüpfung weicht die andere lebende Zeile (Migration 48, M-4).
 */
export function sameLink(
  a: Pick<EventLinkRow, "scope" | "event_id" | "recurring_event_id" | "task_id" | "note_id">,
  b: Pick<EventLinkRow, "scope" | "event_id" | "recurring_event_id" | "task_id" | "note_id">,
): boolean {
  const key = (l: typeof a) => (l.scope === "series" ? l.recurring_event_id : l.event_id);
  return key(a) === key(b) && (a.task_id ?? a.note_id) === (b.task_id ?? b.note_id);
}

const byStart = (a: EventLinkRow, b: EventLinkRow) =>
  a.event_start.localeCompare(b.event_start) || a.created_at.localeCompare(b.created_at);

/** Verknüpfungen eines Termins (ohne gelöste), älteste zuerst. */
export function linksOfEvent(links: EventLinkRow[], event: LinkableEvent): EventLinkRow[] {
  return links.filter((l) => !l.deleted_at && linkMatches(l, event)).sort(byStart);
}

/** Verknüpfungen einer Aufgabe bzw. Notiz (ohne gelöste), nach Beginn. */
export function linksOfTarget(
  links: EventLinkRow[],
  target: { taskId?: string; noteId?: string },
): EventLinkRow[] {
  return links
    .filter(
      (l) =>
        !l.deleted_at &&
        ((target.taskId !== undefined && l.task_id === target.taskId) ||
          (target.noteId !== undefined && l.note_id === target.noteId)),
    )
    .sort(byStart);
}

/** Ist dieselbe Aufgabe/Notiz schon mit dem Termin (bzw. der Serie) verknüpft? */
export function alreadyLinked(
  links: EventLinkRow[],
  event: LinkableEvent,
  target: { taskId?: string; noteId?: string },
): boolean {
  return linksOfEvent(links, event).some(
    (l) =>
      (target.taskId !== undefined && l.task_id === target.taskId) ||
      (target.noteId !== undefined && l.note_id === target.noteId),
  );
}

/** Schnappschuss aus dem Termin. */
export function snapshotOf(
  event: LinkableEvent,
): Pick<EventLinkRow, "event_title" | "event_start" | "event_end" | "event_all_day"> {
  return {
    event_title: event.title.slice(0, 1024),
    event_start: event.start,
    event_end: event.end,
    event_all_day: event.allDay,
  };
}

const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

/** Weicht der Schnappschuss vom aktuellen Termin ab? (Nur Vorkommen – Serien zeigen das erste.) */
export function snapshotStale(link: EventLinkRow, event: LinkableEvent): boolean {
  if (link.scope === "series" && link.event_id !== event.eventId) return false;
  return (
    link.event_title !== event.title.slice(0, 1024) ||
    !sameInstant(link.event_start, event.start) ||
    !sameInstant(link.event_end, event.end) ||
    link.event_all_day !== event.allDay
  );
}

/** „Di, 21.10. 19:00–21:00“ bzw. „Di, 21.10. · ganztägig“ (Europe/Berlin). */
export function eventWhenLabel(start: string, end: string, allDay: boolean): string {
  const day = formatDayShort(berlinDate(start));
  if (allDay) return `${day} · ganztägig`;
  const from = berlinTime(start);
  const to = berlinTime(end);
  const endDay = berlinDate(end);
  if (endDay !== berlinDate(start)) return `${day} ${from} – ${formatDayShort(endDay)} ${to}`;
  return from === to ? `${day} ${from}` : `${day} ${from}–${to}`;
}

/** Titel einer Notiz zum Termin: „Übungsdienst 21.10. – Protokoll“ (⌘K findet Titel und Datum). */
export function protocolTitle(event: Pick<LinkableEvent, "title" | "start">): string {
  const [, m, d] = berlinDate(event.start).split("-");
  return `${event.title.trim() || "Termin"} ${d}.${m}. – Protokoll`;
}
