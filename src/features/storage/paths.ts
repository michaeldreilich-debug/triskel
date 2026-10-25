/**
 * Pfade und Schlüssel der Dateien in R2 (E41) – rein, ohne Umgebung und Netz.
 * Pfad wie bisher `<user_id>/<owner_id>/<uuid>.<ext>` je Bucket (`note-images`, `attachments`);
 * im R2-Bucket liegt alles unter `<alter bucket>/<pfad>`.
 */

import {
  ATTACHMENT_BUCKET,
  IMAGE_EXT,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  NOTE_IMAGE_BUCKET,
} from "@/features/notes/storage";
import { fileExt } from "@/features/outliner/model/files";

export const MEDIA_BUCKETS = [NOTE_IMAGE_BUCKET, ATTACHMENT_BUCKET] as const;
export type MediaBucket = (typeof MEDIA_BUCKETS)[number];

export const isMediaBucket = (value: unknown): value is MediaBucket =>
  typeof value === "string" && (MEDIA_BUCKETS as readonly string[]).includes(value);

const OWNER_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_SEGMENT = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,10}$/;
/** Nur die kanonische Form (klein): sonst lägen Dateien unter `ABC…` neben `abc…` und das Aufräumen fände sie nicht. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

export const isOwnerSegment = (value: unknown): value is string =>
  typeof value === "string" && OWNER_SEGMENT.test(value);

/**
 * Pfad im eigenen Ordner: `<user_id>/<eintrag>/<datei>.<ext>` – genau drei Teile, die eigene
 * user_id vorn, keine Punkte außer vor der Endung (also auch kein `..`).
 */
export function isOwnPath(path: string, userId: string): boolean {
  if (typeof path !== "string" || !userId) return false;
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    parts[0] === userId &&
    OWNER_SEGMENT.test(parts[1] ?? "") &&
    FILE_SEGMENT.test(parts[2] ?? "")
  );
}

/**
 * Pfad in irgendeinem Nutzer-Ordner: `<user_id>/<eintrag>/<datei>.<ext>` (Form wie `isOwnPath`,
 * Nutzer als UUID). Nur für die öffentliche Freigabe (#94): wem der Pfad gehört, prüft dort
 * `shared_note_file` in der Datenbank.
 */
export function isMediaPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length > 300) return false;
  const user = path.split("/")[0];
  return isUuid(user) && isOwnPath(path, user);
}

/** Schlüssel im R2-Bucket: `<alter bucket>/<pfad>`. */
export const objectKey = (bucket: MediaBucket, path: string) => `${bucket}/${path}`;

/** Präfix eines Besitzer-Ordners (mit Schrägstrich am Ende) für die Liste. */
export const folderPrefix = (bucket: MediaBucket, userId: string, ownerId: string) =>
  `${bucket}/${userId}/${ownerId}/`;

/** Schlüssel → Bucket und Pfad (nur gültige Medien-Schlüssel), sonst null. */
export function parseKey(key: string): { bucket: MediaBucket; path: string } | null {
  const slash = key.indexOf("/");
  if (slash < 0) return null;
  const bucket = key.slice(0, slash);
  return isMediaBucket(bucket) ? { bucket, path: key.slice(slash + 1) } : null;
}

export const maxBytesFor = (bucket: MediaBucket) =>
  bucket === NOTE_IMAGE_BUCKET ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** Einfache MIME-Form (ohne Parameter), klein geschrieben; leer → `application/octet-stream`. */
export function normalizeContentType(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "application/octet-stream";
  if (typeof value !== "string") return null;
  const type = value.trim().toLowerCase();
  return MIME.test(type) ? type : null;
}

export type UploadPlan =
  | { ok: true; path: string; contentType: string; size: number }
  | { ok: false; error: string };

/** Prüft Typ und Größe und bildet den neuen Pfad `<user>/<owner>/<uuid>.<ext>`. */
export function planUpload(input: {
  bucket: MediaBucket;
  userId: string;
  ownerId: string;
  contentType: unknown;
  size: unknown;
  name?: unknown;
  uuid?: string;
}): UploadPlan {
  const { bucket, userId, ownerId } = input;
  if (!isOwnerSegment(ownerId)) return { ok: false, error: "Ungültiger Eintrag." };
  const contentType = normalizeContentType(input.contentType);
  if (!contentType) return { ok: false, error: "Ungültiger Dateityp." };
  const size = input.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return { ok: false, error: "Die Datei ist leer." };
  }
  if (size > maxBytesFor(bucket)) {
    return {
      ok: false,
      error: `Die Datei ist größer als ${maxBytesFor(bucket) / (1024 * 1024)} MB.`,
    };
  }
  let ext: string;
  if (bucket === NOTE_IMAGE_BUCKET) {
    const known = IMAGE_EXT[contentType];
    if (!known) return { ok: false, error: "Dieser Bildtyp wird nicht unterstützt." };
    ext = known;
  } else {
    ext = fileExt(typeof input.name === "string" ? input.name : "");
  }
  const path = `${userId}/${ownerId}/${input.uuid ?? crypto.randomUUID()}.${ext}`;
  return { ok: true, path, contentType, size };
}
