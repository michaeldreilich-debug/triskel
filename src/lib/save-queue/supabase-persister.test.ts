import { describe, expect, it, vi } from "vitest";
import type { SaveOp } from "./save-queue";
import {
  createSupabasePersister,
  isObsoleteRestore,
  isolationOrder,
  isRetryableSaveError,
  orderBatch,
  type PersisterClient,
  planSteps,
  RPC_CLOSE_RECAP,
  RPC_EMPTY_TRASH,
  RPC_NOTE_TYPE,
  RPC_RECAP_ANSWER,
  RPC_TASK_STATUS,
  SaveError,
  STALE_CODE,
  staleAdoptedOps,
  unbindTaskRows,
} from "./supabase-persister";

const upsert = (table: string, id: string, values: Record<string, unknown> = {}): SaveOp => ({
  table,
  id,
  mode: "upsert",
  values: { title: id, ...values },
});
const update = (table: string, id: string, values: Record<string, unknown>): SaveOp => ({
  table,
  id,
  mode: "update",
  values,
});

/** Fake-Client: protokolliert Aufrufe, Antworten steuerbar. */
function fakeClient(
  respond: (call: { table: string; kind: string; payload: unknown }) => {
    error?: { code?: string; message?: string } | null;
    data?: unknown[] | null;
  } = () => ({}),
) {
  const calls: Array<{
    table: string;
    kind: string;
    payload: unknown;
    id?: string;
    onConflict?: string;
  }> = [];
  const client: PersisterClient = {
    rpc: (fn, args) => {
      calls.push({ table: fn, kind: "rpc", payload: args });
      const r = respond({ table: fn, kind: "rpc", payload: args });
      return Promise.resolve({ error: r.error ?? null });
    },
    from: (table) => ({
      upsert: (rows, options) => {
        calls.push({ table, kind: "upsert", payload: rows, onConflict: options.onConflict });
        const r = respond({ table, kind: "upsert", payload: rows });
        return Promise.resolve({ error: r.error ?? null });
      },
      update: (values) => ({
        eq: (_column, id) => ({
          select: () => {
            calls.push({ table, kind: "update", payload: values, id });
            const r = respond({ table, kind: "update", payload: values });
            return Promise.resolve({
              data: r.data === undefined ? [{ id }] : r.data,
              error: r.error ?? null,
            });
          },
        }),
      }),
      select: () => ({
        in: (_column, ids) => {
          calls.push({ table, kind: "select", payload: ids });
          const r = respond({ table, kind: "select", payload: ids });
          return Promise.resolve({
            data: (r.data ?? []) as Array<Record<string, unknown>>,
            error: r.error ?? null,
          });
        },
      }),
    }),
  };
  return { client, calls };
}

describe("Reihenfolge und Planung", () => {
  it("sortiert stabil nach Tabellen-Abhängigkeit (Notiz vor Block, Thema vor Notiz)", () => {
    const batch = [
      upsert("note_blocks", "b1"),
      upsert("notes", "n1"),
      upsert("note_blocks", "b2"),
      upsert("topics", "t1"),
      upsert("unbekannt", "x"),
      upsert("areas", "a1"),
    ];
    expect(orderBatch(batch).map((op) => op.id)).toEqual(["a1", "t1", "n1", "b1", "b2", "x"]);
  });

  it("bündelt Upserts gleicher Spalten je Tabelle, Updates danach einzeln", () => {
    const steps = planSteps([
      upsert("note_blocks", "b1", { note_id: "n" }),
      update("note_blocks", "b0", { deleted_at: "2026-10-11T10:00:00.000Z" }),
      upsert("note_blocks", "b2", { note_id: "n" }),
      upsert("notes", "n1"),
      upsert("note_blocks", "b3", { note_id: "n", extra: 1 }),
    ]);
    expect(steps).toEqual([
      { kind: "upsert", table: "notes", rows: [{ title: "n1", id: "n1" }] },
      {
        kind: "upsert",
        table: "note_blocks",
        rows: [
          { title: "b1", note_id: "n", id: "b1" },
          { title: "b2", note_id: "n", id: "b2" },
        ],
      },
      {
        kind: "upsert",
        table: "note_blocks",
        rows: [{ title: "b3", note_id: "n", extra: 1, id: "b3" }],
      },
      {
        kind: "update",
        table: "note_blocks",
        id: "b0",
        values: { deleted_at: "2026-10-11T10:00:00.000Z" },
      },
    ]);
  });
});

