/**
 * Neue ID (UUID v4) für Datensätze, die der Client anlegt (E4).
 * `crypto.randomUUID` gibt es nur in „sicheren Kontexten“ (https, localhost) – nicht z. B. beim
 * Test im WLAN über http://192.168.…. `crypto.getRandomValues` gibt es überall.
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40; // Version 4
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // Variante RFC 4122
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Feste ID aus einem Schlüssel (UUID v8, 128 Bit cyrb128) – für Datensätze, die es je Schlüssel nur
 * einmal geben darf und die mehrere Geräte unabhängig anlegen können, z. B. der Wochenrückblick
 * einer Woche (D-3): Beide Geräte treffen sich dann auf derselben Zeile statt am Eindeutigkeits-
 * Index zu scheitern. Kein Geheimnis, nur verteilt genug.
 */
export function stableId(seed: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const hex = [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
  const variant = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
