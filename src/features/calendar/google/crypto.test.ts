import { describe, expect, it } from "vitest";
import { openSecret, refreshTokenContext, SecretCryptoError, sealSecret } from "./crypto";

const KEY = Buffer.alloc(32, 3);
const OTHER = Buffer.alloc(32, 4);
const CTX = refreshTokenContext("00000000-0000-4000-8000-00000000000a");
const SECRET = "1//0gRefreshToken-mit-Sonderzeichen_äöü/+=";

/** Teil i (1 = iv, 2 = tag, 3 = daten) um ein Bit verändern. */
function flip(sealed: string, index: number): string {
  const parts = sealed.split(":");
  const bytes = Buffer.from(parts[index] as string, "base64url");
  bytes[0] = (bytes[0] as number) ^ 1;
  parts[index] = bytes.toString("base64url");
  return parts.join(":");
}

describe("AES-256-GCM für den Refresh-Token", () => {
  it("hin und zurück; Format v1:iv:tag:daten (base64url, passt in Spalte und Cookie)", () => {
    const sealed = sealSecret(SECRET, KEY, CTX);
    expect(sealed).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("RefreshToken");
    expect(openSecret(sealed, KEY, CTX)).toBe(SECRET);
  });

  it("zufälliger IV: derselbe Klartext ergibt jedes Mal etwas anderes", () => {
    const a = sealSecret(SECRET, KEY, CTX);
    const b = sealSecret(SECRET, KEY, CTX);
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
    expect(Buffer.from(a.split(":")[1] as string, "base64url")).toHaveLength(12);
    expect(Buffer.from(a.split(":")[2] as string, "base64url")).toHaveLength(16);
  });

  it("falscher Schlüssel → Fehler", () => {
    const sealed = sealSecret(SECRET, KEY, CTX);
    expect(() => openSecret(sealed, OTHER, CTX)).toThrow(SecretCryptoError);
  });

  it("anderer Zusammenhang (andere Nutzer-ID, anderer Zweck) → Fehler", () => {
    const sealed = sealSecret(SECRET, KEY, CTX);
    expect(() =>
      openSecret(sealed, KEY, refreshTokenContext("00000000-0000-4000-8000-00000000000b")),
    ).toThrow(SecretCryptoError);
    expect(() => openSecret(sealed, KEY, "google_oauth_state")).toThrow(SecretCryptoError);
  });

  it("manipuliert (IV, Prüfsumme, Daten, Version, Form) → Fehler, nie Klartext", () => {
    const sealed = sealSecret(SECRET, KEY, CTX);
    for (const bad of [
      flip(sealed, 1),
      flip(sealed, 2),
      flip(sealed, 3),
      sealed.replace(/^v1:/, "v2:"),
      sealed.split(":").slice(0, 3).join(":"),
      `${sealed}:x`,
      "",
      "v1:::",
    ]) {
      expect(() => openSecret(bad, KEY, CTX), bad).toThrow(SecretCryptoError);
    }
  });

  it("Schlüssel muss 32 Byte haben", () => {
    expect(() => sealSecret(SECRET, Buffer.alloc(16), CTX)).toThrow(SecretCryptoError);
    expect(() => openSecret("v1:a:b:c", Buffer.alloc(31), CTX)).toThrow(SecretCryptoError);
  });
});
