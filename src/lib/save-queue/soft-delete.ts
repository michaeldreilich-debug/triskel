import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { notifyWithUndo } from "@/components/ui/toast";
import type { SaveQueue } from "./save-queue";

/** Löschen ist immer Soft-Delete (CLAUDE.md, Regel 1). */
export function softDelete(
  queue: SaveQueue,
  table: string,
  id: string,
  now: Date = new Date(),
): void {
  queue.enqueue({ table, id, mode: "update", values: { deleted_at: now.toISOString() } });
}

export function restoreDeleted(queue: SaveQueue, table: string, id: string): void {
  queue.enqueue({ table, id, mode: "update", values: { deleted_at: null } });
}

export interface TrashWithUndoOptions<T extends { id: string }> {
  table: string;
  /** Query-Cache der Liste, aus der die Zeile sofort verschwindet */
  queryKey: QueryKey;
  row: T;
  /** Meldung im Toast, z. B. „„Einkaufen“ liegt im Papierkorb“ */
  message: string;
  /** Läuft nach dem Entfernen aus dem Cache, vor dem Toast (z. B. Panel schließen) */
  onTrashed?: () => void;
  /** Wohin die Zeile beim Zurückholen kommt; Standard: hinten anhängen */
  restore?: (rows: T[], row: T) => T[];
  notify?: (message: string, onUndo: () => void) => unknown;
}

/**
 * Muster „In den Papierkorb + Toast mit Rückgängig“ (E8): Soft-Delete in die Warteschlange, Zeile
 * aus dem Cache, Toast; „Rückgängig“ (auch ⌘Z) holt sie zurück, ohne sie doppelt einzufügen.
 */
export function trashWithUndo<T extends { id: string }>(
  queue: SaveQueue,
  queryClient: QueryClient,
  {
    table,
    queryKey,
    row,
    message,
    onTrashed,
    restore = (rows, item) => [...rows, item],
    notify = notifyWithUndo,
  }: TrashWithUndoOptions<T>,
): void {
  softDelete(queue, table, row.id);
  queryClient.setQueryData<T[]>(queryKey, (old) => old?.filter((r) => r.id !== row.id));
  onTrashed?.();
  notify(message, () => {
    restoreDeleted(queue, table, row.id);
    queryClient.setQueryData<T[]>(queryKey, (old) =>
      old?.some((r) => r.id === row.id) ? old : restore(old ?? [], row),
    );
  });
}
