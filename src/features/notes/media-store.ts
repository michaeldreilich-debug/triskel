/**
 * Gemeinsames für Bilder (images.ts) und Dateien (attachments.ts), O-20: Speicher-Cache mit
 * Grenze (O-14), Ordner entfernen (Tests), Medien-Knoten in TipTap-Inhalten finden (Export).
 */
import { uploadStatus } from "@/features/outliner/extensions/media-utils";
import { LruMap } from "@/lib/lru";
import {
  fetchMedia,
  type MediaBucketName,
  mediaExists,
  putMedia,
  type UploadTarget,
} from "./media-api";
import { isFinalRejection, pendingUploads } from "./pending-uploads";

export interface BucketCache<V> {
  /** hochladen; der lokale Stand ist sofort da, scheitert das Hochladen, fällt er heraus */
  upload(
    target: UploadTarget,
    path: string,
    blob: Blob,
    contentType: string,
    name: string,
  ): Promise<void>;
  /** aus dem Cache oder über einen signierten Link laden (Fehlschlag wird nicht gemerkt) */
  load(bucket: MediaBucketName, path: string): Promise<V>;
}

/**
 * Cache je Pfad für Inhalte eines privaten Buckets: höchstens `limit` zuletzt gefragte Einträge,
 * `toValue` macht aus dem Blob den gemerkten Wert (Bild: Blob-URL, Datei: der Blob), `onEvict`
 * räumt Verdrängtes auf (Blob-URL freigeben).
 */
export function createBucketCache<V>(options: {
  limit: number;
  toValue: (blob: Blob) => V;
  onEvict?: (value: V) => void;
}): BucketCache<V> {
  const { onEvict } = options;
  const cache = new LruMap<string, Promise<V>>(
    options.limit,
    onEvict ? (value) => void value.then(onEvict).catch(() => {}) : undefined,
  );
  return {
    async upload(target, path, blob, contentType, name) {
      cache.set(path, Promise.resolve(options.toValue(blob)));
      // bis zur Bestätigung im Browser halten (V-1): übersteht Neuladen, wird von selbst wiederholt
      const pending = pendingUploads();
      await pending
        .put({ ...target, path, blob, contentType, name, at: Date.now() })
        .catch(() => {});
      try {
        await putMedia(target, path, blob, contentType, name);
      } catch (error) {
        // Antwort unterwegs verloren, die Datei liegt aber im Speicher → gilt als hochgeladen (#72)
        if (uploadStatus(error) === null && (await mediaExists(target.bucket, path))) {
          await pending.remove(path).catch(() => {});
          return;
        }
        if (isFinalRejection(error)) {
          // endgültig abgelehnt (zu groß, kein Recht): nichts mehr zu wiederholen
          await pending.remove(path).catch(() => {});
          cache.delete(path);
        }
        // sonst bleibt die Datei im Browser und der Knoten in der Notiz – der nächste Versuch kommt
        throw error;
      }
      await pending.remove(path).catch(() => {});
    },
    load(bucket, path) {
      const known = cache.get(path);
      if (known) return known;
      const loading = fetchMedia(bucket, path)
        .catch(async (error: unknown) => {
          // noch nicht hochgeladen (V-1): die Datei liegt noch im Browser
          const pending = await pendingUploads()
            .get(path)
            .catch(() => null);
          if (pending) return pending.blob;
          throw error;
        })
        .then(options.toValue);
      cache.set(path, loading);
      loading.catch(() => cache.delete(path));
      return loading;
    },
  };
}

/** Jeden Knoten dieses Typs mit Pfad in TipTap-Inhalten besuchen (Export). */
export function visitMediaNodes(
  contents: unknown[],
  type: string,
  visit: (path: string, attrs: Record<string, unknown>) => void,
) {
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (n.type === type && typeof n.attrs?.path === "string") visit(n.attrs.path, n.attrs);
    for (const child of n.content ?? []) walk(child);
  };
  for (const content of contents) walk(content);
}
