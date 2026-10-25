/**
 * Termine über die Calendar API (#64, N1b) – nur im Server, mit dem Zugriffs-Token dieser
 * Anfrage: `events.list` (Zeitraum, Instanzen statt Serien, Seiten durchlaufen) und
 * `events.patch` (nur Zeitfelder, mit If-Match, Gäste nicht benachrichtigen). Alle Adressen bauen
 * `apiPath` und die feste Basis aus N1a.
 */
import { addDays } from "@/lib/dates";
import { berlinMidnight } from "../events";
import { apiPath, GoogleApiError, googleApiRequest } from "./calendar-api";
import type { GoogleEndpoints } from "./config";
import type { FetchDeps } from "./oauth";
import type { GoogleAccessRole } from "./types";

const MAX_PAGES = 10;
const ROLES: readonly GoogleAccessRole[] = ["owner", "writer", "reader", "freeBusyReader"];

export interface GoogleEventsPage {
  accessRole: GoogleAccessRole;
  items: unknown[];
}

/** Alle Termine eines Kalenders im Zeitraum (Kalendertage in Europe/Berlin, inklusive). */
export async function listGoogleEvents(
  endpoints: GoogleEndpoints,
  accessToken: string,
  calendarId: string,
  range: { start: string; end: string },
  deps: FetchDeps = {},
): Promise<GoogleEventsPage> {
  const items: unknown[] = [];
  let accessRole: GoogleAccessRole = "reader";
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { body } = await googleApiRequest(
      endpoints,
      accessToken,
      apiPath("calendars", calendarId, "events"),
      {
        query: {
          singleEvents: "true",
          orderBy: "startTime",
          timeMin: new Date(berlinMidnight(range.start)).toISOString(),
          timeMax: new Date(berlinMidnight(addDays(range.end, 1))).toISOString(),
          maxResults: "250",
          showDeleted: "false",
          pageToken,
        },
      },
      deps,
    );
    const data = body as {
      items?: unknown;
      nextPageToken?: unknown;
      accessRole?: unknown;
    } | null;
    if (!data || (data.items !== undefined && !Array.isArray(data.items))) {
      throw new GoogleApiError("Unerwartete Antwort von Google.", 502, null);
    }
    if (
      typeof data.accessRole === "string" &&
      (ROLES as readonly string[]).includes(data.accessRole)
    ) {
      accessRole = data.accessRole as GoogleAccessRole;
    }
    items.push(...((data.items as unknown[] | undefined) ?? []));
    pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return { accessRole, items };
}

/** Zeit eines Termins im Format der API: `{ date }` ganztägig, sonst `{ dateTime, timeZone? }`. */
export type GoogleTimeField = { date: string } | { dateTime: string; timeZone?: string };

export interface PatchTimes {
  start: GoogleTimeField;
  end: GoogleTimeField;
}

/** Felder, die die App an einem Termin ändern darf (alles andere bleibt in Google unberührt). */
export interface GoogleEventChanges {
  summary?: string;
  /** null leert das Feld */
  location?: string | null;
  description?: string | null;
  start?: GoogleTimeField;
  end?: GoogleTimeField;
  /** `confirmed` holt einen gelöschten Termin zurück (Google hält ihn eine Weile vor) */
  status?: "confirmed";
}

/** Antwort der Schnittstelle auf einen einzelnen Termin (roh, vor `normalizeGoogleEvent`). */
const requireBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== "object" || body === null) {
    throw new GoogleApiError("Unerwartete Antwort von Google.", 502, null);
  }
  return body as Record<string, unknown>;
};

const etagOf = (body: Record<string, unknown>): string => {
  const etag = body.etag;
  if (typeof etag !== "string" || !etag) {
    throw new GoogleApiError("Unerwartete Antwort von Google.", 502, null);
  }
  return etag;
};

/**
 * Zeitfeld für `events.patch` (G-6): Google führt verschachtelte Objekte zusammen. Ohne
 * ausdrückliches `null` bliebe beim Wechsel zwischen ganztägig und mit Uhrzeit das alte Feld
 * stehen (`date` neben `dateTime`), und Google lehnte ab.
 */
export function patchTimeField(
  field: GoogleTimeField,
): { date: string; dateTime: null } | { dateTime: string; timeZone?: string; date: null } {
  return "date" in field ? { date: field.date, dateTime: null } : { ...field, date: null };
}

