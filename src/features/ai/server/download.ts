/**
 * Datei von einer Adresse laden (#33, `attach_file`): nur https und nur von den Download-Hosts
 * von Notion (Rückmeldung: „nur von Notion-Links“). Jede Weiterleitung wird erneut geprüft, die
 * Größe schon beim Lesen begrenzt – so kann die Schnittstelle weder interne Adressen abrufen
 * noch beliebig große Dateien ziehen.
 */
import { ToolInputError } from "./resolve";

/** Hosts, von denen Notion Dateien ausliefert (signierte, kurz gültige Links). */
export const NOTION_FILE_HOSTS = [
  "file.notion.so",
  "prod-files-secure.s3.us-west-2.amazonaws.com",
  "img.notionusercontent.com",
] as const;

const MAX_REDIRECTS = 3;

/**
 * Größte Datei vom Notion-Link. Die Ablage selbst nimmt 100 MB, aber hier läuft Laden und
 * Schreiben nach R2 in einer Funktion mit 60 s (`maxDuration` der MCP-Route) und hält die Datei
 * im Speicher – 50 MB bleiben sicher darunter; größere per `prepare_upload` vom Rechner.
 */
export const NOTION_MAX_BYTES = 50 * 1024 * 1024;
const tooBig = (maxBytes: number) =>
  new ToolInputError(
    `Die Datei ist größer als ${Math.max(1, Math.round(maxBytes / (1024 * 1024)))} MB – größere Dateien vom Rechner mit „prepare_upload“ hochladen (bis 100 MB).`,
  );

export function allowedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ToolInputError("Keine gültige Adresse.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new ToolInputError("Nur https-Adressen ohne Zugangsdaten und Port.");
  }
  if (!(NOTION_FILE_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new ToolInputError(
      `Dateien nur von Notion (${NOTION_FILE_HOSTS.join(", ")}), nicht von ${url.hostname}. Den Download-Link mit „notion-get-file-download-urls“ holen.`,
    );
  }
  return url;
}

const GUESS: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Dateiname aus Content-Disposition oder dem letzten Pfadteil. */
export function fileNameOf(url: URL, disposition: string | null): string {
  const star = disposition && /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  const plain = disposition && /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  let name = "";
  try {
    name = star?.[1]
      ? decodeURIComponent(star[1])
      : (plain?.[1] ?? decodeURIComponent(url.pathname.split("/").pop() ?? ""));
  } catch {
    name = plain?.[1] ?? "";
  }
  // nur der Name, ohne Pfad und Steuerzeichen
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen gezielt entfernen
  const clean = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.slice(0, 200) || "Datei";
}

export function mimeOf(contentType: string | null, name: string): string {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type && type !== "application/octet-stream" && type !== "binary/octet-stream") return type;
  const ext = /\.([a-z0-9]{1,10})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return GUESS[ext] ?? "application/octet-stream";
}

export interface Downloaded {
  bytes: Uint8Array;
  mime: string;
  name: string;
}

export async function download(
  value: string,
  options: { fetch?: typeof fetch; maxBytes?: number } = {},
): Promise<Downloaded> {
  const get = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? NOTION_MAX_BYTES;
  let url = allowedUrl(value);
  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await get(url, { redirect: "manual", signal: AbortSignal.timeout(35_000) });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location || hop === MAX_REDIRECTS) throw new ToolInputError("Zu viele Weiterleitungen.");
    url = allowedUrl(new URL(location, url).toString());
  }
  if (!response?.ok || !response.body) {
    throw new ToolInputError(
      `Datei nicht abrufbar (${response?.status ?? "?"}). Notion-Links gelten nur kurz – neu holen.`,
    );
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw tooBig(maxBytes);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooBig(maxBytes);
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const name = fileNameOf(url, response.headers.get("content-disposition"));
  return { bytes, name, mime: mimeOf(response.headers.get("content-type"), name) };
}
