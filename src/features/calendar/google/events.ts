/**
 * Google-Termine → `CalendarEvent` (#64, N1b). Rein, ohne Server-Abhängigkeiten: die Route
 * `/api/kalender` füttert sie mit der Antwort von `events.list` (singleEvents=true), Tests mit
 * Beispielen. Dieselbe Form wie bei iCal (Europe/Berlin, ganztägig, Farbe und Name der Quelle),
 * dazu der Verweis `google` (Termin-ID, etag, `editable`, Serie, Zone).
 */
import { z } from "zod";
import { daysBetween } from "@/lib/dates";
import { DAY_MS, eventSpan } from "../events";
import type { CalendarColor, CalendarEvent, GoogleEventRef } from "../types";
import type { GoogleAccessRole } from "./types";

export const MAX_DESCRIPTION = 2000;
export const MAX_TITLE = 300;

const TimeSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTime: z.string().max(40).optional(),
  timeZone: z.string().max(80).optional(),
});

/** Nur, was die App braucht – unbekannte Felder werden verworfen (nie weitergereicht). */
export const GoogleEventSchema = z.object({
  id: z.string().min(1).max(1024),
  etag: z.string().min(1).max(200),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: TimeSchema,
  end: TimeSchema.optional(),
  transparency: z.string().optional(),
  recurringEventId: z.string().max(1024).optional(),
  recurrence: z.array(z.string()).optional(),
  htmlLink: z.string().max(2048).optional(),
  eventType: z.string().optional(),
  locked: z.boolean().optional(),
  guestsCanModify: z.boolean().optional(),
  organizer: z.object({ self: z.boolean().optional() }).optional(),
  attendees: z
    .array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() }))
    .optional(),
});
export type GoogleEventRaw = z.infer<typeof GoogleEventSchema>;

/** Terminarten, deren Zeit man in Google nicht frei ändern kann (Geburtstage, aus Gmail, Arbeitsort). */
const FIXED_TYPES = new Set(["birthday", "fromGmail", "workingLocation"]);

/**
 * Ziehbar nur, wenn der Nutzer den Termin in Google ändern dürfte: Kalender mit Schreibrecht
 * (owner/writer), nicht gesperrt, keine feste Terminart – und bei Einladungen (mit Gästen) nur,
 * wenn er Organisator ist oder die Gäste ändern dürfen.
 */
export function isGoogleEventEditable(raw: GoogleEventRaw, accessRole: GoogleAccessRole): boolean {
  if (accessRole !== "owner" && accessRole !== "writer") return false;
  if (raw.locked) return false;
  if (raw.eventType && FIXED_TYPES.has(raw.eventType)) return false;
  const guests = (raw.attendees ?? []).filter((a) => !a.self);
  if (guests.length === 0) return true;
  return raw.organizer?.self === true || raw.guestsCanModify === true;
}

const cut = (text: string | undefined, max: number): string | null => {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Nur Googles eigene Adressen als „In Google öffnen“ (nie eine fremde Adresse aus den Daten). */
const GOOGLE_LINK = /^https:\/\/(www\.google\.com|calendar\.google\.com)\/calendar\//;

export interface NormalizeSource {
  id: string;
  name: string;
  color: CalendarColor;
  calendarId: string;
  accessRole: GoogleAccessRole;
}

/** Ein Termin aus Google; abgesagte, abgelehnte und unlesbare fallen weg (null). */
export function normalizeGoogleEvent(
  input: unknown,
  source: NormalizeSource,
): CalendarEvent | null {
  const parsed = GoogleEventSchema.safeParse(input);
  if (!parsed.success) return null;
  const raw = parsed.data;
  if (raw.status === "cancelled") return null;
  // wie in Google selbst: abgelehnte Einladungen blendet die Ansicht aus
  if ((raw.attendees ?? []).some((a) => a.self && a.responseStatus === "declined")) return null;

  const allDay = raw.start.date !== undefined && raw.start.dateTime === undefined;
  let startMs: number;
  let durationMs: number;
  if (allDay) {
    const date = raw.start.date as string;
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    startMs = Date.UTC(y, m - 1, d);
    const days = raw.end?.date ? daysBetween(date, raw.end.date) : 1;
    durationMs = Math.max(1, days) * DAY_MS;
  } else {
    startMs = Date.parse(raw.start.dateTime ?? "");
    const endMs = Date.parse(raw.end?.dateTime ?? "");
    if (Number.isNaN(startMs)) return null;
    durationMs = Number.isNaN(endMs) ? 0 : Math.max(0, endMs - startMs);
  }
  const span = eventSpan(allDay, startMs, durationMs);
  const recurring = raw.recurringEventId !== undefined || (raw.recurrence ?? []).length > 0;
  const google: GoogleEventRef = {
    calendarId: source.calendarId,
    eventId: raw.id,
    etag: raw.etag,
    editable: isGoogleEventEditable(raw, source.accessRole),
    recurringEventId: raw.recurringEventId ?? null,
    timeZone: allDay ? null : (raw.start.timeZone ?? raw.end?.timeZone ?? null),
  };
  return {
    id: `${source.id}:${raw.id}:${span.start}`,
    sourceId: source.id,
    sourceName: source.name,
    color: source.color,
    uid: raw.id,
    title: cut(raw.summary, MAX_TITLE) || "Ohne Titel",
    location: cut(raw.location, MAX_TITLE),
    description: cut(raw.description, MAX_DESCRIPTION),
    allDay,
    start: span.start,
    end: span.end,
    date: span.date,
    endDate: span.endDate,
    startMinutes: span.startMinutes,
    endMinutes: span.endMinutes,
    busy: raw.transparency !== "transparent",
    recurring,
    link: raw.htmlLink && GOOGLE_LINK.test(raw.htmlLink) ? raw.htmlLink : null,
    google,
  };
}

export function normalizeGoogleEvents(items: unknown[], source: NormalizeSource): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const item of items) {
    const event = normalizeGoogleEvent(item, source);
    if (event) out.push(event);
  }
  return out;
}
