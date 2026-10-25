/**
 * Zugriffsprüfung für Dateien in R2 (E41) – R2 kennt kein RLS, die Prüfungen liegen hier:
 * - App-Routen: Sitzung aal2 und eigene Origin (`openFileRequest`, Vorbild `openTerminRequest`).
 * - KI (R3): kein aal2, sondern `ai_client_allowed()` mit dem Token der KI (`authorizeAi`);
 *   die KI liest und lädt hoch, listet/löscht nie (`actor: "ai"` sperrt `liste`/`loeschen`).
 * - Besitzer (Notiz/Aufgabe/Projekt/Vorlage) per RLS-Abfrage mit dem Client des Nutzers, nie
 *   service_role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentAuth } from "@/lib/supabase/user";
import { type R2Config, readR2Config } from "./config";
import { isUuid } from "./paths";

export const NO_STORE = { "cache-control": "private, no-store" };

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status, headers: NO_STORE });

export const succeed = (body: Record<string, unknown>) =>
  Response.json(body, { headers: NO_STORE });

export const NOT_AVAILABLE = "Dateien sind hier nicht verfügbar.";

export interface FileContext {
  userId: string;
  /** Client mit dem Token des Nutzers bzw. der KI (RLS) */
  supabase: SupabaseClient<Database>;
  config: R2Config;
  /** „ai“: darf lesen und hochladen, nie auflisten/löschen */
  actor: "app" | "ai";
}

export interface FileRequest {
  context: FileContext;
  body: unknown;
}

/** Sitzung (aal2), Ursprung, R2-Konfiguration und JSON-Eingabe prüfen – oder die Fehlerantwort. */
export async function openFileRequest(request: Request): Promise<FileRequest | Response> {
  let config: R2Config | null;
  try {
    config = readR2Config();
  } catch {
    return fail(503, NOT_AVAILABLE);
  }
  if (!config) return fail(503, NOT_AVAILABLE);
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
  return {
    context: { userId: auth.userId, supabase: await createServerSupabase(), config, actor: "app" },
    body,
  };
}

/**
 * KI-Zugang (R3): Token der KI ist für Dateien freigegeben? Aufruf mit dem Supabase-Client, der
 * das KI-Token trägt (`ai/server/auth.ts`); danach `{ userId, supabase, config, actor: "ai" }`
 * an die Handler in `handlers.ts` geben.
 */
export async function authorizeAi(supabase: SupabaseClient<Database>): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("ai_client_allowed");
    return !error && data === true;
  } catch {
    return false;
  }
}

const OWNER_TABLES = ["notes", "tasks", "projects", "templates"] as const;

/** Gehört der Eintrag (Notiz, Aufgabe, Projekt, Vorlage) dem Nutzer? Per RLS gelesen. */
export async function ownerExists(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<boolean> {
  if (!isUuid(ownerId)) return false;
  const results = await Promise.all(
    OWNER_TABLES.map(async (table) => {
      const { data } = await supabase.from(table).select("id").eq("id", ownerId).maybeSingle();
      return Boolean(data);
    }),
  );
  return results.some(Boolean);
}
