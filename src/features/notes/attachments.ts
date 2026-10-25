"use client";

/**
 * Dateien in Notizen und Aufgaben (Rückmeldung #27, E26, aus Stufe 4 vorgezogen): liegen seit E41
 * in Cloudflare R2 (Schlüssel `attachments/<user_id>/<notiz-/aufgaben-id>/<uuid>.<ext>`); Name,
 * Größe und Typ stehen im Knoten des Editors.
 * - Höchstens 100 MB, alle Dateitypen.
 * - Laden über einen kurzlebigen signierten Link als Blob (kein Link im DOM).
 * - Sicherheit: Nur PDFs öffnet die App im Browser (als `application/pdf`). Alles andere wird
 *   heruntergeladen – eine HTML- oder SVG-Datei liefe als Seite im eigenen Ursprung sonst mit
 *   Zugriff auf die Sitzung.
 */
import { exportFileName, fileExt } from "@/features/outliner/model/files";
import type { UploadTarget } from "./media-api";
import { createBucketCache, visitMediaNodes } from "./media-store";
import { ATTACHMENT_BUCKET, MAX_FILE_BYTES } from "./storage";

export { ATTACHMENT_BUCKET, exportFileName, fileExt, MAX_FILE_BYTES };

export interface FileInfo {
  name: string;
  size: number;
  mime: string;
}

export const isPdf = (file: Pick<FileInfo, "mime" | "name">) =>
  file.mime === "application/pdf" || /\.pdf$/i.test(file.name);

/** „820 KB“, „2,4 MB“ (deutsch, kurz). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString("de-DE", { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

/** Kurzbeschreibung unter dem Namen: „PDF · 2,4 MB“, „DOCX · 80 KB“. */
export function fileMeta(file: FileInfo): string {
  const ext = fileExt(file.name);
  const kind = isPdf(file) ? "PDF" : ext === "bin" ? "Datei" : ext.toUpperCase();
  return [kind, formatBytes(file.size)].filter(Boolean).join(" · ");
}

export function checkFile(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) return `„${file.name}“ ist größer als 100 MB.`;
  if (file.size === 0) return `„${file.name}“ ist leer.`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Speicher: hochladen, laden, öffnen, herunterladen                  */
/* ------------------------------------------------------------------ */

/** Dateien bis 100 MB: nur die zuletzt geöffneten im Speicher halten (O-14). */
const blobs = createBucketCache<Blob>({
  limit: 3,
  toValue: (blob) => blob,
});

export interface AttachmentStore {
  newPath(name: string): string;
  upload(path: string, file: File): Promise<void>;
  blob(path: string): Promise<Blob>;
}

export function createAttachmentStore(userId: string, ownerId: string): AttachmentStore {
  const target: UploadTarget = { bucket: ATTACHMENT_BUCKET, ownerId };
  return {
    newPath: (name) => `${userId}/${ownerId}/${crypto.randomUUID()}.${fileExt(name)}`,
    upload: (path, file) =>
      blobs.upload(target, path, file, file.type || "application/octet-stream", file.name),
    blob: (path) => blobs.load(ATTACHMENT_BUCKET, path),
  };
}

/** Herunterladen unter dem Originalnamen (geht auch nach dem Laden, kein Pop-up). */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * PDF im neuen Tab öffnen. Das Fenster geht sofort auf (sonst blockiert Safari das Pop-up nach
 * dem Laden) und bekommt die Datei, sobald sie da ist. Der Typ wird fest auf PDF gesetzt.
 */
export function openPdf(load: () => Promise<Blob>, onError: (message: string) => void) {
  const target = window.open("", "_blank");
  load()
    .then((blob) => {
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      if (target) target.location.href = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    })
    .catch(() => {
      target?.close();
      onError("Die Datei konnte nicht geladen werden.");
    });
}

/** Alle Dateien in TipTap-Inhalten (für den Export): Pfad und Originalname. */
export function collectFiles(contents: unknown[]): Array<{ path: string; name: string }> {
  const files = new Map<string, string>();
  visitMediaNodes(contents, "noteFile", (path, attrs) => {
    files.set(path, typeof attrs.name === "string" ? attrs.name : "Datei");
  });
  return [...files].map(([path, name]) => ({ path, name }));
}
