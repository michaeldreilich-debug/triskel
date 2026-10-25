/**
 * Gemeinsamer Unterbau der Termin-Routen `/api/kalender/termin*` (#64, N1b/N1c): Sitzung (aal2),
 * Origin-Prüfung, Eingabe lesen, Kalenderquelle und Google-Zugang holen, Fehler in Antworten
 * übersetzen. Nie ein Token in Antwort oder Log.
 *
 * Fehlerantworten: 412 `{ conflict: true }` (in Google inzwischen geändert), 409
 * `{ state: "reconnect" | "disconnected" }`, 503 nicht eingerichtet, 502 Google nicht erreichbar,
 * 403 nicht erlaubt, 404 `{ gone: true }` (Termin weg).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAccess } from "@/features/calendar/google/access";
import { GoogleApiError } from "@/features/calendar/google/calendar-api";
import { GoogleAuthError } from "@/features/calendar/google/oauth";
import type { Database } from "@/lib/supabase/database.types";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentAuth } from "@/lib/supabase/user";
import { parseCalendarColor } from "../types";
import type { ConnectedAccess, GoogleSourceInfo } from "./event-service";
import { clearGoogleEventsCache } from "./load-all";

export const NO_STORE = { "cache-control": "private, no-store" };

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status, headers: NO_STORE });

export const succeed = (body: Record<string, unknown>) =>
  Response.json(body, { headers: NO_STORE });

export interface TerminRequest {
  userId: string;
  supabase: SupabaseClient<Database>;
  body: unknown;
}

/** Sitzung, Ursprung und JSON-Eingabe prüfen – oder die fertige Fehlerantwort. */
export async function openTerminRequest(request: Request): Promise<TerminRequest | Response> {
  const auth = await currentAuth();
  if (!auth) return fail(401, "Nicht angemeldet.");
  if (auth.aal !== "aal2") return fail(403, "Zweiter Faktor fehlt.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, "Fremder Ursprung.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Eingabe fehlt.");
  }
  return { userId: auth.userId, supabase: await createServerSupabase(), body };
}

/** Google-Kalender-Quelle des Nutzers (RLS) – oder 404/500. */
export async function loadGoogleSource(
  supabase: SupabaseClient<Database>,
  sourceId: string,
): Promise<GoogleSourceInfo | Response> {
  const { data, error } = await supabase
    .from("calendar_sources")
    .select("id, name, color, kind, google_calendar_id")
    .eq("id", sourceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return fail(500, "Die Kalenderquelle ließ sich nicht laden.");
  if (data?.kind !== "google" || !data.google_calendar_id) {
    return fail(404, "Dieser Kalender ist kein Google-Kalender.");
  }
  return {
    id: data.id,
    name: data.name,
    color: parseCalendarColor(data.color),
    calendarId: data.google_calendar_id,
  };
}

/**
 * Kalenderquelle zu einer Google-Kalender-ID (#68: Verknüpfungen kennen nur sie). Ist der Kalender
 * in der App nicht (mehr) eingetragen, reicht die ID – Name und Farbe sind dann neutral.
 */
export async function findGoogleSource(
  supabase: SupabaseClient<Database>,
  calendarId: string,
): Promise<GoogleSourceInfo> {
  const { data } = await supabase
    .from("calendar_sources")
    .select("id, name, color")
    .eq("kind", "google")
    .eq("google_calendar_id", calendarId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return {
    id: data?.id ?? calendarId,
    name: data?.name ?? "Google Kalender",
    color: parseCalendarColor(data?.color),
    calendarId,
  };
}

/** Zugriffs-Token für diese Anfrage – oder die Antwort zum jeweiligen Zustand. */
export async function connectGoogle(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ConnectedAccess | Response> {
  let access: Awaited<ReturnType<typeof getGoogleAccess>>;
  try {
    access = await getGoogleAccess(supabase, userId);
  } catch {
    return fail(500, "Das Google-Konto ließ sich nicht laden.");
  }
  switch (access.state) {
    case "connected":
      return { endpoints: access.endpoints, accessToken: access.accessToken };
    case "reconnect":
      return fail(409, access.error, { state: "reconnect" });
    case "not-configured":
      return fail(503, access.error, { state: "not-configured" });
    case "disconnected":
      return fail(409, "Nicht mit Google verbunden.", { state: "disconnected" });
    default:
      return fail(502, access.error, { state: "unavailable" });
  }
}

/** Fehler von Google in eine Antwort übersetzen; nach einem Fehler vom Server-Cache lösen. */
export function googleFailure(caught: unknown, userId: string, fallback: string): Response {
  if (caught instanceof GoogleAuthError) {
    return caught.kind === "reconnect"
      ? fail(409, caught.message, { state: "reconnect" })
      : fail(502, caught.message, { state: "unavailable" });
  }
  if (caught instanceof GoogleApiError) {
    clearGoogleEventsCache(userId);
    if (caught.status === 412) {
      return fail(412, "Der Termin wurde in Google inzwischen geändert.", { conflict: true });
    }
    if (caught.status === 403) return fail(403, "Google erlaubt das für diesen Termin nicht.");
    if (caught.status === 404 || caught.status === 410) {
      return fail(404, "Der Termin existiert in Google nicht mehr.", { gone: true });
    }
    if (caught.status === 400) return fail(400, "Google hat die Angaben abgelehnt.");
  }
  return fail(502, fallback);
}
