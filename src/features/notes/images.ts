"use client";

import { type CropRect, cropPixels } from "@/features/outliner/model/crop";
/**
 * Bilder in Notizen (E24, aus Stufe 4 vorgezogen): liegen seit E41 in Cloudflare R2 (Schlüssel
 * `note-images/<user_id>/<note_id>/<uuid>.<ext>`); die Routen `/api/dateien/…` prüfen Sitzung
 * (aal2), eigenen Ordner, Typ und Größe (`media-api.ts`).
 * - Vor dem Hochladen verkleinert (längste Seite höchstens 2000 px), höchstens 10 MB.
 * - Angezeigt als Blob (kein öffentlicher oder signierter Link im DOM, die CSP erlaubt `blob:`
 *   schon).
 */
import type { UploadTarget } from "./media-api";
import { createBucketCache, visitMediaNodes } from "./media-store";
import { IMAGE_EXT, MAX_IMAGE_BYTES, NOTE_IMAGE_BUCKET } from "./storage";

export { MAX_IMAGE_BYTES, NOTE_IMAGE_BUCKET };
export const MAX_IMAGE_SIDE = 2000;
const ACCEPTED = Object.keys(IMAGE_EXT);
const EXT = IMAGE_EXT;

/**
 * iPhone-Fotos (HEIC/HEIF, #39): Typ fehlt im Browser oft – dann zählt die Endung. Sie werden
 * beim Einfügen zu JPEG (`prepareImage`), damit jeder Browser sie zeigt.
 */
export const isHeicFile = (file: File) =>
  /^image\/hei[cf](-sequence)?$/.test(file.type) || /\.hei[cf]$/i.test(file.name);

export const isAcceptedImage = (file: File) => ACCEPTED.includes(file.type) || isHeicFile(file);

/**
 * HEIC entschlüsseln: Safari kann es selbst, Chrome und Firefox nicht – dann `heic-to` (libheif
 * als reines JavaScript in einem Worker, wird erst beim ersten iPhone-Foto geladen).
 */
async function decodeHeic(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    const { heicTo } = await import("heic-to/csp");
    try {
      return await heicTo({ blob: file, type: "bitmap" });
    } catch {
      throw new Error(`„${file.name}“ ließ sich nicht als Bild lesen.`);
    }
  }
}

/** Dateiname im Pfad (für Export und Anzeige). */
export const imageFileName = (path: string) => path.split("/").pop() ?? path;

/** Zielgröße bei höchstens `max` px auf der längsten Seite (nie vergrößern). */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface PreparedImage {
  blob: Blob;
  type: string;
  ext: string;
}

/**
 * Verkleinern und neu kodieren (GIF bleibt, damit Animationen erhalten bleiben; HEIC wird
 * immer JPEG).
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!isAcceptedImage(file)) throw new Error("Nur PNG, JPEG, WebP, GIF oder iPhone-Fotos (HEIC).");
  if (file.type === "image/gif") {
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Das GIF ist größer als 10 MB.");
    return { blob: file, type: file.type, ext: "gif" };
  }
  const heic = isHeicFile(file);
  const bitmap = heic ? await decodeHeic(file) : await createImageBitmap(file);
  const target = fitWithin(bitmap.width, bitmap.height);
  const small = !heic && target.width === bitmap.width && file.size <= 1.5 * 1024 * 1024;
  if (small) {
    bitmap.close();
    return { blob: file, type: file.type, ext: EXT[file.type] ?? "png" };
  }
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();
  const encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // Bildschirmfotos (PNG) bleiben scharf; wird es zu groß, dann JPEG
  let type = file.type === "image/png" ? "image/png" : "image/jpeg";
  let blob = await encode(type, 0.85);
  if (!blob || blob.size > MAX_IMAGE_BYTES) {
    type = "image/jpeg";
    blob = await encode(type, 0.8);
  }
  if (!blob) throw new Error("Bild konnte nicht verarbeitet werden.");
  if (blob.size > MAX_IMAGE_BYTES)
    throw new Error("Das Bild ist auch verkleinert größer als 10 MB.");
  return { blob, type, ext: EXT[type] ?? "jpg" };
}

/**
 * Ausschnitt eines Bildes als neue Datei (#28). PNG bleibt PNG (Bildschirmfotos scharf), sonst
 * JPEG; GIFs verlieren dabei die Animation.
 */
export async function cropImageFile(url: string, rect: CropRect, name: string): Promise<File> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const { sx, sy, sw, sh } = cropPixels(rect, image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")?.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const type = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error("Bild konnte nicht zugeschnitten werden.");
  return new File([blob], name.replace(/\.[^.]+$/, "") + (type === "image/png" ? ".png" : ".jpg"), {
    type,
  });
}

/* ------------------------------------------------------------------ */
/* Anzeige: Blob-URLs je Pfad, die zuletzt gezeigten im Speicher      */
/* ------------------------------------------------------------------ */

/** Bilder, die zuletzt angezeigt wurden; ältere geben ihre Blob-URL frei (O-14). */
export const IMAGE_CACHE_LIMIT = 60;
const urls = createBucketCache<string>({
  limit: IMAGE_CACHE_LIMIT,
  toValue: (blob) => URL.createObjectURL(blob),
  onEvict: (url) => URL.revokeObjectURL(url),
});

export interface ImageStore {
  /** neuer Pfad im Ordner dieser Notiz */
  newPath(ext: string): string;
  /** hochladen; bis dahin zeigt die Ansicht die lokale Vorschau */
  upload(path: string, image: PreparedImage): Promise<void>;
  /** Blob-URL zum Anzeigen (geladen über einen kurzlebigen signierten Link) */
  url(path: string): Promise<string>;
}

export function createImageStore(userId: string, noteId: string): ImageStore {
  const target: UploadTarget = { bucket: NOTE_IMAGE_BUCKET, ownerId: noteId };
  return {
    newPath: (ext) => `${userId}/${noteId}/${crypto.randomUUID()}.${ext}`,
    upload: (path, image) => urls.upload(target, path, image.blob, image.type, imageFileName(path)),
    url: (path) => urls.load(NOTE_IMAGE_BUCKET, path),
  };
}

/** Alle Bildpfade in TipTap-Inhalten (für den Export). */
export function collectImagePaths(contents: unknown[]): string[] {
  const paths = new Set<string>();
  visitMediaNodes(contents, "noteImage", (path) => paths.add(path));
  return [...paths];
}
