/**
 * Alle eingeschalteten Kalenderquellen laden (#64, N1b): Google-Kalender über die Schnittstelle
 * (`events.list`), iCal-Adressen wie bisher – jedes Ding genau einmal.
 *
 * - Verbunden: Google-Kalender kommen von Google; eine iCal-Quelle, deren Kalender-ID in der
 *   Adresse steht und die ein geladener Google-Kalender ersetzt (`icalReplacedByGoogle`), wird
 *   nicht mehr geladen (nichts doppelt, kein Verzug des iCal-Abrufs).
 * - Nicht verbunden / nicht eingerichtet: Google-Zeilen bleiben stehen (Auswahl für das
 *   Neu-Verbinden), liefern aber nichts und melden nichts – iCal läuft wie vorher.
 * - Zugang weg (`reconnect`) oder Google nicht erreichbar: Status je Quelle mit Hinweis (bei
 *   `reconnect` mit „Neu verbinden“) und Rückfall auf die ersetzte iCal-Quelle, falls es sie gibt.
 * - Kurzer Cache der Google-Antworten (60 s, im Speicher der Instanz); nach einer Änderung
 *   (`clearGoogleEventsCache`) und mit `frisch=1` sofort frisch.
 * Kein Token, keine Adresse in Statusmeldungen.
 */

import type { GoogleAccess } from "../google/access";
import { GoogleApiError } from "../google/calendar-api";
import { normalizeGoogleEvents } from "../google/events";
import { type GoogleEventsPage, listGoogleEvents } from "../google/events-api";
import { icalReplacedByGoogle } from "../google/match";
import { GoogleAuthError } from "../google/oauth";
import type { CalendarColor, CalendarEvent, CalendarRange, CalendarSourceStatus } from "../types";
import { loadSourceEvents } from "./load";

export const GOOGLE_CACHE_MS = 60_000;

export interface SourceRow {
  id: string;
  kind: "ical" | "google";
  name: string;
  url: string | null;
  google_calendar_id: string | null;
  color: CalendarColor;
}

export interface LoadAllDeps {
  /** Zugang zu Google (frischer Zugriffs-Token); wird nur gerufen, wenn etwas zu laden ist */
  access: () => Promise<GoogleAccess>;
  userId: string;
  fresh?: boolean;
  listEvents?: typeof listGoogleEvents;
  loadIcal?: typeof loadSourceEvents;
  now?: () => number;
}

/** Höchstens so viele Einträge (Kalender × Zeitraum) im Speicher der Instanz (G-5). */
export const GOOGLE_CACHE_MAX = 200;

const cache = new Map<string, { at: number; page: GoogleEventsPage; primary: boolean }>();

/** Eintrag merken; Abgelaufenes fliegt raus, bei Überlauf die ältesten (G-5). */
function remember(key: string, entry: { at: number; page: GoogleEventsPage; primary: boolean }) {
  for (const [k, v] of cache) if (entry.at - v.at >= GOOGLE_CACHE_MS) cache.delete(k);
  cache.delete(key);
  while (cache.size >= GOOGLE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, entry);
}

/** Anzahl der Einträge (für Tests). */
export const googleEventsCacheSize = () => cache.size;

/**
 * Nach einer Änderung in Google, nach dem Verbinden und nach dem Trennen: Cache dieses Nutzers
 * verwerfen (sonst zeigte `/api/kalender` nach „Trennen“ noch bis zu 60 s Google-Termine, G-5).
 */
export function clearGoogleEventsCache(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) if (key.startsWith(`${userId}|`)) cache.delete(key);
}

const keyOf = (userId: string, calendarId: string, range: CalendarRange) =>
  `${userId}|${calendarId}|${range.start}|${range.end}`;

const RECONNECT = "Google neu verbinden – der Zugang gilt nicht mehr.";

function errorMessage(error: unknown): { message: string; reconnect: boolean } {
  if (error instanceof GoogleAuthError) {
    return error.kind === "reconnect"
      ? { message: RECONNECT, reconnect: true }
      : { message: error.message, reconnect: false };
  }
  if (error instanceof GoogleApiError) return { message: error.message, reconnect: false };
  return { message: "Der Google-Kalender ließ sich nicht laden.", reconnect: false };
}

