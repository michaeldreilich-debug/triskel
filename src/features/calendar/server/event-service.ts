/**
 * Termine in Google anlegen, ändern, löschen, in einen anderen Kalender legen und wiederherstellen
 * (#64, N1c) – die Dienstschicht unter den Routen `/api/kalender/termin*`. Sie spricht nur über
 * `events-api.ts` mit Google, bekommt Zugriffs-Token und Kalender fertig übergeben und kennt weder
 * Anfrage noch Sitzung: Dieselben Funktionen nutzen später die KI-Werkzeuge (N1d) mit dem
 * KI-Token. Fehler kommen als `GoogleApiError`/`GoogleAuthError` heraus (Abbildung auf Antworten:
 * `termin-route.ts`).
 */
import { GoogleApiError } from "../google/calendar-api";
import type { GoogleEndpoints } from "../google/config";
import type { NewGoogleEvent } from "../google/event-input";
import { normalizeGoogleEvent } from "../google/events";
import type { PatchTimes } from "../google/events-api";
import {
  deleteGoogleEvent,
  type GoogleEventChanges,
  getGoogleEvent,
  insertGoogleEvent,
  moveGoogleEvent,
  patchGoogleEvent,
} from "../google/events-api";
import type { TextChanges } from "../google/patch-input";
import type { CalendarColor, CalendarEvent } from "../types";

/** Zugriff für diese Anfrage (aus `getGoogleAccess`, Zustand „connected“). */
export interface ConnectedAccess {
  endpoints: GoogleEndpoints;
  accessToken: string;
}

/** Kalenderquelle der App (Zeile `kind = google`) mit ihrer Google-Kalender-ID. */
export interface GoogleSourceInfo {
  id: string;
  name: string;
  color: CalendarColor;
  calendarId: string;
}

/**
 * Normalisieren wie beim Lesen. Der Kalender ist beschreibbar (sonst hätte Google abgelehnt),
 * deshalb `writer`; ob der Termin änderbar ist, entscheidet dann Google.
 */
function normalized(raw: Record<string, unknown>, source: GoogleSourceInfo): CalendarEvent {
  const event = normalizeGoogleEvent(raw, { ...source, accessRole: "writer" });
  if (!event) throw new GoogleApiError("Unerwartete Antwort von Google.", 502, null);
  return event;
}

/**
 * Einen Termin lesen (#68: Kopf „Termin: …“ in Notiz und Aufgabe). null = in Google gelöscht oder
 * abgesagt; 404/410 kommen als `GoogleApiError` heraus (Routen: `{ gone: true }`).
 */
export async function findEvent(
  access: ConnectedAccess,
  source: GoogleSourceInfo,
  eventId: string,
): Promise<CalendarEvent | null> {
  const raw = await getGoogleEvent(
    access.endpoints,
    access.accessToken,
    source.calendarId,
    eventId,
  );
  return normalizeGoogleEvent(raw, { ...source, accessRole: "reader" });
}

export async function createEvent(
  access: ConnectedAccess,
  source: GoogleSourceInfo,
  event: NewGoogleEvent,
): Promise<CalendarEvent> {
  const raw = await insertGoogleEvent(access.endpoints, access.accessToken, source.calendarId, {
    summary: event.summary,
    location: event.location,
    description: event.description,
    start: event.times.start,
    end: event.times.end,
  });
  return normalized(raw, source);
}

export interface EventUpdate {
  eventId: string;
  etag: string;
  times?: PatchTimes;
  text?: TextChanges;
}

/** Zeiten und/oder Texte ändern; Antwort = der Termin danach. */
export async function updateEvent(
  access: ConnectedAccess,
  source: GoogleSourceInfo,
  update: EventUpdate,
): Promise<CalendarEvent> {
  const changes: GoogleEventChanges = { ...update.text };
  if (update.times) {
    changes.start = update.times.start;
    changes.end = update.times.end;
  }
  const raw = await patchGoogleEvent(
    access.endpoints,
    access.accessToken,
    source.calendarId,
    update.eventId,
    update.etag,
    changes,
  );
  return normalized(raw, source);
}

export async function removeEvent(
  access: ConnectedAccess,
  source: GoogleSourceInfo,
  eventId: string,
  etag: string | null,
): Promise<void> {
  await deleteGoogleEvent(access.endpoints, access.accessToken, source.calendarId, eventId, etag);
}

/** In einen anderen Kalender legen (Titel, Zeit, Gäste bleiben); Antwort = der Termin dort. */
export async function moveEventToCalendar(
  access: ConnectedAccess,
  from: GoogleSourceInfo,
  to: GoogleSourceInfo,
  eventId: string,
  etag: string,
): Promise<CalendarEvent> {
  const raw = await moveGoogleEvent(
    access.endpoints,
    access.accessToken,
    from.calendarId,
    eventId,
    to.calendarId,
    etag,
  );
  return normalized(raw, to);
}

export interface RestoredEvent {
  event: CalendarEvent;
  /** `same` = derselbe Termin aus Googles Papierkorb, `new` = neu angelegt mit den Angaben */
  how: "same" | "new";
}

/**
 * Gelöschten Termin zurückholen: zuerst über `events.patch` mit `status: "confirmed"` (Google
 * hält Gelöschtes eine Weile vor – dann sind auch Gäste, Serie und Videokonferenz wieder da),
 * sonst mit allen gespeicherten Angaben neu anlegen. Andere Fehler (Zugang, Rechte) reichen durch.
 */
export async function restoreEvent(
  access: ConnectedAccess,
  source: GoogleSourceInfo,
  eventId: string,
  event: NewGoogleEvent,
): Promise<RestoredEvent> {
  try {
    const raw = await patchGoogleEvent(
      access.endpoints,
      access.accessToken,
      source.calendarId,
      eventId,
      null,
      { status: "confirmed" },
    );
    return { event: normalized(raw, source), how: "same" };
  } catch (caught) {
    const gone =
      caught instanceof GoogleApiError &&
      (caught.status === 404 || caught.status === 410 || caught.status === 400);
    if (!gone) throw caught;
  }
  return { event: await createEvent(access, source, event), how: "new" };
}
