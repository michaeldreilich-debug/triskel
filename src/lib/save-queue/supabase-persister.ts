/**
 * Supabase-Persister für die Speicher-Warteschlange (E3, E4).
 *
 * - Reihenfolge im Paket: Tabellen nach Abhängigkeit (Bereich vor Thema vor Notiz vor Block),
 *   innerhalb einer Tabelle stabil. Damit existiert z. B. eine per [[ angelegte Notiz, bevor der
 *   Block mit dem Verweis gespeichert wird (sonst fände der Link-Trigger das Ziel nicht).
 * - Upserts derselben Tabelle mit gleichen Spalten gehen in einem Aufruf (eine Anweisung: Verweise
 *   zwischen den Zeilen, z. B. Kind → neuer Eltern-Block, werden erst am Ende geprüft).
 * - Updates einzeln mit `.select("id")`: Trifft ein Update keine Zeile, ist das ein Fehler –
 *   sonst gingen Änderungen still verloren.
 * - `isRetryableSaveError`: Netz-, Server- und Token-Fehler werden wiederholt; Daten-, Constraint-
 *   und Rechtefehler sind dauerhaft (landen in `failed`, bleiben gespeichert).
 */
import type { SaveOp } from "./save-queue";

/**
 * Erledigen/Wiedereröffnen einer Aufgabe als Operation der Warteschlange (Risiko 8: immer über
 * complete_task bzw. undo_complete_task). id = Aufgaben-ID, values = { action, p_next_due?,
 * p_next_id? }. Je Aufgabe wird zusammengeführt: „erledigen, dann rückgängig“ vor dem Senden
 * ergibt nur „rückgängig“ (ändert dann nichts) – die Reihenfolge der Klicks bleibt gewahrt.
 */
export const RPC_TASK_STATUS = "rpc:task_status";

export type TaskStatusAction = "complete" | "undo";

/**
 * Endgültig löschen (B13, E9) als Operation der Warteschlange: id = Datensatz-ID, values =
 * { entity } (Tabelle). Läuft als letzter Schritt eines Pakets über empty_trash – das löscht nur,
 * was auf dem Server schon im Papierkorb liegt; ein noch wartendes Soft-Delete im selben Paket
 * geht also vor. Mehrere Datensätze derselben Tabelle gehen in einem Aufruf.
 */
export const RPC_EMPTY_TRASH = "rpc:empty_trash";

/**
 * Rückblick abschließen (B12) als Operation der Warteschlange: id = Rückblick-ID, values = {}.
 * Läuft nach den Rückblick-Zeilen desselben Pakets (Antworten zuerst, dann der Zahlen-Snapshot).
 */
export const RPC_CLOSE_RECAP = "rpc:close_recap";

/**
 * Notiz-Typ löschen bzw. Löschen rückgängig machen (#34, Migration 25): id = Schlüssel des Typs,
 * values = { action: "delete", p_target } oder { action: "restore", p_note_ids }. Läuft nach
 * Notizen und Vorlagen desselben Pakets (deren Typ zieht die RPC mit um).
 */
export const RPC_NOTE_TYPE = "rpc:note_type";

/**
 * Eine Antwort eines Rückblicks feldweise schreiben (Migration 49, V-2): id = Rückblick,
 * values = { <frage>: <wert>, … } – je Schlüssel ein Aufruf von recap_set_answer, andere
 * Antworten (KI, iPhone) bleiben stehen. Mehrere Antworten desselben Rückblicks laufen in
 * der Warteschlange zu einer Operation zusammen.
 */
export const RPC_RECAP_ANSWER = "rpc:recap_answer";

/** Tabellen, die empty_trash kennt (Migration 07, Notiz-Typen seit 25, Kalender seit 30). */
export const PURGEABLE_TABLES = [
  "tasks",
  "projects",
  "milestones",
  "notes",
  "topics",
  "recaps",
  "templates",
  "saved_views",
  "note_types",
  "calendar_sources",
] as const;

/** Speicherreihenfolge der Tabellen (Eltern vor Kindern). Unbekannte Tabellen zuletzt. */
export const TABLE_ORDER = [
  "user_settings",
  "areas",
  "topics",
  "projects",
  "milestones",
  "tasks",
  "task_dependencies",
  RPC_TASK_STATUS,
  "note_types",
  "notes",
  "note_blocks",
  "recaps",
  RPC_RECAP_ANSWER,
  RPC_CLOSE_RECAP,
  "templates",
  RPC_NOTE_TYPE,
  "saved_views",
  "calendar_sources",
  // nach Aufgaben und Notizen (Fremdschlüssel), #68
  "event_links",
  // nach der Notiz (Fremdschlüssel, Trigger „eigene Notiz“), #94
  "note_shares",
  RPC_EMPTY_TRASH,
] as const;