export async function loadAllSources(
  rows: SourceRow[],
  range: CalendarRange,
  deps: LoadAllDeps,
): Promise<{ events: CalendarEvent[]; sources: CalendarSourceStatus[] }> {
  const now = deps.now ?? Date.now;
  const list = deps.listEvents ?? listGoogleEvents;
  const loadIcal = deps.loadIcal ?? loadSourceEvents;
  const google = rows.filter((r) => r.kind === "google" && r.google_calendar_id);
  const ical = rows.filter((r) => r.kind === "ical");

  // Google: Treffer im Cache, sonst über die Schnittstelle
  const googleResult = new Map<
    string,
    {
      events: CalendarEvent[];
      error: string | null;
      reconnect: boolean;
      writable: boolean;
      primary: boolean;
    }
  >();
  if (google.length > 0) {
    const cached = new Map<string, { page: GoogleEventsPage; primary: boolean }>();
    for (const row of google) {
      const hit = cache.get(keyOf(deps.userId, row.google_calendar_id as string, range));
      if (hit && !deps.fresh && now() - hit.at < GOOGLE_CACHE_MS)
        cached.set(row.id, { page: hit.page, primary: hit.primary });
    }
    const missing = google.filter((r) => !cached.has(r.id));
    let access: GoogleAccess | null = null;
    if (missing.length > 0) {
      try {
        access = await deps.access();
      } catch {
        access = {
          state: "unavailable",
          email: "",
          error: "Das Google-Konto ließ sich nicht laden.",
        };
      }
    }
    for (const row of google) {
      const calendarId = row.google_calendar_id as string;
      const source = { id: row.id, name: row.name, color: row.color, calendarId };
      const hit = cached.get(row.id);
      let page = hit?.page ?? null;
      let primary = hit?.primary ?? false;
      let failure: { message: string; reconnect: boolean } | null = null;
      if (!page) {
        if (!access || access.state === "disconnected" || access.state === "not-configured")
          continue;
        if (access.state === "reconnect")
          failure = { message: access.error || RECONNECT, reconnect: true };
        else if (access.state === "unavailable")
          failure = { message: access.error, reconnect: false };
        else {
          try {
            page = await list(access.endpoints, access.accessToken, calendarId, range);
            // der primäre Kalender trägt die Adresse des Kontos als ID (Standard beim Anlegen)
            primary = calendarId === access.email;
            remember(keyOf(deps.userId, calendarId, range), { at: now(), page, primary });
          } catch (error) {
            failure = errorMessage(error);
          }
        }
      }
      if (page) {
        googleResult.set(row.id, {
          events: normalizeGoogleEvents(page.items, { ...source, accessRole: page.accessRole }),
          error: null,
          reconnect: false,
          writable: page.accessRole === "owner" || page.accessRole === "writer",
          primary,
        });
      } else if (failure) {
        googleResult.set(row.id, {
          events: [],
          error: failure.message,
          reconnect: failure.reconnect,
          writable: false,
          primary: false,
        });
      }
    }
  }

  // iCal: ersetzt nur, was ein erfolgreich geladener Google-Kalender abdeckt
  const loadedGoogleIds = google
    .filter((r) => googleResult.get(r.id) && googleResult.get(r.id)?.error === null)
    .map((r) => r.google_calendar_id as string);
  const replaced = icalReplacedByGoogle(
    ical.map((r) => ({ id: r.id, url: r.url ?? "" })),
    loadedGoogleIds,
  );
  const icalToLoad = ical.filter((r) => !replaced.has(r.id));
  const icalLoaded = new Map(
    await Promise.all(
      icalToLoad.map(
        async (row) =>
          [
            row.id,
            await loadIcal(
              { id: row.id, name: row.name, color: row.color, url: row.url ?? "" },
              range,
              { fresh: deps.fresh },
            ),
          ] as const,
      ),
    ),
  );

  const events: CalendarEvent[] = [];
  const sources: CalendarSourceStatus[] = [];
  for (const row of rows) {
    if (row.kind === "google") {
      const result = googleResult.get(row.id);
      if (!result) continue;
      events.push(...result.events);
      sources.push({
        id: row.id,
        name: row.name,
        color: row.color,
        count: result.events.length,
        error: result.error,
        ...(result.reconnect ? { reconnect: true } : {}),
        // Termine anlegen/ändern darf nur, wer in diesem Google-Kalender Schreibrecht hat (N1c)
        ...(result.writable ? { writable: true } : {}),
        ...(result.primary ? { primary: true } : {}),
      });
    } else {
      const loaded = icalLoaded.get(row.id);
      if (!loaded) continue;
      events.push(...loaded.events);
      sources.push(loaded.status);
    }
  }
  return { events, sources };
}
