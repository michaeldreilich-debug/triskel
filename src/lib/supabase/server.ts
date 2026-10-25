import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig, SupabaseNotConfiguredError } from "./config";
import type { Database } from "./database.types";

/** Supabase-Client für Server Components und Route Handler (nur Auth, keine Datenschicht). */
export async function createServerSupabase() {
  const config = getSupabaseConfig();
  if (!config) throw new SupabaseNotConfiguredError();
  const cookieStore = await cookies();
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // In Server Components nicht erlaubt – der Proxy erneuert die Session ohnehin.
        }
      },
    },
  });
}
