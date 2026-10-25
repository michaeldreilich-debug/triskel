import type { JSONContent } from "@tiptap/core";
import type { SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import {
  type BlockRow,
  diffRows,
  docToRows,
  type RowDiff,
  type SerializeOptions,
} from "./model/serializer";

/** Diff → Operationen für die Speicher-Warteschlange (Upsert ganzer Zeilen, entfernte als Soft-Delete). */
export function diffToOps(
  diff: RowDiff,
  options: { table: string; extra?: Record<string, unknown>; now?: Date },
): SaveOp[] {
  const deletedAt = (options.now ?? new Date()).toISOString();
  return [
    ...diff.upserts.map<SaveOp>((row) => ({
      table: options.table,
      id: row.id,
      mode: "upsert",
      values: { ...options.extra, ...row, deleted_at: null },
    })),
    ...diff.removed.map<SaveOp>((id) => ({
      table: options.table,
      id,
      mode: "update",
      values: { deleted_at: deletedAt },
    })),
  ];
}

/**
 * Verbindet einen Outline-Editor mit der Speicher-Warteschlange (Plan Abschnitt 1, Persistenz):
 * Dokument → Zeilen → Diff gegen den letzten Stand → Operationen. Kein React, damit testbar.
 */
export class OutlineSync {
  private lastRows: BlockRow[];
  private pendingDoc: JSONContent | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly queue: SaveQueue,
    private readonly options: {
      table?: string;
      extra?: Record<string, unknown>;
      initialRows: BlockRow[];
      delayMs?: number;
      serialize?: SerializeOptions;
    },
  ) {
    this.lastRows = options.initialRows;
  }

  /** bei jeder Änderung aufrufen (entprellt) */
  change(doc: JSONContent): void {
    this.pendingDoc = doc;
    this.queue.markDirty(this, true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), this.options.delayMs ?? 400);
  }

  /** sofort in die Warteschlange übernehmen (blur, pagehide, Verlassen) */
  commit(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const doc = this.pendingDoc;
    if (!doc) return;
    this.pendingDoc = null;
    this.queue.markDirty(this, false);
    const rows = docToRows(doc, this.lastRows, this.options.serialize);
    const ops = diffToOps(diffRows(this.lastRows, rows), {
      table: this.options.table ?? "note_blocks",
      extra: this.options.extra,
    });
    for (const op of ops) this.queue.enqueue(op);
    this.lastRows = rows;
  }

  /** übernehmen und sofort senden */
  flush(): Promise<void> {
    this.commit();
    return this.queue.flush();
  }

  /** Entprellte, noch nicht übergebene Eingabe vorhanden? */
  hasPending(): boolean {
    return this.pendingDoc !== null;
  }

  /** letzter übergebener Stand (Zeilen) */
  rows(): BlockRow[] {
    return this.lastRows;
  }

  /**
   * Frischen Serverstand als Ausgangspunkt übernehmen (V-6: fremde Änderungen bei Fokus/Reconnect) –
   * nur, wenn hier nichts ungespeichert ist; der nächste Diff rechnet dann gegen diesen Stand.
   * false = nicht übernommen (Eingabe wartet noch).
   */
  reset(rows: BlockRow[]): boolean {
    if (this.pendingDoc) return false;
    this.lastRows = rows;
    return true;
  }
}