/**
 * Tabellen ohne eigene id-Spalte: Konfliktschlüssel für den Upsert. Die id der Operation ist hier
 * nur ein lokaler Schlüssel (z. B. „task_id:blocked_by_task_id“) und wird nicht gesendet.
 * Solche Zeilen werden immer als ganze Zeile per Upsert gespeichert (auch Soft-Delete).
 */
export const CONFLICT_KEYS: Readonly<Record<string, string>> = {
  task_dependencies: "task_id,blocked_by_task_id",
};

/**
 * Spalten, die „rückwärts“ verweisen (Eltern → Kind, z. B. Projekt → nächster Schritt = Aufgabe):
 * Sie werden aus Upserts/Updates herausgelöst und am Ende des Pakets als Update gesetzt – sonst
 * schlüge der Fremdschlüssel fehl, wenn die Aufgabe im selben Paket erst angelegt wird.
 */
export const DEFERRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  projects: ["next_task_id"],
};

export class SaveError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SaveError";
  }
}

interface ErrorLike {
  message?: string;
  code?: string;
}

/** Postgres-/PostgREST-Codes, die sich durch Wiederholen nicht beheben. */
const PERMANENT = /^(?:22|23|42|P0|PGRST1|PGRST2)/;

export function isRetryableSaveError(error: unknown): boolean {
  if (error instanceof SaveError) return error.retryable;
  const code = (error as ErrorLike | null)?.code;
  if (typeof code === "string" && PERMANENT.test(code)) return false;
  return true;
}

/**
 * Zurückholen (`deleted_at: null`) eines Datensatzes, den es nicht mehr gibt (endgültig gelöscht,
 * D-9): gegenstandslos – die Warteschlange verwirft es statt eines Dauerfehlers.
 */
export function isObsoleteRestore(op: SaveOp, error: unknown): boolean {
  return (
    error instanceof SaveError &&
    error.code === "NOT_FOUND" &&
    op.mode === "update" &&
    !op.table.startsWith("rpc:") &&
    Object.keys(op.values).length === 1 &&
    op.values.deleted_at === null
  );
}

function toSaveError(error: ErrorLike, table: string): SaveError {
  const code = error.code ?? "";
  return new SaveError(
    `${table}: ${error.message ?? "Speichern fehlgeschlagen"}`,
    code,
    isRetryableSaveError({ code }),
  );
}

function rank(table: string): number {
  const index = (TABLE_ORDER as readonly string[]).indexOf(table);
  return index === -1 ? TABLE_ORDER.length : index;
}

/** Paket stabil nach Tabellen-Abhängigkeit sortieren. */
export function orderBatch(batch: SaveOp[]): SaveOp[] {
  return batch
    .map((op, index) => ({ op, index }))
    .sort((a, b) => rank(a.op.table) - rank(b.op.table) || a.index - b.index)
    .map(({ op }) => op);
}

/**
 * Papierkorb erst nach dem RPC derselben Zeile (D-5): complete_task und close_recap finden eine
 * schon gelöschte Zeile nicht (P0002) – „abhaken, dann löschen“ im selben Paket ginge sonst
 * verloren, samt der Folgeaufgabe. Zurückholen (`deleted_at: null`) bleibt davor.
 */
const TRASH_AFTER_RPC: Readonly<Record<string, string>> = {
  tasks: RPC_TASK_STATUS,
  recaps: RPC_CLOSE_RECAP,
};

const isTrashing = (op: SaveOp) =>
  op.mode === "update" && op.values.deleted_at !== null && op.values.deleted_at !== undefined;

const hasDeferred = (op: SaveOp) =>
  (DEFERRED_COLUMNS[op.table] ?? []).some((column) => column in op.values);

/**
 * Reihenfolge, in der die Warteschlange ein Paket nach einem dauerhaften Fehler einzeln sendet
 * (D-10) – dieselbe wie `planSteps`: Tabellen nach Abhängigkeit, Papierkorb nach dem RPC der
 * Zeile, Ops mit rückwärts verweisenden Spalten danach, endgültig Löschen zuletzt.
 */
