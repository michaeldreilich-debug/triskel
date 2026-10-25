/**
 * Datei vom Rechner der KI hochladen (#51, E33, R3): `prepare_upload` gibt einen kurz gültigen
 * signierten R2-Link für genau einen Pfad, eine Größe und einen Typ aus, die KI lädt die Datei per PUT
 * hoch, `attach_file` hängt sie mit dem Verweis `<bucket>:<pfad>` an. Der Server ruft dabei keine
 * fremde Adresse ab; den Pfad bestimmt immer der Server, der Verweis wird beim Anhängen geprüft.
 */
import { ATTACHMENT_BUCKET, IMAGE_EXT, NOTE_IMAGE_BUCKET } from "@/features/notes/storage";
import { fileExt } from "@/features/outliner/model/files";
import { ToolInputError } from "./resolve";

/** So lange gilt ein Hochlade-Link (signierter R2-PUT, `handleUpload` mit `seconds`). */
export const UPLOAD_VALID_SECONDS = 3600;
export const UPLOAD_VALID_HOURS = UPLOAD_VALID_SECONDS / 3600;

const IMAGE_EXTENSIONS = new Set([...Object.values(IMAGE_EXT), "jpeg"]);

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Content-Type zur Endung; unbekannte Endungen als allgemeine Datei. */
export const mimeForExt = (ext: string) => MIME_BY_EXT[ext] ?? "application/octet-stream";

export interface UploadTarget {
  bucket: typeof ATTACHMENT_BUCKET | typeof NOTE_IMAGE_BUCKET;
  ext: string;
  /** Content-Type, mit dem die KI hochladen soll */
  mime: string;
}

/** Bilder (bis 10 MB) landen als Bild im Bilder-Bucket, alles andere als Datei. */
export function uploadTarget(name: string, options: { asFile: boolean }): UploadTarget {
  const ext = fileExt(name);
  const image = !options.asFile && IMAGE_EXTENSIONS.has(ext);
  return {
    bucket: image ? NOTE_IMAGE_BUCKET : ATTACHMENT_BUCKET,
    ext: ext === "jpeg" ? "jpg" : ext,
    mime: mimeForExt(ext),
  };
}

/** Verweis, den `attach_file` als `upload` zurückbekommt. */
export const uploadRef = (bucket: string, path: string) => `${bucket}:${path}`;

const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/;

/**
 * Prüft einen Verweis aus `prepare_upload`: nur die beiden eigenen Buckets, nur der Ordner des
 * Nutzers und genau der Notiz bzw. Aufgabe, an die angehängt wird.
 */
export function parseUploadRef(
  value: string,
  userId: string,
  ownerId: string,
): { bucket: UploadTarget["bucket"]; path: string; fileName: string } {
  const [bucket, ...rest] = value.trim().split(":");
  const path = rest.join(":");
  if (bucket !== ATTACHMENT_BUCKET && bucket !== NOTE_IMAGE_BUCKET) {
    throw new ToolInputError(
      "Unbekannter Verweis – „upload“ genau so übernehmen, wie ihn „prepare_upload“ liefert.",
    );
  }
  const [user, owner, fileName, ...more] = path.split("/");
  if (
    user !== userId ||
    owner !== ownerId ||
    !fileName ||
    more.length ||
    !FILE_NAME.test(fileName)
  ) {
    throw new ToolInputError(
      "Der Verweis gehört nicht zu dieser Notiz oder Aufgabe – „ziel“ muss dasselbe sein wie bei „prepare_upload“.",
    );
  }
  return { bucket, path, fileName };
}
