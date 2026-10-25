export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

/**
 * Supabase-Zugang aus den öffentlichen Variablen (nur URL + publishable key, nie service_role).
 * Gibt null zurück, wenn nichts konfiguriert ist – die App startet dann trotzdem
 * (Login zeigt einen Hinweis, geschützte Seiten leiten auf /login).
 */
export function getSupabaseConfig(): SupabaseConfig | null {
  // Literal ausgeschrieben, damit Next.js die Werte zur Build-Zeit einsetzt
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase ist nicht konfiguriert (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}