export function isolationOrder(batch: SaveOp[]): SaveOp[] {
  const place = (op: SaveOp) => {
    if (op.table === RPC_EMPTY_TRASH) return [2, rank(op.table)];
    if (hasDeferred(op)) return [1, rank(op.table)];
    const after = TRASH_AFTER_RPC[op.table];
    return [0, after && isTrashing(op) ? rank(after) + 0.5 : rank(op.table)];
  };
  return batch
    .map((op, index) => ({ op, index, at: place(op) }))
    .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.index - b.index)
    .map(({ op }) => op);
}

export type SaveStep =
  | { kind: "upsert"; table: string; rows: Array<Record<string, unknown>> }
  | { kind: "update"; table: string; id: string; values: Record<string, unknown> }
  | { kind: "rpc"; table: string; id: string; values: Record<string, unknown> }
  | { kind: "purge"; entity: string; ids: string[] };

const columnsOf = (op: SaveOp) => Object.keys(op.values).sort().join(",");

/**
 * Sortiertes Paket → Aufrufe. Je Tabelle zuerst die Upserts (gleiche Spalten in einem Aufruf),
 * dann die Updates. Soft-Deletes von Aufgaben und Rückblicken warten bis nach ihrem RPC (D-5).
 * Je Datensatz gibt es höchstens eine Operation im Paket, die Reihenfolge je Datensatz bleibt
 * also erhalten.
 */
export function planSteps(batch: SaveOp[]): SaveStep[] {
  const steps: SaveStep[] = [];
  const deferred: SaveStep[] = [];
  // RPC-Tabelle → Soft-Deletes, die erst nach ihr dran sind
  const held = new Map<string, SaveStep[]>();
  const release = (upTo: number) => {
    for (const [rpc, list] of held) {
      if (rank(rpc) > upTo) continue;
      steps.push(...list);
      held.delete(rpc);
    }
  };
  // endgültig löschen ganz zum Schluss (auch nach den zurückgestellten Spalten)
  const purges = new Map<string, string[]>();
  const ordered = orderBatch(batch);
  let i = 0;
  while (i < ordered.length) {
    const table = (ordered[i] as SaveOp).table;
    release(rank(table) - 1);
    const upserts = new Map<string, Array<Record<string, unknown>>>();
    const after = TRASH_AFTER_RPC[table];
    const updates: SaveStep[] = [];
    const late = DEFERRED_COLUMNS[table] ?? [];
    for (; i < ordered.length && (ordered[i] as SaveOp).table === table; i++) {
      const original = ordered[i] as SaveOp;
      let op = original;
      if (late.length > 0) {
        const values: Record<string, unknown> = {};
        const postponed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(original.values)) {
          if (late.includes(key)) postponed[key] = value;
          else values[key] = value;
        }
        if (Object.keys(postponed).length > 0) {
          deferred.push({ kind: "update", table, id: original.id, values: postponed });
          op = { ...original, values };
          if (op.mode === "update" && Object.keys(values).length === 0) continue;
        }
      }
      if (table === RPC_EMPTY_TRASH) {
        const entity = String(op.values.entity ?? "");
        purges.set(entity, [...(purges.get(entity) ?? []), op.id]);
      } else if (table.startsWith("rpc:")) {
        updates.push({ kind: "rpc", table, id: op.id, values: op.values });
      } else if (op.mode === "upsert") {
        const columns = columnsOf(op);
        const rows = upserts.get(columns) ?? [];
        rows.push(CONFLICT_KEYS[table] ? { ...op.values } : { ...op.values, id: op.id });
        upserts.set(columns, rows);
      } else if (after && isTrashing(op)) {
        held.set(after, [
          ...(held.get(after) ?? []),
          { kind: "update", table, id: op.id, values: op.values },
        ]);
      } else {
        updates.push({ kind: "update", table, id: op.id, values: op.values });
      }
    }
    for (const rows of upserts.values()) steps.push({ kind: "upsert", table, rows });
    steps.push(...updates);
    release(rank(table));
  }
  release(Number.POSITIVE_INFINITY);
  const purgeSteps = [...purges].map(([entity, ids]): SaveStep => ({ kind: "purge", entity, ids }));
  return [...steps, ...deferred, ...purgeSteps];
}

