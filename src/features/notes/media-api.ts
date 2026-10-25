/**
 * Browser-Seite des Dateispeichers (E41): Bilder und Dateien liegen in R2. Die App fragt ihre
 * eigenen Routen `/api/dateien/…` (Sitzung aal2) und holt bzw. schickt die Bytes über kurzlebige
 * signierte Links direkt zu R2. Ein Link wird nie im DOM gehalten – nur Blob-URLs.
 * Fehler tragen den HTTP-Status (`status`), damit `uploadFailedMessage` den Grund nennen kann;
 * `status` fehlt, wenn gar keine Antwort ankam (Verbindung abgebrochen, #72).
 */

export type MediaBucketName = "note-images" | "attachments";

export class MediaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export const MEDIA_NOT_AVAILABLE = "Dateien sind hier nicht verfügbar.";

/** Antwort einer eigenen Route lesen; Fehler als `MediaError` mit Status und Grund. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // keine JSON-Antwort (z. B. Fehlerseite)
  }
  if (!response.ok) {
    const reason =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Anfrage abgelehnt.";
    throw new MediaError(reason, response.status);
  }
  return body as T;
}

async function post<T>(route: string, payload: unknown): Promise<T> {
  const response = await fetch(`/api/dateien/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return readJson<T>(response);
}

/** Ohne R2-Einrichtung (lokaler Entwicklungsserver) antworten die Routen mit 503. */
export const isUnavailable = (error: unknown) =>
  error instanceof MediaError && error.status === 503;

/* ------------------------------------------------------------------ */
/* Laden: Links gebündelt anfragen, Bytes direkt von R2               */
/* ------------------------------------------------------------------ */

const LINK_BATCH = 100;
/** Anfragen, die kurz hintereinander kommen (Seite mit vielen Bildern), gehen als eine Anfrage. */
const LINK_WINDOW_MS = 15;

interface PendingLink {
  bucket: MediaBucketName;
  path: string;
  resolve: (url: string) => void;
  reject: (error: unknown) => void;
}

let pending: PendingLink[] = [];
let scheduled = false;

async function flushLinks() {
  const batch = pending;
  pending = [];
  scheduled = false;
  for (let i = 0; i < batch.length; i += LINK_BATCH) {
    const chunk = batch.slice(i, i + LINK_BATCH);
    try {
      const { links } = await post<{ links: Array<{ bucket: string; path: string; url: string }> }>(
        "links",
        { items: chunk.map(({ bucket, path }) => ({ bucket, path })) },
      );
      for (const item of chunk) {
        const found = links.find((l) => l.bucket === item.bucket && l.path === item.path);
        if (found?.url) item.resolve(found.url);
        else item.reject(new MediaError("Datei nicht gefunden"));
      }
    } catch (error) {
      for (const item of chunk) item.reject(error);
    }
  }
}

function signedLink(bucket: MediaBucketName, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    pending.push({ bucket, path, resolve, reject });
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => void flushLinks(), LINK_WINDOW_MS);
    }
  });
}

/** Datei als Blob holen (signierter Link, direkt von R2). */
export async function fetchMedia(bucket: MediaBucketName, path: string): Promise<Blob> {
  const url = await signedLink(bucket, path);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new MediaError("Datei nicht gefunden", response.status);
  return response.blob();
}

/* ------------------------------------------------------------------ */
/* Hochladen und Nachfragen                                           */
/* ------------------------------------------------------------------ */

export interface UploadTarget {
  bucket: MediaBucketName;
  /** Notiz, Aufgabe, Projekt oder Vorlage, in deren Ordner die Datei liegt */
  ownerId: string;
}

/**
 * Der Editor setzt das Bild schon ein, bevor die neue Notiz/Aufgabe gespeichert ist; der Server
 * prüft aber, dass der Besitzer existiert (404). Dann kurz abwarten, bis die Speicher-Warteschlange
 * ihn angelegt hat, statt sofort aufzugeben.
 */
export const OWNER_RETRY_MS: readonly number[] = [400, 800, 1500, 2500, 4000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hochladen: Link vom Server (prüft Besitzer, Typ, Größe), dann PUT genau dieser Bytes zu R2. */
export async function putMedia(
  target: UploadTarget,
  path: string,
  blob: Blob,
  contentType: string,
  name: string,
  retryMs: readonly number[] = OWNER_RETRY_MS,
): Promise<void> {
  const id = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  const request = {
    bucket: target.bucket,
    ownerId: target.ownerId,
    contentType,
    size: blob.size,
    name,
    id,
  };
  let link: { path: string; url: string; headers: Record<string, string> } | undefined;
  for (let attempt = 0; !link; attempt++) {
    try {
      link = await post("hochladen", request);
    } catch (error) {
      const wait = retryMs[attempt];
      if (!(error instanceof MediaError) || error.status !== 404 || wait === undefined) throw error;
      await sleep(wait);
    }
  }
  if (link.path !== path) throw new MediaError("Der Speicher wählte einen anderen Pfad.", 400);
  const response = await fetch(link.url, {
    method: "PUT",
    headers: link.headers,
    body: blob,
    cache: "no-store",
  });
  if (!response.ok) throw new MediaError(`R2 lehnte ab (${response.status})`, response.status);
}

/** Liegt die Datei im Speicher? (Nachfrage, wenn die Antwort aufs Hochladen fehlt, #72) */
export async function mediaExists(bucket: MediaBucketName, path: string): Promise<boolean> {
  try {
    const { exists } = await post<{ exists: boolean }>("vorhanden", { bucket, path });
    return exists === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Auflisten und Entfernen (Papierkorb)                               */
/* ------------------------------------------------------------------ */

export interface MediaFolderApi {
  /** alle Pfade im Ordner `<user>/<owner>` */
  list(bucket: MediaBucketName, ownerId: string): Promise<string[]>;
  /** Pfade entfernen (nur eigene) */
  remove(bucket: MediaBucketName, paths: string[]): Promise<void>;
}

const REMOVE_BATCH = 500;

export const browserMediaApi: MediaFolderApi = {
  async list(bucket, ownerId) {
    return (await post<{ paths: string[] }>("liste", { bucket, ownerId })).paths;
  },
  async remove(bucket, paths) {
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      try {
        await post("loeschen", { bucket, paths: paths.slice(i, i + REMOVE_BATCH) });
      } catch (error) {
        // 409 (R-2): der Eintrag lebt noch – der Server behält seine Dateien, kein Fehler für den Nutzer
        if (!(error instanceof MediaError && error.status === 409)) throw error;
      }
    }
  },
};
