import { getSupabaseConfig } from "./config";
import { createServerSupabase } from "./server";

export interface CurrentAuth {
  userId: string;
  /** „aal2“ erst nach bestätigtem zweitem Faktor (B16) */
  aal: "aal1" | "aal2";
}

/** Angemeldeter Nutzer aus dem geprüften JWT (Server), sonst null. */
export async function currentAuth(): Promise<CurrentAuth | null> {
  if (!getSupabaseConfig()) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (typeof sub !== "string" || sub.length === 0) return null;
  return { userId: sub, aal: data?.claims?.aal === "aal2" ? "aal2" : "aal1" };
}
