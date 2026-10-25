import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig, SupabaseNotConfiguredError } from "./config";
import type { Database } from "./database.types";

export type Supabase = SupabaseClient<Database>;

/**
 * Supabase-Client im Browser (E1: Daten laufen client-first über supabase-js + RLS).
 * Typen: database.types.ts, erzeugt mit `npm run db:types` aus dem Testprojekt.
 */
export function createClient(): Supabase {
  const config = getSupabaseConfig();
  if (!config) throw new SupabaseNotConfiguredError();
  return createBrowserClient<Database>(config.url, config.publishableKey, {
    // Wiederholen übernehmen TanStack Query (Lesen) und die Speicher-Warteschlange (Schreiben);
    // ein zweiter Retry darunter würde Fehlermeldungen um bis zu 7 s je Versuch verzögern.
    db: { retry: false },
  });
}
