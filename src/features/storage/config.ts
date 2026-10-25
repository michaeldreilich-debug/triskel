/**
 * Konfiguration für R2 (E41) – nur diese vier Werte, nie `R2_BACKUP_*`/`R2_MIGRATE_*`.
 * Fehlt etwas, ist R2 „nicht eingerichtet“ (lokaler `npm run dev` hat absichtlich keinen
 * Schlüssel). Rein: bekommt die Umgebung als Parameter.
 */
export const PROD_BUCKET = "triskel-dateien";

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * `R2_EXCLUSIVE_UPLOADS=1` (R-5): Auch der Hochlade-Link der App nimmt nur genau einen PUT an
   * (`if-none-match: *`). Erst einschalten, wenn die CORS-Richtlinie beider Buckets den Header
   * `if-none-match` erlaubt (README › R2 › Einrichtung) – sonst scheitert jedes Hochladen im Browser.
   */
  exclusiveUploads?: boolean;
}

type Env = Record<string, string | undefined>;

export class R2GuardError extends Error {}

/** Konto-ID: nur Hex-Zeichen, damit daraus nie ein fremder Host wird. */
const ACCOUNT_ID = /^[a-z0-9]{8,64}$/i;
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Ursprung des Endpunkts (auch für die CSP `connect-src`). */
export const r2Origin = (accountId: string) => `https://${accountId}.eu.r2.cloudflarestorage.com`;

/**
 * Konfiguration aus der Umgebung oder null (nicht eingerichtet). Bricht hart ab, wenn der
 * Server im Test (`NODE_ENV=test`) den Prod-Bucket benutzen würde.
 */
export function readR2Config(env: Env = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim() ?? "";
  const bucket = env.R2_BUCKET?.trim() ?? "";
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  if (bucket === PROD_BUCKET && env.NODE_ENV === "test") {
    throw new R2GuardError(
      "Test-Schutzschalter: R2_BUCKET ist der Prod-Bucket – Tests laufen nur gegen triskel-dateien-test.",
    );
  }
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  if (!ACCOUNT_ID.test(accountId) || !BUCKET_NAME.test(bucket)) return null;
  return {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    ...(env.R2_EXCLUSIVE_UPLOADS?.trim() === "1" ? { exclusiveUploads: true } : {}),
  };
}

/** Ursprung für die CSP, wenn R2 eingerichtet ist. */
export function r2ConnectOrigin(env: Env = process.env): string | null {
  const config = readR2Config(env);
  return config ? r2Origin(config.accountId) : null;
}

/** Objekt-URL im Pfad-Stil `/<bucket>/<schlüssel>` (Schlüssel segmentweise kodiert). */
export function objectUrl(config: R2Config, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${r2Origin(config.accountId)}/${config.bucket}/${encoded}`;
}
