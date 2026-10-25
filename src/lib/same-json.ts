/**
 * Gleicher JSON-Inhalt, unabhängig von der Reihenfolge der Schlüssel (jsonb liefert sie anders
 * sortiert zurück, als die App sie geschickt hat). Arrays zählen in ihrer Reihenfolge.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    // fehlend und null gelten als gleich (leere Notiz)
    return (a ?? null) === (b ?? null);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameJson(value, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const other = Object.keys(right).filter((key) => right[key] !== undefined);
  return keys.length === other.length && keys.every((key) => sameJson(left[key], right[key]));
}
