/**
 * POST /api/kalender/termin/wiederherstellen (#64, N1c): einen gelöschten Termin zurückholen –
 * zuerst derselbe Termin aus Googles Papierkorb (`events.patch` mit `status: "confirmed"`), sonst
 * neu mit allen mitgegebenen Angaben angelegt. Antwort `{ ok, event, how: "same" | "new" }`
 * (`event.google.eventId` kann bei „new“ anders sein). Das ist das „Rückgängig“ von „Löschen“.
 * Fehlerantworten und Zustände: siehe `termin-route.ts`.
 */
import { parseRestoreInput } from "@/features/calendar/google/event-input";
import { restoreEvent } from "@/features/calendar/server/event-service";
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
  const input = parseRestoreInput(opened.body);
  if (!input.ok) return fail(400, input.error);
  const source = await loadGoogleSource(opened.supabase, input.value.sourceId);
  if (source instanceof Response) return source;
  const access = await connectGoogle(opened.supabase, opened.userId);
  if (access instanceof Response) return access;
  try {
    const restored = await restoreEvent(access, source, input.value.eventId, input.value.event);
    clearGoogleEventsCache(opened.userId);
    return succeed({ ok: true, event: restored.event, how: restored.how });
  } catch (caught) {
    return googleFailure(caught, opened.userId, "Google hat das Zurückholen nicht angenommen.");
  }
}
