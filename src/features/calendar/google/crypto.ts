/**
 * Verschlüsselung für Geheimnisse der Google-Anbindung (#64, N1a) – nur im Server.
 * AES-256-GCM (Node `crypto`) mit `GOOGLE_TOKEN_KEY`, je Wert ein zufälliger IV (12 Byte), 16 Byte
 * Prüfsumme. Ein Zusammenhang (`context`, z. B. die Nutzer-ID) geht als zusätzliche Daten (AAD)
 * in die Prüfsumme ein: Ein Token lässt sich nicht in eine andere Zeile oder einen anderen Zweck
 * umkopieren. Format versioniert: `v1:<iv>:<tag>:<daten>` (je base64url, passt in Spalte und Cookie).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretCryptoError extends Error {
  constructor(message = "Der gespeicherte Google-Zugang ließ sich nicht entschlüsseln.") {
    super(message);
    this.name = "SecretCryptoError";
  }
}

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new SecretCryptoError("Der Schlüssel muss 32 Byte haben.");
}

/** Klartext → `v1:iv:tag:daten`. */
export function sealSecret(plain: string, key: Buffer, context: string): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(":");
}

/** `v1:iv:tag:daten` → Klartext; falscher Schlüssel, anderer Zusammenhang, verändert → Fehler. */
export function openSecret(sealed: string, key: Buffer, context: string): string {
  assertKey(key);
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretCryptoError();
  const [iv, tag, data] = parts.slice(1).map((part) => Buffer.from(part, "base64url")) as [
    Buffer,
    Buffer,
    Buffer,
  ];
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretCryptoError();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretCryptoError();
  }
}

/** Zusammenhang für den Refresh-Token in google_accounts (je Nutzer). */
export const refreshTokenContext = (userId: string) => `google_accounts.refresh_token:${userId}`;
/** Zusammenhang für das Anmelde-Cookie (state + PKCE). */
export const OAUTH_STATE_CONTEXT = "google_oauth_state";
