/**
 * GET /api/google/calendars (#64, N1a): die Google-Kalenderliste (ID, Name, Farbe als
 * Token-Schlüssel, Zugriff, primär) für Einstellungen › Kalender. Holt dafür einen Zugriffs-Token
 * nur für diese Anfrage. Nimmt Google den Zugang nicht mehr an (widerrufen, abgelaufen), antwortet
 * die Route mit `state: "reconnect"` – die Einstellungen zeigen dann „Neu verbinden“.
 */
import { getGoogleAccess } from "@/features/calendar/google/access";
import { listGoogleCalendars } from "@/features/calendar/google/calendar-api";
import { GoogleAuthError } from "@/features/calendar/google/oauth";
import type {
  GoogleCalendarsResponse,
  GoogleErrorBody,
  GoogleProblem,
} from "@/features/calendar/google/types";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentAuth } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "cache-control": "private, no-store" };

const problem = (status: number, state: GoogleProblem, error: string) =>
  Response.json({ error, state } satisfies GoogleErrorBody, { status, headers: NO_STORE });

export async function GET(): Promise<Response> {
  const auth = await currentAuth();
  if (!auth)
    return Response.json({ error: "Nicht angemeldet." }, { status: 401, headers: NO_STORE });
  if (auth.aal !== "aal2") {
    return Response.json({ error: "Zweiter Faktor fehlt." }, { status: 403, headers: NO_STORE });
  }
  let access: Awaited<ReturnType<typeof getGoogleAccess>>;
  try {
    access = await getGoogleAccess(await createServerSupabase(), auth.userId);
  } catch {
    return problem(500, "unavailable", "Das Google-Konto ließ sich nicht laden.");
  }
  if (access.state === "not-configured") return problem(503, "not-configured", access.error);
  if (access.state === "disconnected")
    return problem(409, "disconnected", "Nicht mit Google verbunden.");
  if (access.state === "reconnect") return problem(409, "reconnect", access.error);
  if (access.state === "unavailable") return problem(502, "unavailable", access.error);
  try {
    const calendars = await listGoogleCalendars(access.endpoints, access.accessToken);
    return Response.json({ calendars } satisfies GoogleCalendarsResponse, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof GoogleAuthError && error.kind === "reconnect") {
      return problem(409, "reconnect", error.message);
    }
    return problem(502, "unavailable", "Die Google-Kalenderliste ließ sich nicht laden.");
  }
}
