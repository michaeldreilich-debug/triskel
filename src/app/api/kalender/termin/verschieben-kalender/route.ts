/**
 * POST /api/kalender/termin/verschieben-kalender (#64, N1c): einen Termin in einen anderen
 * Google-Kalender legen (`events.move`, `If-Match`, `sendUpdates=none`) → `{ ok, event }` (der
 * Termin im Zielkalender, normalisiert). Zielkalender muss Schreibrecht haben, sonst lehnt Google
 * ab (403). Fehlerantworten und Zustände: siehe `termin-route.ts`.
 */
import { parseMoveCalendarInput } from "@/features/calendar/google/event-input";
import { moveEventToCalendar } from "@/features/calendar/server/event-service";
import { clearGoogleEventsCache } from "@/features/calendar/server/load-all";
import {
  connectGoogle,
  fail,
  googleFailure,
  loadGoogleSource,
  openTerminRequest,
  succeed,
} from "@/features/calendar/server/termin-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const opened = await openTerminRequest(request);
  if (opened instanceof Response) return opened;
  const input = parseMoveCalendarInput(opened.body);
  if (!input.ok) return fail(400, input.error);
  const { sourceId, destinationSourceId, eventId, etag } = input.value;
  const from = await loadGoogleSource(opened.supabase, sourceId);
  if (from instanceof Response) return from;
  const to = await loadGoogleSource(opened.supabase, destinationSourceId);
  if (to instanceof Response) return to;
  const access = await connectGoogle(opened.supabase, opened.userId);
  if (access instanceof Response) return access;
  try {
    const event = await moveEventToCalendar(access, from, to, eventId, etag);
    clearGoogleEventsCache(opened.userId);
    return succeed({ ok: true, event });
  } catch (caught) {
    return googleFailure(caught, opened.userId, "Google hat den Kalenderwechsel nicht angenommen.");
  }
}
