/**
 * Token einer öffentlichen Freigabe (#94, E42) – rein, ohne Browser-Code (App, Seite, Route).
 * 32 Zufallsbytes (256 Bit, nicht erratbar) als base64url ohne Auffüllung = 43 Zeichen; dasselbe
 * Format erzwingt die Datenbank per check (Migration 45).
 */
export const SHARE_TOKEN_BYTES = 32;
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const isShareToken = (value: unknown): value is string =>
  typeof value === "string" && SHARE_TOKEN.test(value);

/** Neuer Token aus `crypto.getRandomValues` (gibt es auch ohne sicheren Kontext, vgl. `newId`). */
export function newShareToken(): string {
  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
