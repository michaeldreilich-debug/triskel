/**
 * Freigegebene Notiz auf dem Server laden (#94, E42): `shared_note` mit dem Client ohne Anmeldung
 * (anon, keine Cookies, nie service_role). Je Anfrage nur einmal (Metadaten und Seite teilen sich
 * den Aufruf über `cache`).
 */
import { cache } from "react";
import { createAnonSupabase } from "@/lib/supabase/anon";
import { parseSharedNote, type SharedNote } from "./model";
import { isShareToken } from "./token";

/** Notiz zum Token oder null (unbekannt, beendet, im Papierkorb); Datenbankfehler werfen. */
export const loadSharedNote = cache(async (token: string): Promise<SharedNote | null> => {
  if (!isShareToken(token)) return null;
  const { data, error } = await createAnonSupabase().rpc("shared_note", { p_token: token });
  if (error) throw new Error("Die Freigabe konnte nicht geladen werden.");
  return parseSharedNote(data);
});
