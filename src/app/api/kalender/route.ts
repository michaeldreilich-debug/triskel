/**
 * GET /api/kalender?von=JJJJ-MM-TT&bis=JJJJ-MM-TT[&frisch=1] (S2a): Termine aller eingeschalteten
 * Kalenderquellen im Zeitraum, normalisiert auf Europe/Berlin. Läuft mit der Sitzung des Nutzers
 * (Cookie, RLS, aal2); die geheimen Adressen bleiben auf dem Server. Fehler je Quelle stehen im
 * Status, die übrigen Quellen liefern trotzdem.
 */
import { getGoogleAccess } from "@/features/calendar/google/access";
import { parseRange } from "@/features/calendar/server/load";
import { loadAllSources } from "@/features/calendar/server/load-all";
import type { CalendarResponse } from "@/features/calendar/types";
import { parseCalendarColor } from "@/features/calendar/types";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentAuth } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "cache-control": "private, no-store" };

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: NO_STORE });

export async function GET(request: Request): Promise<Response> {
  const auth = await currentAuth();
  if (!auth) return fail(401, "Nicht angemeldet.");
  if (auth.aal !== "aal2") return fail(403, "Zweiter Faktor fehlt.");

  const params = new URL(request.url).searchParams;
  const range = parseRange(params.get("von"), params.get("bis"));
  if (!range) return fail(400, "Zeitraum fehlt oder ist ungültig (von, bis als JJJJ-MM-TT).");
  const fresh = params.get("frisch") === "1";

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("calendar_sources")
    .select("id, kind, name, url, google_calendar_id, color, enabled, sort")
    .is("deleted_at", null)
    .eq("enabled", true)
    .order("sort")
    .order("id");
  if (error) return fail(500, "Kalenderquellen ließen sich nicht laden.");

  const loaded = await loadAllSources(
    (data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind === "google" ? ("google" as const) : ("ical" as const),
      name: row.name,
      url: row.url,
      google_calendar_id: row.google_calendar_id,
      color: parseCalendarColor(row.color),
    })),
    range,
    { access: () => getGoogleAccess(supabase, auth.userId), userId: auth.userId, fresh },
  );
  const events = loaded.events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(b.allDay) - Number(a.allDay) ||
      (a.startMinutes ?? 0) - (b.startMinutes ?? 0) ||
      a.title.localeCompare(b.title, "de") ||
      a.id.localeCompare(b.id),
  );
  const body: CalendarResponse = {
    range,
    events,
    sources: loaded.sources,
    fetchedAt: new Date().toISOString(),
  };
  return Response.json(body, { headers: NO_STORE });
}
