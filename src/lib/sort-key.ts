import { generateKeyBetween } from "fractional-indexing";

/** Ist das ein gültiger Sortierschlüssel (Fractional Indexing)? */
export function isValidKey(key: string): boolean {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * Schlüssel hinter allen vorhandenen. Ungültige Schlüssel (z. B. von Hand oder aus einem Import)
 * werden übergangen – ein einzelner kaputter Wert darf das Anlegen nicht blockieren.
 */
export function keyAfter(keys: Iterable<string>): string {
  let max: string | null = null;
  for (const key of keys) {
    if ((max === null || key > max) && isValidKey(key)) max = key;
  }
  return generateKeyBetween(max, null);
}

/**
 * Schlüssel zwischen zwei Nachbarn (null = Anfang bzw. Ende). Ungültige oder vertauschte
 * Nachbarn werden übergangen, damit Verschieben nie scheitert.
 */
export function keyBetween(before: string | null, after: string | null): string {
  const a = before !== null && isValidKey(before) ? before : null;
  const b = after !== null && isValidKey(after) ? after : null;
  if (a !== null && b !== null && a >= b) return generateKeyBetween(a, null);
  return generateKeyBetween(a, b);
}
