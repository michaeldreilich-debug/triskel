/**
 * POST /api/kalender/probe { url } (S2a): Probe-Abruf aus Einstellungen › Kalender – prüft die
 * Adresse, lädt frisch (ohne Cache) und nennt Kalendername, Anzahl der nächsten 30 Tage und die
 * nächsten drei Termine. Nur mit Sitzung (aal2) und nur von der eigenen Seite (Origin-Prüfung).
 * Die Adresse kommt aus dem Eingabefeld und wird hier nicht gespeichert.
 */
import { probeCalendar } from "@/features/calendar/server/load";
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

  let url = "";
  try {
    const body = (await request.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url : "";
  } catch {
    return fail(400, "Anfrage ohne Adresse.");
  }
  if (!url.trim()) return fail(400, "Adresse fehlt.");
  return Response.json(await probeCalendar(url), { headers: NO_STORE });
}
