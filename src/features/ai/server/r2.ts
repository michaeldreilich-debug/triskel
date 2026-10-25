/**
 * Dateien der KI in R2 (E41, R3): einziger Zugang der KI zum Dateispeicher. Jeder Zugriff prüft
 * zuerst die KI-Freigabe (`ai_client_allowed()` mit dem Token der KI), Pfade gehören immer dem
 * Nutzer (`isOwnPath`), Schreiben nur in Einträge, die ihm per RLS gehören. Nie service_role.
 * Die KI löscht und listet nie – hier gibt es dafür keinen Weg.
 */

import { IMAGE_EXT, NOTE_IMAGE_BUCKET } from "@/features/notes/storage";
import {
  authorizeAi,
  type FileContext,
  NOT_AVAILABLE,
  ownerExists,
} from "@/features/storage/access";
import { ALREADY_EXISTS, headObject, putObject, R2Error } from "@/features/storage/client";
import { type R2Config, readR2Config } from "@/features/storage/config";
import {
  isOwnPath,
  type MediaBucket,
  maxBytesFor,
  normalizeContentType,
  objectKey,
} from "@/features/storage/paths";
import { newId } from "@/lib/id";
import type { AiContext } from "./context";
import { sniffType, storedMime } from "./media";
import { ToolInputError } from "./resolve";
import { mimeForExt } from "./upload";

const contexts = new WeakMap<AiContext, Promise<FileContext>>();

function configOf(ctx: AiContext): R2Config {
  let config: R2Config | null;
  try {
    config = ctx.r2 !== undefined ? ctx.r2 : readR2Config();
  } catch {
    config = null;
  }
  if (!config) throw new ToolInputError(NOT_AVAILABLE);
  return config;
}

/** Zugriffskontext für die Handler der Speicher-Schicht – oder ein verständlicher Fehler. */
export function aiFiles(ctx: AiContext): Promise<FileContext> {
  let pending = contexts.get(ctx);
  if (!pending) {
    pending = (async () => {
      const config = configOf(ctx);
      if (!(await authorizeAi(ctx.db))) {
        throw new ToolInputError("Der Dateizugriff ist für diese KI-Verbindung nicht freigegeben.");
      }
      return { userId: ctx.userId, supabase: ctx.db, config, actor: "ai" as const };
    })();
    contexts.set(ctx, pending);
  }
  return pending;
}

/** R2-Fehler als Hinweis an die KI (nur Status, nie Adresse oder Schlüssel). */
export function storageProblem(caught: unknown): never {
  if (caught instanceof R2Error && caught.status === ALREADY_EXISTS) {
    throw new ToolInputError("Unter diesem Pfad liegt schon eine Datei – nichts überschrieben.");
  }
  if (caught instanceof R2Error) {
    throw new ToolInputError(
      "Der Dateispeicher antwortet gerade nicht – später noch einmal versuchen.",
    );
  }
  throw caught;
}

/** Größe und Typ einer Datei im eigenen Ordner (HEAD); `exists: false`, wenn es sie nicht gibt. */
export async function headStored(ctx: AiContext, bucket: MediaBucket, path: string) {
  if (!isOwnPath(path, ctx.userId)) {
    throw new ToolInputError("Diese Datei liegt nicht im eigenen Ordner.");
  }
  const files = await aiFiles(ctx);
  try {
    return await headObject(files.config, objectKey(bucket, path));
  } catch (caught) {
    return storageProblem(caught);
  }
}

/**
 * Datei im eigenen Ordner des Eintrags ablegen (Server-PUT: Base64 aus dem Chat, Notion-Download).
 * Neuer Pfad `<user>/<eintrag>/<uuid>.<ext>`; Größe nach der Grenze des Buckets, in den
 * Bilder-Bucket nur Bildtypen. Der PUT überschreibt nie (`putObject` mit `if-none-match`).
 * Der gespeicherte Typ (R-1) kommt zentral aus `storedMime`: am Inhalt erkannt, sonst die
 * bereinigte Angabe, sonst die Endung – aktive Inhalte (HTML, SVG, XML, Skripte) immer als
 * `text/plain`. Rückgabe: Pfad und dieser Typ (gehört so in den Knoten).
 */
export async function storeFile(
  ctx: AiContext,
  input: { bucket: MediaBucket; ownerId: string; ext: string; bytes: Uint8Array; mime: string },
): Promise<{ path: string; mime: string }> {
  const files = await aiFiles(ctx);
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytesFor(input.bucket)) {
    throw new ToolInputError("Die Datei ist leer oder größer als erlaubt.");
  }
  const mime = storedMime(sniffType(input.bytes), input.mime, mimeForExt(input.ext));
  const contentType = normalizeContentType(mime) ?? "application/octet-stream";
  if (input.bucket === NOTE_IMAGE_BUCKET && !IMAGE_EXT[contentType]) {
    throw new ToolInputError("Als Bild gehen nur PNG, JPEG, WebP und GIF.");
  }
  if (!(await ownerExists(ctx.db, input.ownerId))) {
    throw new ToolInputError("Notiz oder Aufgabe nicht gefunden.");
  }
  const path = `${ctx.userId}/${input.ownerId}/${newId()}.${input.ext}`;
  if (!isOwnPath(path, ctx.userId)) throw new ToolInputError("Ungültiger Dateiname.");
  try {
    await putObject(files.config, objectKey(input.bucket, path), input.bytes, contentType);
  } catch (caught) {
    return storageProblem(caught);
  }
  return { path, mime: contentType };
}
