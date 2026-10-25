/**
 * Kleiner LRU-Speicher (O-14): höchstens `limit` Einträge; der am längsten nicht gefragte fällt
 * heraus, `onEvict` räumt ihn auf (z. B. `URL.revokeObjectURL`). Am iPhone lädt Safari einen Tab
 * sonst bei Speicherdruck neu, wenn Bilder und PDFs die ganze Sitzung im Speicher bleiben.
 */
export class LruMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(
    private readonly limit: number,
    private readonly onEvict: (value: V, key: K) => void = () => {},
  ) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // zuletzt gefragt = zuletzt in der Map
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    const old = this.entries.get(key);
    this.entries.delete(key);
    if (old !== undefined && old !== value) this.onEvict(old, key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const [oldestKey, oldest] = this.entries.entries().next().value as [K, V];
      this.entries.delete(oldestKey);
      this.onEvict(oldest, oldestKey);
    }
  }

  /** ohne Aufräumen entfernen (z. B. fehlgeschlagenes Laden) */
  delete(key: K): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
