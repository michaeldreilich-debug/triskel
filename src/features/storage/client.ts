/**
 * Server-Zugriffe auf R2 mit Netz (E41): HEAD, GET, PUT, Liste, Löschen. Nur auf dem Server, nie
 * mit Schlüsseln in Antworten oder Logs. Fehler tragen nur den Status, nie Adresse oder Schlüssel.
 */
import { objectUrl, type R2Config, r2Origin } from "./config";
import { signer } from "./signing";

export class R2Error extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Längste Wartezeit je Anfrage (auch für das Lesen des Inhalts) – R2 hängt nie die ganze Funktion auf. */
export const R2_TIMEOUT_MS = 30_000;

async function send(
  config: R2Config,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: BodyInit },
): Promise<Response> {
  const request = await signer(config).sign(url, {
    ...init,
    signal: AbortSignal.timeout(R2_TIMEOUT_MS),
  });
  let response: Response;
  try {
    response = await fetch(request);
  } catch {
    throw new R2Error(0, "R2 nicht erreichbar");
  }
  return response;
}

export interface ObjectHead {
  exists: boolean;
  size?: number;
  contentType?: string;
}

export async function headObject(config: R2Config, key: string): Promise<ObjectHead> {
  const response = await send(config, objectUrl(config, key), { method: "HEAD" });
  if (response.status === 404) return { exists: false };
  if (!response.ok) throw new R2Error(response.status, "R2: HEAD fehlgeschlagen");
  const size = Number(response.headers.get("content-length"));
  return {
    exists: true,
    ...(Number.isFinite(size) ? { size } : {}),
    ...(response.headers.get("content-type")
      ? { contentType: response.headers.get("content-type") as string }
      : {}),
  };
}

/** Inhalt lesen (KI, Export); null, wenn es das Objekt nicht gibt. */
export async function getObject(
  config: R2Config,
  key: string,
): Promise<{ body: ArrayBuffer; contentType: string | null } | null> {
  const response = await send(config, objectUrl(config, key), { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) throw new R2Error(response.status, "R2: Lesen fehlgeschlagen");
  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch {
    throw new R2Error(0, "R2: Lesen abgebrochen");
  }
  return { body, contentType: response.headers.get("content-type") };
}

/** Status, mit dem R2 einen PUT auf einen vorhandenen Schlüssel ablehnt (`if-none-match: *`). */
export const ALREADY_EXISTS = 412;

/**
 * Neue Datei ablegen – nie überschreiben: `if-none-match: *` lässt R2 einen vorhandenen Schlüssel
 * mit 412 ablehnen (`R2Error` mit `ALREADY_EXISTS`).
 */
export async function putObject(
  config: R2Config,
  key: string,
  body: Uint8Array | ArrayBuffer,
  contentType: string,
): Promise<void> {
  const response = await send(config, objectUrl(config, key), {
    method: "PUT",
    headers: { "content-type": contentType, "if-none-match": "*" },
    body: body as BodyInit,
  });
  if (response.status === ALREADY_EXISTS) {
    throw new R2Error(ALREADY_EXISTS, "R2: Datei gibt es schon");
  }
  if (!response.ok) throw new R2Error(response.status, "R2: Schreiben fehlgeschlagen");
}

/** Schlüssel unter einem Präfix (alle Seiten). */
export async function listKeys(config: R2Config, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const url = new URL(`${r2Origin(config.accountId)}/${config.bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const response = await send(config, url.toString(), { method: "GET" });
    if (!response.ok) throw new R2Error(response.status, "R2: Liste fehlgeschlagen");
    const parsed = parseListXml(await response.text());
    keys.push(...parsed.keys);
    token = parsed.nextToken;
  } while (token);
  return keys;
}

const decodeXml = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** ListObjectsV2-Antwort (nur Schlüssel und Fortsetzung) – rein, unit-getestet. */
export function parseListXml(xml: string): { keys: string[]; nextToken: string | null } {
  const keys = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => decodeXml(m[1] ?? ""));
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
  return { keys, nextToken: truncated && next ? decodeXml(next[1] ?? "") : null };
}

/** Mehrere Schlüssel löschen (einzeln, höchstens 8 gleichzeitig); fehlende gelten als gelöscht. */
export async function deleteObjects(config: R2Config, keys: string[]): Promise<void> {
  const queue = [...keys];
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      const response = await send(config, objectUrl(config, key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new R2Error(response.status, "R2: Löschen fehlgeschlagen");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
}
