// ---------------------------------------------------------------
// Regeln der Triskel-Ablage (#76): Welche Dateien vom Mac darf das Hilfsprogramm lesen, wohin
// darf es sie senden, was wird verkleinert. Ohne Ein-/Ausgabe, damit die Unit-Tests sie prüfen.
// Das Programm selbst: scripts/triskel-ablage.mts.
// ---------------------------------------------------------------
import { extname, join, relative, sep } from "node:path";

/** Wie die App (`MAX_FILE_BYTES`, E41): Dateien bis 100 MB */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** R2-Bucket der echten Daten; nur die Tests nennen über einen Parameter den Test-Bucket */
export const R2_PROD_BUCKET = "triskel-dateien";
/** Wie die App beim Hochladen (`src/features/notes/images.ts`): längste Seite */
export const MAX_IMAGE_SIDE = 2000;

/** Ordner im Benutzerordner, aus denen gelesen werden darf (Schreibtisch, Dokumente, iCloud Drive) */
export const ALLOWED_FOLDERS = [
  "Downloads",
  "Desktop",
  "Documents",
  "Library/Mobile Documents/com~apple~CloudDocs",
] as const;

export const allowedRoots = (home: string) => ALLOWED_FOLDERS.map((folder) => join(home, folder));

/**
 * Darf die Datei gelesen werden? `real` ist der Pfad nach Auflösen aller Verknüpfungen
 * (`realpathSync`) – sonst führte ein Alias im Downloads-Ordner z. B. nach ~/.ssh.
 * null = in Ordnung, sonst der Grund.
 */
export function pathProblem(real: string, roots: string[]): string | null {
  const root = roots.find((r) => real === r || real.startsWith(`${r}${sep}`));
  if (!root) {
    return "Nur Dateien aus Downloads, Schreibtisch, Dokumente oder iCloud Drive.";
  }
  const parts = relative(root, real).split(sep);
  if (parts.some((part) => part.startsWith("."))) {
    return "Versteckte Dateien und Ordner (Name beginnt mit „.“) werden nicht hochgeladen.";
  }
  return null;
}

/** Konto-ID aus der Zeile `R2_ACCOUNT_ID=…` einer .env-Datei – nur diese Zeile, sonst nichts. */
export function accountIdFromEnvFile(content: string): string {
  const line = content.split(/\r?\n/).find((l) => /^R2_ACCOUNT_ID\s*=/.test(l));
  if (!line) return "";
  return line
    .replace(/^R2_ACCOUNT_ID\s*=\s*/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
}

/** Konto-IDs von Cloudflare: Hex-Zeichen, damit daraus nie ein fremder Host wird. */
const ACCOUNT_ID = /^[a-z0-9]{8,64}$/i;

export interface UploadTargets {
  /** Adresse des Supabase-Projekts (Übergang bis zum Live-Gang von R2); leer = nur R2 */
  supabaseUrl?: string;
  /** eigenes Cloudflare-Konto; ohne Angabe werden R2-Links abgelehnt */
  r2AccountId?: string;
  /** nur für die Tests: der Test-Bucket statt `triskel-dateien` (genau dieser Name, keine Lockerung) */
  r2Bucket?: string;
}

/**
 * Nur signierte Hochlade-Links von Triskel (aus „prepare_upload“) – das Programm schickt nie eine
 * Datei an eine andere Adresse. null = in Ordnung, sonst der Grund.
 * - R2 (E41): genau `https://<eigenes Konto>.eu.r2.cloudflarestorage.com/<Bucket>/…` mit
 *   Signatur-Parametern (`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Expires`).
 * - Übergang bis zum Live-Gang von R2: signierte Upload-Links des eigenen Supabase-Projekts.
 *   Danach entfällt dieser Zweig.
 */
export function uploadUrlProblem(value: string, targets: UploadTargets): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "„upload_url“ ist keine gültige Adresse.";
  }
  const account = targets.r2AccountId?.trim() ?? "";
  const r2Host = ACCOUNT_ID.test(account) ? `${account}.eu.r2.cloudflarestorage.com` : null;
  if (r2Host && url.host === r2Host) {
    if (url.protocol !== "https:" || url.username || url.password) {
      return "„upload_url“ muss eine https-Adresse ohne Zugangsdaten sein.";
    }
    const bucket = targets.r2Bucket ?? R2_PROD_BUCKET;
    if (!url.pathname.startsWith(`/${bucket}/`) || url.pathname.length === bucket.length + 2) {
      return "„upload_url“ zeigt nicht auf den Dateispeicher von Triskel.";
    }
    for (const key of ["X-Amz-Signature", "X-Amz-Credential", "X-Amz-Expires"]) {
      if (!url.searchParams.get(key))
        return "„upload_url“ ist kein signierter Hochlade-Link aus „prepare_upload“.";
    }
    return null;
  }
  // Übergang: Supabase-Link bis zum Live-Gang von R2 (danach entfernen)
  let ownHost = "";
  try {
    ownHost = targets.supabaseUrl ? new URL(targets.supabaseUrl).host : "";
  } catch {
    ownHost = "";
  }
  if (url.protocol !== "https:" || !ownHost || url.host !== ownHost) {
    return `Hochladen nur zu Triskel (${r2Host ?? ownHost}) – „upload_url“ genau so übernehmen, wie „prepare_upload“ sie liefert.`;
  }
  if (
    !url.pathname.startsWith("/storage/v1/object/upload/sign/") ||
    !url.searchParams.get("token")
  ) {
    return "„upload_url“ ist kein Hochlade-Link aus „prepare_upload“.";
  }
  return null;
}

/**
 * Header für den PUT: der Typ, und `If-None-Match: *`, wenn der Link ihn mit signiert hat
 * (`X-Amz-SignedHeaders`, R2 seit E41/P: ein Link nimmt genau eine Datei an, ein zweiter PUT
 * überschreibt nichts). Fehlt er im Link (Übergang, Supabase), wird er nicht gesendet.
 */
export function uploadHeaders(uploadUrl: string, contentType: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": contentType };
  let signed: string[] = [];
  try {
    signed = (new URL(uploadUrl).searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
  } catch {
    signed = [];
  }
  if (signed.includes("if-none-match")) headers["If-None-Match"] = "*";
  return headers;
}

/** R2 lehnt den PUT ab, weil unter dem Pfad schon eine Datei liegt (Link schon benutzt). */
export const ALREADY_UPLOADED = 412;

const ext = (name: string) => extname(name).slice(1).toLowerCase();

/** Fotos werden verkleinert (HEIC → JPEG); GIF bleibt (Animation), alles andere unverändert. */
export function imageFormat(name: string): "jpeg" | "png" | null {
  const e = ext(name);
  if (e === "jpg" || e === "jpeg" || e === "heic" || e === "heif") return "jpeg";
  if (e === "png") return "png";
  return null;
}

/** Dateiname nach dem Verkleinern: HEIC wird zu „….jpg“. */
export function preparedName(name: string): string {
  const e = ext(name);
  return e === "heic" || e === "heif" ? `${name.slice(0, -(e.length + 1))}.jpg` : name;
}

const MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Content-Type zum Hochladen, falls „prepare_upload“ keinen mitgab (wie `mimeForExt`). */
export const contentTypeFor = (name: string) => MIME[ext(name)] ?? "application/octet-stream";

/** „1,4 MB“ – Größe für die Antworten an die KI */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