/** Minimaler Ausschnitt von supabase-js, den der Persister braucht (testbar ohne Netz). */
export interface PersisterClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error: ErrorLike | null }>;
  from(table: string): {
    upsert(
      rows: Array<Record<string, unknown>>,
      options: { onConflict: string; defaultToNull: boolean },
    ): PromiseLike<{ error: ErrorLike | null }>;
    update(values: Record<string, unknown>): {
      eq(
        column: "id",
        value: string,
      ): {
        select(columns: "id"): PromiseLike<{ data: unknown[] | null; error: ErrorLike | null }>;
      };
    };
    /** Abgleich übernommener Operationen mit dem Serverstand (V-4) */
    select?(columns: "id, updated_at"): {
      in(
        column: "id",
        values: string[],
      ): PromiseLike<{ data: Array<Record<string, unknown>> | null; error: ErrorLike | null }>;
    };
  };
}

/** Spielraum nach dem Uhrenabgleich, ohne dass es als „neuer“ zählt. */
export const STALE_SKEW_MS = 5_000;
export const STALE_CODE = "STALE";

/**
 * Abweichung der Geräteuhr von der Datenbank (ms, positiv = Server geht vor) über `server_now`
 * (Migration 50) – sonst 0. Geräteuhren gehen falsch, in Tests stehen sie fest: ohne Abgleich
 * zählte Aktuelles als veraltet oder Veraltetes als aktuell.
 */
async function clockSkewMs(client: PersisterClient, now: () => number): Promise<number> {
  try {
    const { data, error } = await client.rpc("server_now", {});
    const serverNow = typeof data === "string" ? Date.parse(data) : Number.NaN;
    if (error || Number.isNaN(serverNow)) return 0;
    return serverNow - now();
  } catch {
    return 0;
  }
}

/**
 * Übernommene Operationen (verwaister Tab, letzte Sitzung – `adopted`, V-4) gegen `updated_at`
 * auf dem Server prüfen: Wurde die Zeile nach dem Eintragen der Operation anderswo geändert
 * (iPhone, KI, anderer Tab), darf der alte Stand sie nicht überschreiben. Liefert die Schlüssel
 * der veralteten Operationen. Tabellen ohne `updated_at` oder ohne Abfrage zählen als aktuell.
 */
export async function staleAdoptedOps(
  client: PersisterClient,
  batch: SaveOp[],
  skewMs = STALE_SKEW_MS,
  now: () => number = Date.now,
): Promise<Set<string>> {
  const stale = new Set<string>();
  const byTable = new Map<string, SaveOp[]>();
  for (const op of batch) {
    if (
      !op.adopted ||
      op.at === undefined ||
      op.table.startsWith("rpc:") ||
      CONFLICT_KEYS[op.table]
    )
      continue;
    byTable.set(op.table, [...(byTable.get(op.table) ?? []), op]);
  }
  if (byTable.size === 0) return stale;
  const skew = await clockSkewMs(client, now);
  for (const [table, ops] of byTable) {
    const select = client.from(table).select;
    if (!select) continue;
    const { data, error } = await select.call(client.from(table), "id, updated_at").in(
      "id",
      ops.map((op) => op.id),
    );
    if (error || !data) continue;
    const updatedAt = new Map(
      data.map((row) => [String(row.id), Date.parse(String(row.updated_at ?? ""))]),
    );
    for (const op of ops) {
      const serverAt = updatedAt.get(op.id);
      if (
        serverAt !== undefined &&
        !Number.isNaN(serverAt) &&
        serverAt > (op.at as number) + skew + skewMs
      )
        stale.add(opKey(op));
    }
  }
  return stale;
}

const opKey = (op: Pick<SaveOp, "table" | "id">) => `${op.table}:${op.id}`;

/** Zeilen einer Upsert-Stufe, deren `task_id` auf eine gelöschte Aufgabe zeigt, lösen (V-13). */
export function unbindTaskRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> | null {
  if (!rows.some((row) => typeof row.task_id === "string")) return null;
  return rows.map((row) => (typeof row.task_id === "string" ? { ...row, task_id: null } : row));
}

