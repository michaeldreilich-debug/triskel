/**
 * Öffentlich freigegebene Notizen (#94, E42, Migration 46): Die KI sieht die Freigaben selbst nicht,
 * fragt aber über `note_share_active` (nur eigene Notizen, nur ja/nein), ob eine Notiz gerade
 * öffentlich ist. Ihre Werkzeuge ändern eine freigegebene Notiz nie – über den öffentlichen Link
 * wäre sonst lesbar, was die KI (etwa nach einer Prompt-Injection) hineinschreibt. Die Datenbank
 * sperrt Titel und Inhalt für KI-Tokens zusätzlich mit derselben Meldung.
 */
import { type AiContext, DataError } from "./context";
import { ToolInputError } from "./resolve";

export const SHARED_NOTE_LOCKED =
  "Diese Notiz ist öffentlich freigegeben – die KI kann sie nicht ändern. Der Nutzer ändert sie in der App oder beendet die Freigabe.";

/** Hinweis in „fetch“ einer freigegebenen Notiz. */
export const SHARED_NOTE_HINT =
  "> Öffentlich freigegeben: Jeder mit dem Link sieht Titel und Inhalt dieser Notiz. Die KI kann sie nicht ändern.";

/** Hinweis, wenn trash/convert eine freigegebene Notiz in den Papierkorb legen (K-3). */
export const SHARED_NOTE_TRASHED =
  "Die Notiz war öffentlich freigegeben: Der öffentliche Link zeigt ab jetzt nichts mehr; die Freigabe bleibt bestehen und gilt wieder, sobald die Notiz aus dem Papierkorb zurückkommt (der Nutzer beendet sie unter Einstellungen › Freigaben).";

export async function isNoteShared(ctx: AiContext, noteId: string): Promise<boolean> {
  const { data, error } = await ctx.db.rpc("note_share_active", { p_note_id: noteId });
  if (error) throw new DataError("Freigabe prüfen", error);
  return data === true;
}

/** Vor jeder Änderung an einer Notiz durch die KI: freigegeben → verständlicher Fehler. */
export async function assertNoteNotShared(ctx: AiContext, noteId: string): Promise<void> {
  if (await isNoteShared(ctx, noteId)) throw new ToolInputError(SHARED_NOTE_LOCKED);
}
