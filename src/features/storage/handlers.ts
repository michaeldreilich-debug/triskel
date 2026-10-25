/**
 * Die Abläufe hinter `/api/dateien/…` (E41), getrennt von den Routen, damit Tests sie ohne
 * Next.js aufrufen. Jeder Handler bekommt den geprüften Kontext (`access.ts`) und die rohe
 * Eingabe und liefert die fertige Antwort.
 *
 * Fehlercodes: 400 Eingabe ungültig (Pfad/Typ/Größe/Bucket), 403 nicht erlaubt (fremder Pfad,
 * KI beim Löschen), 404 Eintrag (Besitzer) gibt es nicht, 409 Datei gibt es schon (Hochladen
 * überschreibt nie), 502 R2 antwortet nicht, 503 R2 nicht eingerichtet (in `openFileRequest`).
 */

import { type FileContext, fail, ownerExists, succeed } from "./access";
import { deleteObjects, headObject, listKeys, R2Error } from "./client";
import {
  folderPrefix,
  isMediaBucket,
  isOwnerSegment,
  isOwnPath,
  isUuid,
  type MediaBucket,
  objectKey,
  parseKey,
  planUpload,
} from "./paths";
import { PUT_LINK_SECONDS, presignGet, presignPut } from "./signing";

export const MAX_LINKS = 100;
export const MAX_DELETE = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function bucketAndPath(
  ctx: FileContext,
  item: unknown,
): { bucket: MediaBucket; path: string } | null {
  if (!isRecord(item) || !isMediaBucket(item.bucket) || typeof item.path !== "string") return null;
  return isOwnPath(item.path, ctx.userId) ? { bucket: item.bucket, path: item.path } : null;
}

const unavailable = (caught: unknown) =>
  caught instanceof R2Error
    ? fail(502, "Der Dateispeicher antwortet nicht.")
    : fail(500, "Fehler.");

/** `{ items: [{bucket, path}] }` → `{ links: [{bucket, path, url}] }` (GET, 5 min). */
export async function handleLinks(ctx: FileContext, body: unknown): Promise<Response> {
  const items = isRecord(body) ? body.items : null;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_LINKS) {
    return fail(400, `Ein bis ${MAX_LINKS} Dateien angeben.`);
  }
  const parsed = items.map((item) => bucketAndPath(ctx, item));
  if (parsed.some((entry) => entry === null)) return fail(403, "Nicht erlaubt.");
  const links = await Promise.all(
    (parsed as { bucket: MediaBucket; path: string }[]).map(async ({ bucket, path }) => ({
      bucket,
      path,
      url: await presignGet(ctx.config, objectKey(bucket, path)),
    })),
  );
  return succeed({ links });
}

/**
 * `{ bucket, ownerId, contentType, size, name?, id? }` → `{ path, url, headers }` (PUT, genau
 * Größe+Typ). `id` (UUID) wählt der Browser selbst, weil der Editor den Pfad schon vor dem
 * Hochladen in den Inhalt setzt; der Pfad bleibt `<user>/<owner>/<id>.<ext>`.
 * Nie überschreiben (Supabase hatte `upsert: false`): Liegt unter dem Pfad schon eine Datei, gibt
 * es keinen Link (409). `exclusive` schließt den zweiten PUT an denselben Link zusätzlich in R2
 * aus (`if-none-match`, siehe `signing.ts`): für die KI immer, für die App mit
 * `R2_EXCLUSIVE_UPLOADS=1` (R-5; braucht `if-none-match` in der CORS-Richtlinie der Buckets).
 * Restrisiko ohne Schalter: ein zweiter PUT an denselben Link, solange er gilt – nur mit der
 * eigenen Sitzung.
 */
