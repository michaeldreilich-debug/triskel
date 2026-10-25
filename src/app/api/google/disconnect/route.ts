/**
 * POST /api/google/disconnect (#64, N1a): „Trennen“ in Einstellungen › Kalender. Nur mit zweitem
 * Faktor und nur von der eigenen Seite (Origin). Widerruft den Zugang bei Google und leert den
 * Token in der Datenbank (deleted_at) – auch, wenn Google gerade nicht antwortet; `revoked` sagt,
 * ob Google den Widerruf bestätigt hat. Die gewählten Google-Kalender bleiben für ein späteres
 * Neu-Verbinden stehen.
 */
import { disconnectGoogleAccount } from "@/features/calendar/google/access";
import { clearGoogleEventsCache } from "@/features/calendar/server/load-all";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentAuth } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "cache-control": "private, no-store" };

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  const auth = await currentAuth();
  if (!auth) return fail(401, "Nicht angemeldet.");
  if (auth.aal !== "aal2") return fail(403, "Zweiter Faktor fehlt.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, "Fremder Ursprung.");
  try {
    const result = await disconnectGoogleAccount(await createServerSupabase(), auth.userId);
    // ohne Verbindung keine Google-Termine mehr aus dem Speicher (G-5)
    clearGoogleEventsCache(auth.userId);
    return Response.json({ ok: true, revoked: result.revoked }, { headers: NO_STORE });
  } catch {
    return fail(500, "Das Google-Konto ließ sich nicht trennen.");
  }
}
