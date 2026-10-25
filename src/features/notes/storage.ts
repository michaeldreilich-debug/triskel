/**
 * Speicherorte und Grenzen für Bilder (E24, Migration 18) und Dateien (#27, Migration 19) – ohne
 * Browser-Code, damit auch der Server sie nutzt (KI-Schnittstelle #33, `attach_file`).
 * Pfad in beiden Buckets: `<user_id>/<notiz-/aufgaben-id>/<uuid>.<ext>`.
 */
export const ATTACHMENT_BUCKET = "attachments";
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const NOTE_IMAGE_BUCKET = "note-images";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Bildtypen, die als Bild (nicht als Datei) in der Notiz stehen, mit Dateiendung. */
export const IMAGE_EXT: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