export async function handleUpload(
  ctx: FileContext,
  body: unknown,
  options: { seconds?: number; exclusive?: boolean } = {},
): Promise<Response> {
  if (!isRecord(body) || !isMediaBucket(body.bucket)) return fail(400, "Ungültige Eingabe.");
  if (!isOwnerSegment(body.ownerId)) return fail(400, "Ungültiger Eintrag.");
  if (body.id !== undefined && !isUuid(body.id)) return fail(400, "Ungültige Kennung.");
  const plan = planUpload({
    bucket: body.bucket,
    userId: ctx.userId,
    ownerId: body.ownerId,
    contentType: body.contentType,
    size: body.size,
    name: body.name,
    uuid: body.id,
  });
  if (!plan.ok) return fail(400, plan.error);
  if (!(await ownerExists(ctx.supabase, body.ownerId))) return fail(404, "Eintrag nicht gefunden.");
  const key = objectKey(body.bucket, plan.path);
  try {
    if ((await headObject(ctx.config, key)).exists) return fail(409, "Datei gibt es schon.");
  } catch (caught) {
    return unavailable(caught);
  }
  const link = await presignPut(ctx.config, key, {
    contentType: plan.contentType,
    size: plan.size,
    seconds: options.seconds ?? PUT_LINK_SECONDS,
    exclusive: options.exclusive ?? (ctx.actor === "app" && ctx.config.exclusiveUploads === true),
  });
  return succeed({ path: plan.path, url: link.url, headers: link.headers });
}

/** `{ bucket, path }` → `{ exists, size?, contentType? }` (HEAD). */
export async function handleExists(ctx: FileContext, body: unknown): Promise<Response> {
  const target = bucketAndPath(ctx, body);
  if (!target) return fail(403, "Nicht erlaubt.");
  try {
    return succeed({ ...(await headObject(ctx.config, objectKey(target.bucket, target.path))) });
  } catch (caught) {
    return unavailable(caught);
  }
}

/** `{ bucket, ownerId }` → `{ paths }` im eigenen Ordner (nur App, nie KI). */
export async function handleList(ctx: FileContext, body: unknown): Promise<Response> {
  if (ctx.actor !== "app") return fail(403, "Nicht erlaubt.");
  if (!isRecord(body) || !isMediaBucket(body.bucket) || !isOwnerSegment(body.ownerId)) {
    return fail(400, "Ungültige Eingabe.");
  }
  try {
    const keys = await listKeys(ctx.config, folderPrefix(body.bucket, ctx.userId, body.ownerId));
    const paths = keys
      .map((key) => parseKey(key))
      .flatMap((entry) =>
        entry && entry.bucket === body.bucket && isOwnPath(entry.path, ctx.userId)
          ? [entry.path]
          : [],
      );
    return succeed({ paths });
  } catch (caught) {
    return unavailable(caught);
  }
}

/**
 * `{ bucket, paths }` → `{ removed }` (nur eigene Pfade; nur App, nie KI). Regel 1 (R-2): R2 hat
 * weder RLS noch Papierkorb – gelöscht wird nur, wenn der Eintrag (Notiz, Aufgabe, Projekt,
 * Vorlage) im Ordner des Pfads nicht mehr existiert; lebt er noch (anderswo zurückgeholt, Löschen
 * gescheitert, fehlerhafter Client), bleibt alles (409).
 */
export async function handleDelete(ctx: FileContext, body: unknown): Promise<Response> {
  if (ctx.actor !== "app") return fail(403, "Nicht erlaubt.");
  if (!isRecord(body) || !isMediaBucket(body.bucket) || !Array.isArray(body.paths)) {
    return fail(400, "Ungültige Eingabe.");
  }
  const paths = body.paths;
  if (paths.length === 0 || paths.length > MAX_DELETE) return fail(400, "Ungültige Anzahl.");
  const bucket = body.bucket;
  if (
    !paths.every((path): path is string => typeof path === "string" && isOwnPath(path, ctx.userId))
  ) {
    return fail(403, "Nicht erlaubt.");
  }
  const owners = [...new Set(paths.map((path) => path.split("/")[1] ?? ""))];
  const living = (
    await Promise.all(
      owners.map(async (owner) => ((await ownerExists(ctx.supabase, owner)) ? owner : null)),
    )
  ).filter((owner): owner is string => owner !== null);
  if (living.length > 0) {
    return fail(409, "Der Eintrag existiert noch – seine Dateien bleiben.", { living });
  }
  try {
    await deleteObjects(
      ctx.config,
      paths.map((path) => objectKey(bucket, path)),
    );
    return succeed({ removed: paths.length });
  } catch (caught) {
    return unavailable(caught);
  }
}