/** Termine ändern (nur die genannten Felder); `etag` null = ohne If-Match. Antwort = roher Termin. */
export async function patchGoogleEvent(
  endpoints: GoogleEndpoints,
  accessToken: string,
  calendarId: string,
  eventId: string,
  etag: string | null,
  changes: GoogleEventChanges,
  deps: FetchDeps = {},
): Promise<Record<string, unknown>> {
  const { body } = await googleApiRequest(
    endpoints,
    accessToken,
    apiPath("calendars", calendarId, "events", eventId),
    {
      method: "PATCH",
      query: { sendUpdates: "none" },
      body: {
        ...changes,
        ...(changes.start ? { start: patchTimeField(changes.start) } : {}),
        ...(changes.end ? { end: patchTimeField(changes.end) } : {}),
      },
      ifMatch: etag ?? undefined,
    },
    deps,
  );
  const event = requireBody(body);
  etagOf(event);
  return event;
}

/** Nur Zeitfelder ändern; Antwort = neuer Stand (mit neuem etag). */
export async function patchGoogleEventTimes(
  endpoints: GoogleEndpoints,
  accessToken: string,
  calendarId: string,
  eventId: string,
  etag: string,
  times: PatchTimes,
  deps: FetchDeps = {},
): Promise<{ etag: string }> {
  const event = await patchGoogleEvent(
    endpoints,
    accessToken,
    calendarId,
    eventId,
    etag,
    { start: times.start, end: times.end },
    deps,
  );
  return { etag: etagOf(event) };
}

/** Neuer Termin (Titel, Ort, Beschreibung, Zeiten), Gäste nicht benachrichtigen. Antwort roh. */
export async function insertGoogleEvent(
  endpoints: GoogleEndpoints,
  accessToken: string,
  calendarId: string,
  event: {
    summary: string;
    location?: string | null;
    description?: string | null;
    start: GoogleTimeField;
    end: GoogleTimeField;
  },
  deps: FetchDeps = {},
): Promise<Record<string, unknown>> {
  const { body } = await googleApiRequest(
    endpoints,
    accessToken,
    apiPath("calendars", calendarId, "events"),
    {
      method: "POST",
      query: { sendUpdates: "none" },
      body: {
        summary: event.summary,
        ...(event.location ? { location: event.location } : {}),
        ...(event.description ? { description: event.description } : {}),
        start: event.start,
        end: event.end,
      },
    },
    deps,
  );
  const created = requireBody(body);
  etagOf(created);
  return created;
}

/** Termin löschen (bei Serien-Instanzen nur diese); `etag` gegeben = nur, wenn unverändert. */
export async function deleteGoogleEvent(
  endpoints: GoogleEndpoints,
  accessToken: string,
  calendarId: string,
  eventId: string,
  etag: string | null,
  deps: FetchDeps = {},
): Promise<void> {
  await googleApiRequest(
    endpoints,
    accessToken,
    apiPath("calendars", calendarId, "events", eventId),
    { method: "DELETE", query: { sendUpdates: "none" }, ifMatch: etag ?? undefined },
    deps,
  );
}

/** Termin in einen anderen Kalender legen (`events.move`); Antwort roh (neues etag). */
export async function moveGoogleEvent(
  endpoints: GoogleEndpoints,
  accessToken: string,
  calendarId: string,
  eventId: string,
  destinationCalendarId: string,
  etag: string,
  deps: FetchDeps = {},
): Promise<Record<string, unknown>> {
  const { body } = await googleApiRequest(
    endpoints,
    accessToken,
    apiPath("calendars", calendarId, "events", eventId, "move"),
    {
      method: "POST",
      query: { destination: destinationCalendarId, sendUpdates: "none" },
      ifMatch: etag,
    },
    deps,
  );
  const moved = requireBody(body);
  etagOf(moved);
  return moved;
}

/** Ein Termin (roh) – für die KI-Werkzeuge (N1d): Stand und etag vor dem Ändern oder Löschen. */
export async function getGoogleEvent(
  endpoints: GoogleEndpoints,
  accessToken: string,
  calendarId: string,
  eventId: string,
  deps: FetchDeps = {},
): Promise<Record<string, unknown>> {
  const { body } = await googleApiRequest(
    endpoints,
    accessToken,
    apiPath("calendars", calendarId, "events", eventId),
    {},
    deps,
  );
  const event = requireBody(body);
  etagOf(event);
  return event;
}
