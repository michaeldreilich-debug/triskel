/**
 * Hochladen, das noch nicht bestätigt ist (Review Teil B, V-1/V-10): Die Datei bleibt bis zur
 * Bestätigung durch R2 im Browser (IndexedDB, sonst im Speicher), der Knoten bleibt in der Notiz,
 * und ein gescheitertes Hochladen (Funkloch, App kurz verlassen, Seite neu geladen) wird von
 * selbst wiederholt – beim Start, bei Netz-Rückkehr und wenn die Seite wieder sichtbar wird. Nur
 * endgültige Ablehnungen des Speichers (4xx außer 404/408/429) geben auf.
 */
import type { MediaBucketName, UploadTarget } from "./media-api";
import { putMedia } from "./media-api";

export interface PendingUpload {
  path: string;
  bucket: MediaBucketName;
  ownerId: string;
  contentType: string;
  name: string;
  blob: Blob;
  /** Zeitpunkt des ersten Versuchs (ms) */
  at: number;
}

export interface PendingStore {
  put(entry: PendingUpload): Promise<void>;
  remove(path: string): Promise<void>;
  get(path: string): Promise<PendingUpload | null>;
  list(): Promise<PendingUpload[]>;
}

/** Im Speicher (Tests, Browser ohne IndexedDB) – überlebt kein Neuladen. */
export function memoryPendingStore(): PendingStore {
  const entries = new Map<string, PendingUpload>();
  return {
    async put(entry) {
      entries.set(entry.path, entry);
    },
    async remove(path) {
      entries.delete(path);
    },
    async get(path) {
      return entries.get(path) ?? null;
    },
    async list() {
      return [...entries.values()].sort((a, b) => a.at - b.at);
    },
  };
}

const DB_NAME = "triskel-uploads";
const STORE = "pending";

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "path" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB blockiert"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
  });
}

/** IndexedDB – überlebt Neuladen und Neustart der App; null, wenn es sie nicht gibt. */
export function indexedDbPendingStore(idb: IDBFactory | undefined): PendingStore | null {
  if (!idb) return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= openDb(idb).catch((error) => {
      db = null;
      throw error;
    });
    return db;
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await open();
    const store = database.transaction(STORE, mode).objectStore(STORE);
    return requestToPromise(action(store));
  };
  return {
    put: (entry) => run("readwrite", (s) => s.put(entry)).then(() => {}),
    remove: (path) => run("readwrite", (s) => s.delete(path)).then(() => {}),
    get: (path) =>
      run("readonly", (s) => s.get(path)).then(
        (value) => (value as PendingUpload | undefined) ?? null,
      ),
    list: () =>
      run("readonly", (s) => s.getAll()).then((rows) =>
        (rows as PendingUpload[]).sort((a, b) => a.at - b.at),
      ),
  };
}

let shared: PendingStore | null = null;

/** Der Speicher dieser Sitzung: IndexedDB, sonst im Speicher. */
export function pendingUploads(): PendingStore {
  if (!shared) {
    const idb = typeof indexedDB === "undefined" ? undefined : indexedDB;
    shared = indexedDbPendingStore(idb) ?? memoryPendingStore();
  }
  return shared;
}

/** Nur für Tests: Speicher austauschen. */
export function setPendingUploadsStore(store: PendingStore | null): void {
  shared = store;
}

/** Hat der Speicher die Datei endgültig abgelehnt (zu groß, kein Recht, kaputte Eingabe)? */
export function isFinalRejection(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : null;
  if (status === null) return false;
  return status >= 400 && status < 500 && status !== 404 && status !== 408 && status !== 429;
}

export interface RetryResult {
  /** jetzt hochgeladen */
  done: PendingUpload[];
  /** vom Speicher endgültig abgelehnt – aus der Liste genommen */
  rejected: PendingUpload[];
  /** weiter offen (kein Netz, Serverfehler) */
  open: PendingUpload[];
}

/** Alle offenen Uploads noch einmal versuchen (nacheinander); Bestätigtes verlässt die Liste. */
export async function retryPendingUploads(
  store: PendingStore,
  put: (
    target: UploadTarget,
    path: string,
    blob: Blob,
    contentType: string,
    name: string,
  ) => Promise<void> = putMedia,
): Promise<RetryResult> {
  const result: RetryResult = { done: [], rejected: [], open: [] };
  for (const entry of await store.list()) {
    try {
      await put(
        { bucket: entry.bucket, ownerId: entry.ownerId },
        entry.path,
        entry.blob,
        entry.contentType,
        entry.name,
      );
      await store.remove(entry.path);
      result.done.push(entry);
    } catch (error) {
      // 409: liegt schon im Speicher (ein früherer Versuch kam doch an) – erledigt
      const status = (error as { status?: unknown })?.status;
      if (status === 409) {
        await store.remove(entry.path);
        result.done.push(entry);
      } else if (isFinalRejection(error)) {
        await store.remove(entry.path);
        result.rejected.push(entry);
      } else {
        result.open.push(entry);
      }
    }
  }
  return result;
}
