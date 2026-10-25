/**
 * Signierte Links für R2 (S3, aws4fetch) – ohne Netz. Der PUT-Link signiert `content-length` und
 * `content-type` mit (`allHeaders`), nimmt also nur genau diese Größe und diesen Typ an. Mit
 * `exclusive` zusätzlich `if-none-match: *`: R2 nimmt dann nur einen PUT an, ein zweiter an
 * denselben Link überschreibt nichts (412; im Test-Bucket nachgewiesen). Nur für Hochladende ohne
 * CORS (KI, Triskel-Ablage) – der Browser dürfte den Kopf nicht senden (CORS des Buckets).
 */
import { AwsClient } from "aws4fetch";
import { objectUrl, type R2Config } from "./config";

export const GET_LINK_SECONDS = 5 * 60;
export const PUT_LINK_SECONDS = 5 * 60;

function client(config: R2Config) {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

async function presign(
  config: R2Config,
  method: "GET" | "PUT",
  key: string,
  seconds: number,
  headers: Record<string, string>,
  query: Record<string, string> = {},
): Promise<string> {
  const url = new URL(objectUrl(config, key));
  url.searchParams.set("X-Amz-Expires", String(seconds));
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const signed = await client(config).sign(url.toString(), {
    method,
    headers,
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

/**
 * Kopfzeilen der Antwort, die R2 statt der gespeicherten setzt (`response-content-*`, S3) – mit
 * signiert, also nicht änderbar. Für die öffentliche Freigabe (#94): Typ und Herunterladen fest.
 */
export interface GetOverrides {
  contentType?: string;
  contentDisposition?: string;
  /** z. B. `no-store` (F-2): der Browser darf die Antwort von R2 nicht zwischenspeichern */
  cacheControl?: string;
}

export const presignGet = (
  config: R2Config,
  key: string,
  seconds = GET_LINK_SECONDS,
  overrides: GetOverrides = {},
) =>
  presign(
    config,
    "GET",
    key,
    seconds,
    {},
    {
      ...(overrides.contentType ? { "response-content-type": overrides.contentType } : {}),
      ...(overrides.contentDisposition
        ? { "response-content-disposition": overrides.contentDisposition }
        : {}),
      ...(overrides.cacheControl ? { "response-cache-control": overrides.cacheControl } : {}),
    },
  );

export interface PutLink {
  url: string;
  /**
   * Diese Kopfzeilen muss der PUT genau so senden (Typ, bei `exclusive` auch `if-none-match`; die
   * Länge setzt der Browser bzw. fetch selbst).
   */
  headers: { "content-type": string; "if-none-match"?: "*" };
}

export async function presignPut(
  config: R2Config,
  key: string,
  options: { contentType: string; size: number; seconds?: number; exclusive?: boolean },
): Promise<PutLink> {
  const sent: PutLink["headers"] = {
    "content-type": options.contentType,
    ...(options.exclusive ? { "if-none-match": "*" as const } : {}),
  };
  const url = await presign(config, "PUT", key, options.seconds ?? PUT_LINK_SECONDS, {
    ...sent,
    "content-length": String(options.size),
  });
  return { url, headers: sent };
}

/** Für die Server-Aufrufe (HEAD/GET/PUT/DELETE/Liste) mit Authorization-Kopf. */
export const signer = client;
