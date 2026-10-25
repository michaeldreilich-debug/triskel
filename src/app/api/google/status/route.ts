/**
 * GET /api/google/status (#64, N1a): eingerichtet (Werte in Vercel), verbunden, E-Mail – für
 * Einstellungen › Kalender. Fragt Google nicht (schnell) und nennt nie den Token; ob Google den
 * Zugang noch annimmt, zeigt GET /api/google/calendars.
 */
import { readGoogleStatus } from "@/features/calendar/google/access";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentAuth } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: NO_STORE });

export async function GET(): Promise<Response> {
  const auth = await currentAuth();
  if (!auth) return fail(401, "Nicht angemeldet.");
  if (auth.aal !== "aal2") return fail(403, "Zweiter Faktor fehlt.");
  try {
    return Response.json(await readGoogleStatus(await createServerSupabase()), {
      headers: NO_STORE,
    });
  } catch {
    return fail(500, "Der Stand der Google-Verbindung ließ sich nicht laden.");
  }
}
