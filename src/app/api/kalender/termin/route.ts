/**
 * Termine in Google über die App (#64, N1b/N1c) – `/api/kalender/termin`:
 * - POST: neuen Termin anlegen → `{ ok, event }` (normalisiert, wie `/api/kalender` ihn liefert)
 * - PATCH: Zeit (verschieben, Dauer) und/oder Titel, Ort, Beschreibung ändern → `{ ok, etag }`
 * - DELETE: Termin löschen (bei Serien nur diese Instanz) → `{ ok }`
 * - GET `?kalender=<Google-Kalender-ID>&id=<Termin-ID>`: einen Termin lesen (#68, Kopf in Notiz
 *   und Aufgabe) → `{ ok, event }`, in Google gelöscht/abgesagt → 404 `{ gone: true }`
 * Nur mit zweitem Faktor und nur von der eigenen Seite (Origin, wie `/api/google/disconnect`).
 * Der Server holt den Kalender der Quelle aus der Datenbank (RLS), ein Zugriffs-Token nur für diese
 * Anfrage und ruft die Calendar API mit `sendUpdates=none` (Gäste bekommen nichts); Änderungen mit
 * `If-Match` (etag). Gäste und Videokonferenz fasst keine dieser Routen an. Fehlerantworten und
 * Zustände: siehe `termin-route.ts`.
 */
import { parseCreateInput, parseDeleteInput } from "@/features/calendar/google/event-input";
import { parsePatchInput } from "@/features/calendar/google/patch-input";
import {
  createEvent,
  findEvent,
  removeEvent,
  updateEvent,
} from "@/features/calendar/server/event-service";
import { clearGoogleEventsCache } from "@/features/calendar/server/load-all";
import {
  connectGoogle,
  fail,
  findGoogleSource,
  googleFailure,
  loadGoogleSource,
  openTerminRequest,
  succeed,
} from "@/features/calendar/server/termin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentAuth } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const auth = await currentAuth();
  if (!auth) return fail(401, "Nicht angemeldet.");
  if (auth.aal !== "aal2") return fail(403, "Zweiter Faktor fehlt.");
  const params = new URL(request.url).searchParams;
  const calendarId = params.get("kalender")?.trim() ?? "";
  const eventId = params.get("id")?.trim() ?? "";
  if (!calendarId || !eventId || calendarId.length > 1024 || eventId.length > 1024) {
    return fail(400, "Kalender und Termin fehlen.");
  }
  const supabase = await createServerSupabase();
  const source = await findGoogleSource(supabase, calendarId);
  const access = await connectGoogle(supabase, auth.userId);
  if (access instanceof Response) return access;
  try {
    const event = await findEvent(access, source, eventId);
    return event
      ? succeed({ ok: true, event })
      : fail(404, "Der Termin existiert in Google nicht mehr.", { gone: true });
  } catch (caught) {
    return googleFailure(caught, auth.userId, "Google ist gerade nicht erreichbar.");
  }
}

export async function POST(request: Request): Promise<Response> {
  const opened = await openTerminRequest(request);
  if (opened instanceof Response) return opened;
  const input = parseCreateInput(opened.body);
  if (!input.ok) return fail(400, input.error);
  const source = await loadGoogleSource(opened.supabase, input.value.sourceId);
  if (source instanceof Response) return source;
  const access = await connectGoogle(opened.supabase, opened.userId);
  if (access instanceof Response) return access;
  try {
    const event = await createEvent(access, source, input.value.event);
    clearGoogleEventsCache(opened.userId);
    return succeed({ ok: true, event });
  } catch (caught) {
    return googleFailure(caught, opened.userId, "Google hat den Termin nicht angenommen.");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const opened = await openTerminRequest(request);
  if (opened instanceof Response) return opened;
  const input = parsePatchInput(opened.body);
  if (!input.ok) return fail(400, input.error);
  const { sourceId, eventId, etag, times, text } = input.value;
  const source = await loadGoogleSource(opened.supabase, sourceId);
  if (source instanceof Response) return source;
  const access = await connectGoogle(opened.supabase, opened.userId);
  if (access instanceof Response) return access;
  try {
    const event = await updateEvent(access, source, { eventId, etag, times, text });
    clearGoogleEventsCache(opened.userId);
    return succeed({ ok: true, etag: event.google?.etag ?? "" });
  } catch (caught) {
    return googleFailure(caught, opened.userId, "Google hat die Änderung nicht angenommen.");
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const opened = await openTerminRequest(request);
  if (opened instanceof Response) return opened;
  const input = parseDeleteInput(opened.body);
  if (!input.ok) return fail(400, input.error);
  const { sourceId, eventId, etag } = input.value;
  const source = await loadGoogleSource(opened.supabase, sourceId);
  if (source instanceof Response) return source;
  const access = await connectGoogle(opened.supabase, opened.userId);
  if (access instanceof Response) return access;
  try {
    await removeEvent(access, source, eventId, etag ?? null);
    clearGoogleEventsCache(opened.userId);
    return succeed({ ok: true });
  } catch (caught) {
    return googleFailure(caught, opened.userId, "Google hat das Löschen nicht angenommen.");
  }
}
