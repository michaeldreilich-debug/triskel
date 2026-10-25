import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, SupabaseNotConfiguredError } from "./config";
import type { Database } from "./database.types";

/**
 * Supabase-Client ohne Anmeldung (Rolle anon, nur publishable key, keine Cookies, keine Sitzung) –
 * ausschließlich für die öffentliche Freigabe (#94): anon darf dort nur `shared_note` und
 * `shared_note_file` aufrufen (Migration 45), sonst nichts. Nie service_role.
 */
export function createAnonSupabase() {
  const config = getSupabaseConfig();
  if (!config) throw new SupabaseNotConfiguredError();
  return createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
