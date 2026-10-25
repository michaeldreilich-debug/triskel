/**
 * Kontext eines MCP-Aufrufs (#33): Supabase-Client mit dem OAuth-Token des Nutzers (RLS,
 * MFA-Pflicht, Trigger und RPCs wie in der App), Links in die App und das KI-Protokoll.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { R2Config } from "@/features/storage/config";
import { appPath } from "@/lib/app-links";
import type { Database, Json } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

export type Entity =
  | "notiz"
  | "aufgabe"
  | "projekt"
  | "meilenstein"
  | "thema"
  | "rueckblick"
  | "termin";

export interface AiContext {
  db: Db;
  userId: string;
  /** OAuth-Client aus dem Token (Claude, ChatGPT …) */
  clientId: string;
  /** Ursprung der App (für Links), z. B. https://…vercel.app */
  origin: string;
  /** „Jetzt“ – in Tests fest */
  now: () => Date;
  /** R2-Zugang für Dateien; nur in Tests gesetzt (sonst aus der Umgebung, `null` = nicht eingerichtet) */
  r2?: R2Config | null;
}

/** Links in die App: dieselben Ziele wie Suche und Listen der App. */
export const appUrl = {
  project: (origin: string, id: string) => `${origin}${appPath.project(id)}`,
  note: (origin: string, id: string) => `${origin}${appPath.note(id)}`,
  task: (origin: string, id: string) => `${origin}${appPath.task(id)}`,
  recap: (origin: string, id: string) => `${origin}${appPath.recap(id)}`,
  calendar: (origin: string, date: string, view: "tag" | "woche" | "monat" | "liste" = "woche") =>
    `${origin}${appPath.calendar(date, view)}`,
};

/** Markdown-Verweis mit ID, damit die KI damit weiterarbeiten kann. */
export const ref = (title: string, url: string, id: string) =>
  `[${title.trim() || "Ohne Titel"}](${url}) (id: ${id})`;

/** Fehler von PostgREST/Postgres, wie Supabase ihn liefert */
export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

/** Feste Texte je Fehlercode (K-7): Tabellen-, Policy- und Constraint-Namen bleiben innen. */
const DB_ERROR_TEXTS: Record<string, string> = {
  "23505": "ein gleicher Eintrag existiert schon",
  "23503": "der Verweis zeigt auf einen Eintrag, den es nicht (mehr) gibt",
  "23502": "ein Pflichtfeld fehlt",
  "23514": "ein Wert ist nicht zulässig",
  "22001": "ein Wert ist zu lang",
  "22P02": "ein Wert hat das falsche Format",
  "22007": "ein Datum hat das falsche Format",
  "22008": "ein Datum liegt außerhalb des gültigen Bereichs",
  "42501": "keine Berechtigung (KI-Zugang nicht freigegeben oder nicht erlaubt)",
  "42703": "ein Feld ist unbekannt",
  "40001": "gleichzeitige Änderung – bitte noch einmal versuchen",
  "57014": "Zeitüberschreitung in der Datenbank",
  PGRST116: "kein (eindeutiger) Eintrag gefunden",
  PGRST204: "ein Feld ist unbekannt",
  PGRST301: "die Anmeldung ist abgelaufen",
};

/**
 * Eigene Meldungen aus Triggern und RPCs (deutsch, für Menschen und die KI gedacht) gehen
 * durch: `raise exception` ohne Code (P0001), „nicht gefunden“ (P0002), ungültige Eingabe
 * (22023) und die Freigabe-Sperre (Migration 46, 42501 mit unserem Text).
 */
const OWN_MESSAGE_CODES = new Set(["P0001", "P0002", "22023", "22004"]);
const SHARED_LOCK_PREFIX = "Diese Notiz ist öffentlich freigegeben";

/** Fehler aus Supabase als fester Text (K-7) – ohne interne Namen, nie die rohe Meldung. */
export function describeDbError(cause: DbErrorLike | null | undefined): string {
  if (!cause) return "";
  const code = cause.code ?? "";
  const message = cause.message?.trim() ?? "";
  if (OWN_MESSAGE_CODES.has(code) && message) return message;
  if (code === "42501" && message.startsWith(SHARED_LOCK_PREFIX)) return message;
  const text = DB_ERROR_TEXTS[code];
  if (text) return text;
  return code ? `Datenbankfehler (${code})` : "Datenbankfehler";
}

/** Fehler aus Supabase als lesbarer Text (geht an die KI). */
export class DataError extends Error {
  constructor(what: string, cause: DbErrorLike | null | undefined) {
    const detail = describeDbError(cause);
    super(`${what} fehlgeschlagen${detail ? `: ${detail}` : ""}`);
    this.name = "DataError";
  }
}

export function check<T>(what: string, result: { data: T | null; error: DbErrorLike | null }): T {
  if (result.error || result.data === null) throw new DataError(what, result.error);
  return result.data;
}

export interface ActivityEntry {
  tool: string;
  entity: Entity;
  entityId: string | null;
  summary: string;
  /** was sich zurückholen lässt (Einstellungen › KI-Zugänge) */
  undo?: Record<string, unknown> | null;
}

/**
 * Schreibaktion ins KI-Protokoll (Migration 20). Scheitert das, scheitert der Aufruf (K-5): Das
 * Protokoll ist der einzige Ort für das Rückgängig – Werkzeuge, die Bestehendes ersetzen
 * (update_note, update_task, attach_file), schreiben es deshalb **vor** der Änderung und ändern
 * bei einem Fehler nichts.
 */
export async function logActivity(ctx: AiContext, entry: ActivityEntry): Promise<void> {
  const { error } = await ctx.db.from("ai_activity").insert({
    client_id: ctx.clientId,
    tool: entry.tool,
    entity: entry.entity,
    entity_id: entry.entityId,
    summary: entry.summary.slice(0, 1000),
    undo: (entry.undo ?? null) as Json,
  });
  if (error) throw new DataError("KI-Protokoll schreiben", error);
}