describe("createSupabasePersister", () => {
  it("führt die Schritte in Reihenfolge aus und meldet das gespeicherte Paket", async () => {
    const { client, calls } = fakeClient();
    const onPersisted = vi.fn();
    const persist = createSupabasePersister(() => client, { onPersisted });
    const batch = [upsert("note_blocks", "b1"), upsert("notes", "n1"), update("notes", "n0", {})];
    await persist(batch);
    expect(calls.map((c) => `${c.kind}:${c.table}`)).toEqual([
      "upsert:notes",
      "update:notes",
      "upsert:note_blocks",
    ]);
    expect(onPersisted).toHaveBeenCalledWith(batch);
  });

  it("bricht beim ersten Fehler ab (Rest wird mit dem Paket wiederholt)", async () => {
    const { client, calls } = fakeClient(({ table }) =>
      table === "notes" ? { error: { code: "", message: "TypeError: fetch failed" } } : {},
    );
    const persist = createSupabasePersister(() => client);
    const error = await persist([upsert("notes", "n1"), upsert("note_blocks", "b1")]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SaveError);
    expect(isRetryableSaveError(error)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("Constraint-Verletzung ist dauerhaft", async () => {
    const { client } = fakeClient(() => ({ error: { code: "23514", message: "check" } }));
    const error = await createSupabasePersister(() => client)([upsert("tasks", "t1")]).catch(
      (e: unknown) => e,
    );
    expect(isRetryableSaveError(error)).toBe(false);
    expect((error as SaveError).message).toMatch(/^tasks: check/);
  });

  it("Update ohne getroffene Zeile ist ein dauerhafter Fehler (nichts geht still verloren)", async () => {
    const { client } = fakeClient(() => ({ data: [] }));
    const error = await createSupabasePersister(() => client)([
      update("notes", "fehlt", { title: "x" }),
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SaveError);
    expect((error as SaveError).code).toBe("NOT_FOUND");
    expect(isRetryableSaveError(error)).toBe(false);
  });
});

describe("rückwärts verweisende Spalten (projects.next_task_id)", () => {
  it("setzt den nächsten Schritt erst nach dem Anlegen der Aufgabe im selben Paket", () => {
    const steps = planSteps([
      upsert("projects", "p1", { next_task_id: "t-neu" }),
      update("projects", "p2", { next_task_id: "t-neu", title: "Umbenannt" }),
      update("projects", "p3", { next_task_id: "t-neu" }),
      upsert("tasks", "t-neu"),
    ]);
    expect(steps).toEqual([
      { kind: "upsert", table: "projects", rows: [{ title: "p1", id: "p1" }] },
      { kind: "update", table: "projects", id: "p2", values: { title: "Umbenannt" } },
      { kind: "upsert", table: "tasks", rows: [{ title: "t-neu", id: "t-neu" }] },
      { kind: "update", table: "projects", id: "p1", values: { next_task_id: "t-neu" } },
      { kind: "update", table: "projects", id: "p2", values: { next_task_id: "t-neu" } },
      { kind: "update", table: "projects", id: "p3", values: { next_task_id: "t-neu" } },
    ]);
  });
});

describe("Tabellen ohne id-Spalte (task_dependencies)", () => {
  it("Upsert über den Konfliktschlüssel, ohne lokale id; nach der Aufgabe gespeichert", async () => {
    const { client, calls } = fakeClient();
    const persist = createSupabasePersister(() => client);
    await persist([
      {
        table: "task_dependencies",
        id: "t1:t0",
        mode: "upsert",
        values: { task_id: "t1", blocked_by_task_id: "t0", deleted_at: null },
      },
      upsert("tasks", "t1"),
    ]);
    expect(calls.map((c) => [c.table, c.onConflict])).toEqual([
      ["tasks", "id"],
      ["task_dependencies", "task_id,blocked_by_task_id"],
    ]);
    expect(calls[1]?.payload).toEqual([
      { task_id: "t1", blocked_by_task_id: "t0", deleted_at: null },
    ]);
  });

  it("Update statt Upsert ist ein dauerhafter Fehler (nie still verloren)", async () => {
    const { client } = fakeClient();
    const persist = createSupabasePersister(() => client);
    await expect(
      persist([update("task_dependencies", "t1:t0", { deleted_at: "2026-10-11T00:00:00Z" })]),
    ).rejects.toMatchObject({ code: "UPSERT_ONLY", retryable: false });
  });
});

describe("Erledigen/Wiedereröffnen (rpc:task_status)", () => {
  const status = (id: string, values: Record<string, unknown>): SaveOp => ({
    table: "rpc:task_status",
    id,
    mode: "update",
    values,
  });

  it("ruft complete_task bzw. undo_complete_task nach den Aufgaben-Zeilen auf", async () => {
    const { client, calls } = fakeClient();
    const persist = createSupabasePersister(() => client);
    await persist([
      status("t1", { action: "complete", p_next_due: "2026-10-12", p_next_id: "n1" }),
      upsert("tasks", "t1"),
      status("t2", { action: "undo", p_next_due: null, p_next_id: null }),
      status("t3", { action: "complete", p_next_due: null, p_next_id: null }),
    ]);
    expect(calls.map((c) => [c.kind, c.table])).toEqual([
      ["upsert", "tasks"],
      ["rpc", "complete_task"],
      ["rpc", "undo_complete_task"],
      ["rpc", "complete_task"],
    ]);
    expect(calls[1]?.payload).toEqual({
      p_task_id: "t1",
      p_next_due: "2026-10-12",
      p_next_id: "n1",
    });
    expect(calls[2]?.payload).toEqual({ p_task_id: "t2" });
    expect(calls[3]?.payload).toEqual({ p_task_id: "t3" });
  });

  it("Fehler des RPC: dauerhaft (P0002) bzw. wiederholbar (Netz)", async () => {
    const permanent = fakeClient(() => ({ error: { code: "P0002", message: "nicht gefunden" } }));
    await expect(
      createSupabasePersister(() => permanent.client)([status("x", { action: "complete" })]),
    ).rejects.toMatchObject({ retryable: false });
    const network = fakeClient(() => ({ error: { message: "Failed to fetch" } }));
    await expect(
      createSupabasePersister(() => network.client)([status("x", { action: "undo" })]),
    ).rejects.toMatchObject({ retryable: true });
    const unknown = fakeClient();
    await expect(
      createSupabasePersister(() => unknown.client)([status("x", { action: "löschen" })]),
    ).rejects.toMatchObject({ code: "UNKNOWN_RPC", retryable: false });
  });
});

describe("Erledigen bzw. Abschließen und Papierkorb im selben Paket (D-5)", () => {
  const trash = (table: string, id: string) =>
    update(table, id, { deleted_at: "2026-10-18T08:00" });

  it("hakt eine Aufgabe erst ab und legt sie dann in den Papierkorb", async () => {
    const { client, calls } = fakeClient();
    await createSupabasePersister(() => client)([
      trash("tasks", "t1"),
      update("tasks", "t2", { title: "neu" }),
      {
        table: RPC_TASK_STATUS,
        id: "t1",
        mode: "update",
        values: { action: "complete", p_next_due: "2026-10-25", p_next_id: "n1" },
      },
    ]);
    expect(calls.map((c) => [c.kind, c.table, c.id ?? ""])).toEqual([
      ["update", "tasks", "t2"],
      ["rpc", "complete_task", ""],
      ["update", "tasks", "t1"],
    ]);
  });

  it("schließt einen Rückblick erst ab und legt ihn dann in den Papierkorb", async () => {
    const { client, calls } = fakeClient();
    await createSupabasePersister(() => client)([
      { table: RPC_CLOSE_RECAP, id: "r1", mode: "update", values: {} },
      update("recaps", "r1", { answers: { good: "viel" }, deleted_at: "2026-10-18T08:00" }),
      update("recaps", "r2", { answers: { good: "wenig" } }),
    ]);
    expect(calls.map((c) => [c.kind, c.table, c.id ?? ""])).toEqual([
      ["update", "recaps", "r2"],
      ["rpc", "close_recap", ""],
      ["update", "recaps", "r1"],
    ]);
  });

  it("Papierkorb ohne RPC im Paket bleibt an seinem Platz vor den späteren Tabellen", () => {
    const steps = planSteps([upsert("notes", "n1"), trash("tasks", "t1")]);
    expect(steps.map((s) => [s.kind, "table" in s ? s.table : ""])).toEqual([
      ["update", "tasks"],
      ["upsert", "notes"],
    ]);
  });

  it("Zurückholen (deleted_at: null) geht vor dem Abhaken", () => {
    const steps = planSteps([
      { table: RPC_TASK_STATUS, id: "t1", mode: "update", values: { action: "complete" } },
      update("tasks", "t1", { deleted_at: null }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["update", "rpc"]);
  });
});

describe("Einzeln senden nach einem dauerhaften Fehler (D-10)", () => {
  it("folgt der Reihenfolge des Pakets: rückwärts verweisende Spalten und Papierkorb zuletzt", () => {
    const ordered = isolationOrder([
      update("projects", "p1", { next_task_id: "t9" }),
      upsert("note_blocks", "b1", { content: "[[Neu]]" }),
      upsert("notes", "n1"),
      { table: RPC_EMPTY_TRASH, id: "x1", mode: "update", values: { entity: "notes" } },
      update("tasks", "t1", { deleted_at: "2026-10-18T08:00" }),
      { table: RPC_TASK_STATUS, id: "t1", mode: "update", values: { action: "complete" } },
      upsert("tasks", "t9"),
    ]);
    expect(ordered.map((op) => `${op.table}:${op.id}`)).toEqual([
      "tasks:t9",
      `${RPC_TASK_STATUS}:t1`,
      "tasks:t1",
      "notes:n1",
      "note_blocks:b1",
      "projects:p1",
      `${RPC_EMPTY_TRASH}:x1`,
    ]);
  });
});

describe("Rückblick abschließen (rpc:close_recap, B12)", () => {
  it("schließt nach den Rückblick-Zeilen ab", async () => {
    const { client, calls } = fakeClient();
    await createSupabasePersister(() => client)([
      { table: RPC_CLOSE_RECAP, id: "r1", mode: "update", values: {} },
      { table: "recaps", id: "r1", mode: "update", values: { answers: { good: "viel" } } },
    ]);
    expect(calls.map((c) => [c.kind, c.table])).toEqual([
      ["update", "recaps"],
      ["rpc", "close_recap"],
    ]);
    expect(calls[1]?.payload).toEqual({ p_recap_id: "r1" });
  });
});

describe("Endgültig löschen (rpc:empty_trash, B13)", () => {
  const purge = (id: string, entity: string): SaveOp => ({
    table: RPC_EMPTY_TRASH,
    id,
    mode: "update",
    values: { entity },
  });

  it("bündelt je Tabelle und löscht erst nach allen anderen Schritten (auch Soft-Deletes)", async () => {
    const { client, calls } = fakeClient();
    const persist = createSupabasePersister(() => client);
    await persist([
      purge("n1", "notes"),
      purge("t1", "tasks"),
      update("tasks", "t1", { deleted_at: "2026-10-16T10:00:00Z" }),
      purge("n2", "notes"),
      update("projects", "p1", { next_task_id: "t9" }),
    ]);
    // next_task_id ist zurückgestellt (DEFERRED_COLUMNS) – endgültig gelöscht wird danach
    expect(calls.map((c) => [c.kind, c.table])).toEqual([
      ["update", "tasks"],
      ["update", "projects"],
      ["rpc", "empty_trash"],
      ["rpc", "empty_trash"],
    ]);
    expect(calls[2]?.payload).toEqual({ p_entity: "notes", p_ids: ["n1", "n2"] });
    expect(calls[3]?.payload).toEqual({ p_entity: "tasks", p_ids: ["t1"] });
  });

  it("unbekannte Tabelle ist ein dauerhafter Fehler, Netzfehler werden wiederholt", async () => {
    const { client, calls } = fakeClient();
    await expect(
      createSupabasePersister(() => client)([purge("x", "areas")]),
    ).rejects.toMatchObject({ code: "UNKNOWN_RPC", retryable: false });
    expect(calls).toEqual([]);
    const network = fakeClient(() => ({ error: { message: "Failed to fetch" } }));
    await expect(
      createSupabasePersister(() => network.client)([purge("x", "notes")]),
    ).rejects.toMatchObject({ retryable: true });
  });
});

describe("isRetryableSaveError", () => {
  it.each([
    ["", true], // Netzfehler (fetch failed)
    ["PGRST301", true], // JWT abgelaufen → nach Auffrischen erneut
    ["PGRST000", true], // Verbindung
    ["57014", true], // Abbruch/Timeout
    ["40001", true], // Serialisierung
    ["23505", false],
    ["23503", false],
    ["23514", false],
    ["22P02", false],
    ["42501", false], // RLS/Rechte
    ["42703", false],
    ["P0001", false],
    ["PGRST204", false], // Spalte unbekannt
    ["PGRST116", false],
  ])("Code %s → wiederholbar: %s", (code, retryable) => {
    expect(isRetryableSaveError({ code, message: "x" })).toBe(retryable);
  });

  it("unbekannte Fehler (z. B. TypeError) werden wiederholt", () => {
    expect(isRetryableSaveError(new TypeError("Failed to fetch"))).toBe(true);
  });
});

describe("Notiz-Typ löschen und zurückholen (rpc:note_type, #34)", () => {
  it("löscht nach den Notizen und Vorlagen des Pakets; Rückgängig holt Typ und Notizen zurück", async () => {
    const { client, calls } = fakeClient();
    await createSupabasePersister(() => client)([
      {
        table: RPC_NOTE_TYPE,
        id: "besprechung",
        mode: "update",
        values: { action: "delete", p_target: "protokoll" },
      },
      { table: "notes", id: "n1", mode: "update", values: { type: "besprechung" } },
      {
        table: "note_types",
        id: "t1",
        mode: "upsert",
        values: { key: "besprechung", name: "Besprechung", sort: "a6" },
      },
    ]);
    expect(calls.map((c) => [c.kind, c.table])).toEqual([
      ["upsert", "note_types"],
      ["update", "notes"],
      ["rpc", "delete_note_type"],
    ]);
    expect(calls[2]?.payload).toEqual({ p_key: "besprechung", p_target: "protokoll" });

    const second = fakeClient();
    await createSupabasePersister(() => second.client)([
      {
        table: RPC_NOTE_TYPE,
        id: "besprechung",
        mode: "update",
        values: { action: "restore", p_note_ids: ["n1"] },
      },
    ]);
    expect(second.calls[0]?.payload).toEqual({ p_key: "besprechung", p_note_ids: ["n1"] });
  });
});

describe("isObsoleteRestore (D-9)", () => {
  const notFound = new SaveError("tasks: Datensatz nicht gefunden", "NOT_FOUND", false);
  const restore: SaveOp = {
    table: "tasks",
    id: "t1",
    mode: "update",
    values: { deleted_at: null },
  };

  it("nur das reine Zurückholen eines nicht mehr vorhandenen Datensatzes ist gegenstandslos", () => {
    expect(isObsoleteRestore(restore, notFound)).toBe(true);
    // andere Fehler oder Änderungen mit Inhalt bleiben in „fehlgeschlagen“
    expect(isObsoleteRestore(restore, new SaveError("x", "23514", false))).toBe(false);
    expect(
      isObsoleteRestore({ ...restore, values: { deleted_at: null, title: "neu" } }, notFound),
    ).toBe(false);
    expect(
      isObsoleteRestore({ ...restore, values: { deleted_at: "2026-10-17T00:00:00Z" } }, notFound),
    ).toBe(false);
    expect(isObsoleteRestore({ ...restore, mode: "upsert" }, notFound)).toBe(false);
  });
});

describe("Übernommene Operationen gegen den Serverstand (Review Teil B, V-4)", () => {
  const at = Date.parse("2026-10-24T10:00:00Z");
  const adopted = (id: string, values: Record<string, unknown>): SaveOp => ({
    ...upsert("note_blocks", id, values),
    at,
    adopted: true,
  });

  it("veraltet nur, wenn updated_at deutlich nach dem Eintragen liegt; eigene Ops nie geprüft", async () => {
    const { client, calls } = fakeClient(({ kind }) =>
      kind === "select"
        ? {
            data: [
              { id: "b1", updated_at: "2026-10-24T10:00:03Z" },
              { id: "b2", updated_at: "2026-10-24T11:00:00Z" },
            ],
          }
        : {},
    );
    const stale = await staleAdoptedOps(client, [
      adopted("b1", { content_text: "fast gleichzeitig" }),
      adopted("b2", { content_text: "alt" }),
      adopted("b3", { content_text: "neu angelegt" }),
      upsert("note_blocks", "b4", { content_text: "eigene, frische Änderung" }),
      { ...update(RPC_TASK_STATUS, "t1", { action: "complete" }), at, adopted: true },
    ]);
    expect([...stale]).toEqual(["note_blocks:b2"]);
    // ein Uhrenabgleich (server_now, hier ohne Antwort → 0) und eine Abfrage je Tabelle
    expect(calls.map((c) => c.kind)).toEqual(["rpc", "select"]);
    expect(calls.find((c) => c.kind === "select")?.payload).toEqual(["b1", "b2", "b3"]);
  });

  it("Uhrenabgleich (Migration 50): steht die Geräteuhr falsch, zählt die Serverzeit", async () => {
    // Gerät 5 Wochen zurück (z. B. feste Uhr im Test): der Server geht vor, trotzdem nicht veraltet
    const deviceNow = Date.parse("2026-09-15T12:00:00Z");
    const { client, calls } = fakeClient(({ kind }) =>
      kind === "select" ? { data: [{ id: "b1", updated_at: "2026-10-24T11:59:58Z" }] } : {},
    );
    const rpcClient: PersisterClient = {
      ...client,
      rpc: async (fn, args) => {
        if (fn !== "server_now") return client.rpc(fn, args);
        calls.push({ table: fn, kind: "rpc", payload: args });
        return { data: "2026-10-24T12:00:00Z", error: null };
      },
    };
    const op = (at: number): SaveOp => ({
      ...upsert("note_blocks", "b1", { content_text: "x" }),
      at,
      adopted: true,
    });
    expect([
      ...(await staleAdoptedOps(rpcClient, [op(deviceNow - 1_000)], 5_000, () => deviceNow)),
    ]).toEqual([]);
    expect(calls.some((c) => c.kind === "rpc" && c.table === "server_now")).toBe(true);
    // Zeile wirklich später geändert (eine Stunde nach der Op, in Serverzeit): veraltet
    expect([
      ...(await staleAdoptedOps(rpcClient, [op(deviceNow - 3_610_000)], 5_000, () => deviceNow)),
    ]).toEqual(["note_blocks:b1"]);
  });

  it("Persister: veraltete übernommene Operation ist ein dauerhafter Fehler, nichts wird gesendet", async () => {
    const { client, calls } = fakeClient(({ kind }) =>
      kind === "select" ? { data: [{ id: "b2", updated_at: "2026-10-24T11:00:00Z" }] } : {},
    );
    const persist = createSupabasePersister(() => client);
    await expect(persist([adopted("b2", { content_text: "alt" })])).rejects.toMatchObject({
      code: STALE_CODE,
      retryable: false,
    });
    expect(calls.map((c) => c.kind)).toEqual(["rpc", "select"]);
    // Tabelle ohne Abgleich (Fehler bei select) oder ohne Übernahme: wie bisher
    const { client: plain, calls: plainCalls } = fakeClient(({ kind }) =>
      kind === "select" ? { error: { code: "42703" } } : {},
    );
    await createSupabasePersister(() => plain)([adopted("b2", { content_text: "alt" })]);
    expect(plainCalls.map((c) => c.kind)).toEqual(["rpc", "select", "upsert"]);
  });
});

describe("Block → gelöschte Aufgabe (Review Teil B, V-13)", () => {
  it("23503 auf note_blocks: Bindung lösen und noch einmal senden, der Text bleibt", async () => {
    let attempt = 0;
    const { client, calls } = fakeClient(({ kind, table }) => {
      if (kind === "upsert" && table === "note_blocks") {
        attempt += 1;
        return attempt === 1 ? { error: { code: "23503", message: "fk task_id" } } : {};
      }
      return {};
    });
    const persist = createSupabasePersister(() => client);
    await persist([upsert("note_blocks", "b1", { content_text: "x", task_id: "weg" })]);
    const upserts = calls.filter((c) => c.kind === "upsert");
    expect(upserts).toHaveLength(2);
    expect(upserts[1]?.payload).toEqual([
      { title: "b1", content_text: "x", task_id: null, id: "b1" },
    ]);
    // ohne task_id ist 23503 ein echter Dauerfehler
    const { client: other } = fakeClient(({ kind }) =>
      kind === "upsert" ? { error: { code: "23503" } } : {},
    );
    await expect(
      createSupabasePersister(() => other)([upsert("note_blocks", "b2", { content_text: "y" })]),
    ).rejects.toMatchObject({ code: "23503", retryable: false });
    expect(unbindTaskRows([{ id: "a" }])).toBeNull();
  });
});

describe("Rückblick-Antwort feldweise (rpc:recap_answer, Review Teil B, V-2)", () => {
  it("ruft recap_set_answer je Schlüssel nach den Rückblick-Zeilen, vor dem Abschließen auf", async () => {
    const { client, calls } = fakeClient();
    const persist = createSupabasePersister(() => client);
    await persist([
      update(RPC_CLOSE_RECAP, "w1", {}),
      update(RPC_RECAP_ANSWER, "w1", { good: "Lauf", hard: null }),
      update("recaps", "w1", { mood: 4 }),
    ]);
    expect(calls.map((c) => [c.kind, c.table])).toEqual([
      ["update", "recaps"],
      ["rpc", "recap_set_answer"],
      ["rpc", "recap_set_answer"],
      ["rpc", "close_recap"],
    ]);
    expect(calls[1]?.payload).toEqual({ p_recap_id: "w1", p_key: "good", p_value: "Lauf" });
    expect(calls[2]?.payload).toEqual({ p_recap_id: "w1", p_key: "hard", p_value: null });
  });

  it("Fehler der RPC: Rückblick weg (P0002) dauerhaft, Netzfehler wiederholbar", async () => {
    const { client } = fakeClient(({ kind }) =>
      kind === "rpc" ? { error: { code: "P0002", message: "Rückblick nicht gefunden." } } : {},
    );
    await expect(
      createSupabasePersister(() => client)([update(RPC_RECAP_ANSWER, "w1", { good: "x" })]),
    ).rejects.toMatchObject({ code: "P0002", retryable: false });
  });
});