export function createSupabasePersister(
  getClient: () => PersisterClient,
  options: { onPersisted?: (batch: SaveOp[]) => void } = {},
): (batch: SaveOp[]) => Promise<void> {
  return async (batch) => {
    const client = getClient();
    // übernommene Operationen gegen den Serverstand (V-4): veraltet → dauerhafter Fehler dieser
    // Operation (die Warteschlange isoliert sie, der Rest geht weiter)
    if (batch.some((op) => op.adopted)) {
      const stale = await staleAdoptedOps(client, batch);
      const first = batch.find((op) => stale.has(opKey(op)));
      if (first) {
        throw new SaveError(
          `${first.table}: auf dem Server inzwischen geändert – die Änderung aus der früheren Sitzung wurde nicht übernommen (Speicherstatus: „Erneut versuchen“ wendet sie trotzdem an, „Verwerfen“ lässt sie weg)`,
          STALE_CODE,
          false,
        );
      }
    }
    for (const step of planSteps(batch)) {
      if (step.kind === "purge") {
        if (!(PURGEABLE_TABLES as readonly string[]).includes(step.entity)) {
          throw new SaveError(`${RPC_EMPTY_TRASH}: unbekannter Typ`, "UNKNOWN_RPC", false);
        }
        const { error } = await client.rpc("empty_trash", {
          p_entity: step.entity,
          p_ids: step.ids,
        });
        if (error) throw toSaveError(error, RPC_EMPTY_TRASH);
      } else if (step.kind === "rpc" && step.table === RPC_NOTE_TYPE) {
        const { action, p_target, p_note_ids } = step.values;
        const { error } =
          action === "delete" && typeof p_target === "string"
            ? await client.rpc("delete_note_type", { p_key: step.id, p_target })
            : action === "restore"
              ? await client.rpc("restore_note_type", {
                  p_key: step.id,
                  p_note_ids: Array.isArray(p_note_ids) ? p_note_ids : [],
                })
              : { error: null };
        if (action !== "delete" && action !== "restore") {
          throw new SaveError(`${step.table}: unbekannte Aktion`, "UNKNOWN_RPC", false);
        }
        if (error) throw toSaveError(error, step.table);
      } else if (step.kind === "rpc" && step.table === RPC_CLOSE_RECAP) {
        const { error } = await client.rpc("close_recap", { p_recap_id: step.id });
        if (error) throw toSaveError(error, step.table);
      } else if (step.kind === "rpc" && step.table === RPC_RECAP_ANSWER) {
        for (const [key, value] of Object.entries(step.values)) {
          const { error } = await client.rpc("recap_set_answer", {
            p_recap_id: step.id,
            p_key: key,
            p_value: value ?? null,
          });
          if (error) throw toSaveError(error, step.table);
        }
      } else if (step.kind === "rpc") {
        const { action, ...args } = step.values;
        if (step.table !== RPC_TASK_STATUS || (action !== "complete" && action !== "undo")) {
          throw new SaveError(`${step.table}: unbekannte Aktion`, "UNKNOWN_RPC", false);
        }
        const { error } = await client.rpc(
          action === "complete" ? "complete_task" : "undo_complete_task",
          action === "complete"
            ? {
                p_task_id: step.id,
                ...(args.p_next_due && args.p_next_id
                  ? { p_next_due: args.p_next_due, p_next_id: args.p_next_id }
                  : {}),
              }
            : { p_task_id: step.id },
        );
        if (error) throw toSaveError(error, step.table);
      } else if (step.kind === "upsert") {
        const options = { onConflict: CONFLICT_KEYS[step.table] ?? "id", defaultToNull: false };
        let { error } = await client.from(step.table).upsert(step.rows, options);
        // Block → Aufgabe, aber die Aufgabe ist endgültig gelöscht (V-13, 23503 auf task_id): die
        // Bindung lösen und den Text trotzdem speichern statt eines Dauerfehlers
        const unbound =
          error?.code === "23503" && step.table === "note_blocks"
            ? unbindTaskRows(step.rows)
            : null;
        if (unbound) ({ error } = await client.from(step.table).upsert(unbound, options));
        if (error) throw toSaveError(error, step.table);
      } else if (CONFLICT_KEYS[step.table]) {
        throw new SaveError(
          `${step.table}: nur ganze Zeilen speicherbar (Upsert)`,
          "UPSERT_ONLY",
          false,
        );
      } else {
        const { data, error } = await client
          .from(step.table)
          .update(step.values)
          .eq("id", step.id)
          .select("id");
        if (error) throw toSaveError(error, step.table);
        if (!data || data.length === 0) {
          throw new SaveError(
            `${step.table}: Datensatz nicht gefunden (Änderung bleibt lokal gespeichert)`,
            "NOT_FOUND",
            false,
          );
        }
      }
    }
    options.onPersisted?.(batch);
  };
}
