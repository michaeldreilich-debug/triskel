/**
 * Lokaler Stand hat Vorrang (Plan Abschnitt 1, Persistenz): Was in der Speicher-Warteschlange
 * noch unbestätigt ist, wird über frisch geladene Serverdaten gelegt. Sonst würde ein Neuladen
 * (z. B. beim Fensterfokus) gerade Getipptes kurz durch den alten Serverstand ersetzen.
 */
import { mergeOps, type SaveOp, type SaveQueue } from "@/lib/save-queue/save-queue";

export interface UnconfirmedSource {
  unconfirmedOps(): SaveOp[];
}

export interface OverlayOptions<T> {
  /** neu angelegte, noch nicht gespeicherte Zeilen aufnehmen, wenn sie zur Abfrage passen */
  include?: (row: T) => boolean;
  /** lokal in den Papierkorb gelegte Zeilen entfernen (Standard: ja) */
  dropDeleted?: boolean;
}

export function overlayUnconfirmed<T extends { id: string }>(
  source: UnconfirmedSource,
  table: string,
  rows: T[],
  options: OverlayOptions<T> = {},
): T[] {
  const ops = new Map<string, SaveOp>();
  for (const op of source.unconfirmedOps()) {
    if (op.table !== table) continue;
    const previous = ops.get(op.id);
    ops.set(op.id, previous ? mergeOps(previous, op) : op);
  }
  if (ops.size === 0) return rows;

  const dropDeleted = options.dropDeleted ?? true;
  const result: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.id);
    const op = ops.get(row.id);
    const merged = op ? ({ ...row, ...op.values } as T) : row;
    if (dropDeleted && (merged as { deleted_at?: unknown }).deleted_at) continue;
    result.push(merged);
  }
  if (options.include) {
    for (const op of ops.values()) {
      if (op.mode !== "upsert" || seen.has(op.id)) continue;
      const candidate = { ...op.values, id: op.id } as unknown as T;
      if (dropDeleted && (candidate as { deleted_at?: unknown }).deleted_at) continue;
      if (options.include(candidate)) result.push(candidate);
    }
  }
  return result;
}

/** Hat die Warteschlange unbestätigte Änderungen an diesen Zeilen (bzw. passenden neuen)? */
export function hasUnconfirmed(
  source: UnconfirmedSource,
  table: string,
  match: (op: SaveOp) => boolean,
): number {
  return source.unconfirmedOps().filter((op) => op.table === table && match(op)).length;
}

/**
 * Laden mit Vorrang des lokalen Stands. Unbestätigtes wird VOR und NACH dem Laden gelesen:
 * Wird eine Änderung während des Ladens bestätigt, kann die Antwort noch den alten Stand
 * enthalten – die vorher gemerkten Werte (= gespeicherter Stand) gleichen das aus.
 * Eine Zeile, die erst WÄHREND des Ladens angelegt und auch gleich bestätigt wurde, steht weder
 * in der Antwort noch in der Warteschlange – deshalb wird dann noch einmal geladen (höchstens
 * dreimal insgesamt), sonst verschwände sie bis zum nächsten Neuladen aus der Ansicht.
 */
export async function fetchWithOverlay<T extends { id: string }>(
  queue: Pick<SaveQueue, "unconfirmedOps"> & Partial<Pick<SaveQueue, "persistedCount">>,
  table: string,
  fetchRows: () => Promise<T[]>,
  options: OverlayOptions<T> = {},
): Promise<T[]> {
  for (let attempt = 1; ; attempt++) {
    const saved = queue.persistedCount?.();
    const before = queue.unconfirmedOps();
    const rows = await fetchRows();
    const after = queue.unconfirmedOps();
    if (attempt < 3 && saved !== undefined && queue.persistedCount?.() !== saved) continue;
    return overlayUnconfirmed(
      { unconfirmedOps: () => [...before, ...after] },
      table,
      rows,
      options,
    );
  }
}
