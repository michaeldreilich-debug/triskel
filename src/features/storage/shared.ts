/**
 * Dateien einer öffentlich freigegebenen Notiz (#94, E42) – der einzige Weg zu einer Datei ohne
 * Anmeldung. Ablauf von `GET /api/freigabe/<token>/datei?pfad=…`:
 *   1. Format von Token und Pfad (sonst 404 – von außen kein Unterschied zu „gibt es nicht“),
 *   2. R2 eingerichtet (sonst 503),
 *   3. `shared_note_file` (anon, Migration 45): aktive Freigabe, Notiz nicht im Papierkorb, Pfad im
 *      Ordner des Besitzers und als Bild bzw. Datei in einem nicht gelöschten Block (sonst 404),
 *   4. 302 auf einen signierten GET-Link (60 s, F-2) mit festem Typ: Bilder `inline` nur als
 *      Bildtyp, PDFs `inline` als PDF, alles andere zum Herunterladen (nie als Seite, auch nicht
 *      bei R2); R2 antwortet mit `cache-control: no-store` (mitsigniert).
 * Nie `service_role`, der Pfad geht nur geprüft an R2; jede Antwort `private, no-store`.
 * Nach „Freigabe beenden“ bleibt ein schon ausgegebener Link höchstens 60 s gültig.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_EXT, NOTE_IMAGE_BUCKET } from "@/features/notes/storage";
import { fileExt } from "@/features/outliner/model/files";
import { isShareToken } from "@/features/share/token";
import type { Database } from "@/lib/supabase/database.types";
import type { R2Config } from "./config";
import { isMediaBucket, isMediaPath, type MediaBucket, objectKey } from "./paths";
import { type GetOverrides, presignGet } from "./signing";

/** Kopfzeilen jeder Antwort unter /freigabe und /api/freigabe (auch in next.config.ts). */
export const SHARE_RESPONSE_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
} as const;

/** Bucket der Datei in der freigegebenen Notiz oder null (Prüfung in der Datenbank). */
export type SharedFileLookup = (token: string, path: string) => Promise<MediaBucket | null>;

/** `shared_note_file` mit einem Client ohne Anmeldung (anon); Fehler → Ausnahme (502). */
export function sharedFileLookup(db: SupabaseClient<Database>): SharedFileLookup {
  return async (token, path) => {
    const { data, error } = await db.rpc("shared_note_file", { p_token: token, p_path: path });
    if (error) throw new Error("shared_note_file fehlgeschlagen");
    return isMediaBucket(data) ? data : null;
  };
}

const respond = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { ...SHARE_RESPONSE_HEADERS, "content-type": "text/plain; charset=utf-8" },
  });

const IMAGE_TYPE: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(IMAGE_EXT).map(([type, ext]) => [ext, type])),
  jpeg: "image/jpeg",
};

/**
 * Dateiname zum Herunterladen: Name aus der Notiz (nur lesbare Zeichen, höchstens 120), die
 * Endung immer die des gespeicherten Pfads – ein Link kann eine Datei nicht „umtaufen“.
 */
export function downloadName(name: string | null | undefined, path: string): string {
  const ext = fileExt(path);
  const base =
    (name ?? "")
      .replace(/\.[^.]*$/, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen gezielt entfernen
      .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Datei";
  return `${base}.${ext}`;
}

/** Content-Disposition mit ASCII-Ersatz und UTF-8-Namen (RFC 6266/5987). */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Signaturdauer öffentlicher Datei-Links (F-2): kurz, damit „Freigabe beenden“ schnell greift. */
export const SHARED_LINK_SECONDS = 60;

/** Fester Typ und Art der Antwort von R2 (statt dessen, was beim Hochladen angegeben wurde). */
export function sharedFileOverrides(
  bucket: MediaBucket,
  path: string,
  name?: string | null,
): GetOverrides {
  const ext = fileExt(path);
  const cacheControl = "no-store";
  if (bucket === NOTE_IMAGE_BUCKET) {
    const type = IMAGE_TYPE[ext];
    if (type) return { contentType: type, contentDisposition: "inline", cacheControl };
    return {
      contentDisposition: contentDisposition("attachment", downloadName(name, path)),
      cacheControl,
    };
  }
  if (ext === "pdf") {
    return {
      contentType: "application/pdf",
      contentDisposition: contentDisposition("inline", downloadName(name, path)),
      cacheControl,
    };
  }
  return {
    contentDisposition: contentDisposition("attachment", downloadName(name, path)),
    cacheControl,
  };
}

export async function handleSharedFile(
  input: { token: string; path: string | null; name: string | null },
  deps: { config: R2Config | null; lookup: SharedFileLookup },
): Promise<Response> {
  const { token, path } = input;
  if (!isShareToken(token) || !isMediaPath(path)) return respond(404, "Nicht gefunden.");
  if (!deps.config) return respond(503, "Dateien sind hier nicht verfügbar.");
  let bucket: MediaBucket | null;
  try {
    bucket = await deps.lookup(token, path);
  } catch {
    return respond(502, "Gerade nicht erreichbar.");
  }
  if (!bucket) return respond(404, "Nicht gefunden.");
  const url = await presignGet(
    deps.config,
    objectKey(bucket, path),
    SHARED_LINK_SECONDS,
    sharedFileOverrides(bucket, path, input.name),
  );
  return new Response(null, { status: 302, headers: { ...SHARE_RESPONSE_HEADERS, location: url } });
}
