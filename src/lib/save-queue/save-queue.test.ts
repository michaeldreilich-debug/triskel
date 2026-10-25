import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachSaveQueueLifecycle,
  backoffDelay,
  mergeOps,
  type SaveOp,
  SaveQueue,
  type SaveQueueOptions,
  type StorageLike,
} from "./save-queue";

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  stored(key = "sz:save-queue") {
    const raw = this.data.get(key);
    return raw ? (JSON.parse(raw) as { entries: SaveOp[]; failed: SaveOp[] }) : null;
  }
}

/** persist-Attrappe: zeichnet Pakete auf, Ergebnis je Aufruf steuerbar. */
function recorder() {
  const calls: SaveOp[][] = [];
  const outcomes: Array<"ok" | "fail" | "permanent" | Promise<void>> = [];
  const persist = vi.fn(async (batch: SaveOp[]) => {
    calls.push(batch);
    const outcome = outcomes.shift() ?? "ok";
    if (outcome === "fail") throw new Error("Netzwerkfehler");
    if (outcome === "permanent")
      throw Object.assign(new Error("Check-Verletzung"), { permanent: true });
    if (outcome instanceof Promise) await outcome;
  });
  return { calls, outcomes, persist };
}

const op = (
  id: string,
  values: Record<string, unknown>,
  mode: SaveOp["mode"] = "update",
  table = "tasks",
): SaveOp => ({
  table,
  id,
  values,
  mode,
});

let storage: MemoryStorage;

function makeQueue(persist: SaveQueueOptions["persist"], extra: Partial<SaveQueueOptions> = {}) {
  return new SaveQueue({
    persist,
    storage,
    debounceMs: 500,
    retryBaseMs: 1000,
    retryMaxMs: 8000,
    isRetryable: (e) => !(e as { permanent?: boolean }).permanent,
    ...extra,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = new MemoryStorage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Debounce", () => {
  it("sammelt Änderungen und speichert erst nach 500 ms Ruhe – als eine Operation", async () => {
    const r = recorder();
    const q = makeQueue(r.persist);
    q.enqueue(op("t1", { title: "E" }));
    await vi.advanceTimersByTimeAsync(300);
    q.enqueue(op("t1", { title: "Ei" }));
    await vi.advanceTimersByTimeAsync(300);
    q.enqueue(op("t1", { title: "Ein" }));
    expect(q.getSnapshot().status).toBe("pending");
    await vi.advanceTimersByTimeAsync(499);
    expect(r.persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.calls).toEqual([[op("t1", { title: "Ein" })]]);
    expect(q.getSnapshot()).toMatchObject({ status: "idle", pending: 0, failed: 0 });
  });

  it("flush() speichert sofort, ohne auf den Debounce zu warten", async () => {
    const r = recorder();
    const q = makeQueue(r.persist);
    q.enqueue(op("t1", { title: "x" }));
    await q.flush();
    expect(r.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.calls).toHaveLength(1);
  });
});

describe("Zusammenführen und Reihenfolge", () => {
  it("führt Felder zusammen; upsert gewinnt gegen update", () => {
    expect(
      mergeOps(op("a", { title: "x", status: "offen" }), op("a", { status: "erledigt" })),
    ).toEqual(op("a", { title: "x", status: "erledigt" }));
    expect(mergeOps(op("a", { title: "x" }, "upsert"), op("a", { title: "y" })).mode).toBe(
      "upsert",
    );
    expect(mergeOps(op("a", { title: "x" }), op("a", { title: "y" }, "upsert")).mode).toBe(
      "upsert",
    );
  });

  it("behält die Reihenfolge des ersten Eintragens (Notiz vor Blöcken)", async () => {
    const r = recorder();
    const q = makeQueue(r.persist);
    q.enqueue(op("n1", { title: "Notiz" }, "upsert", "notes"));
    q.enqueue(op("b1", { note_id: "n1" }, "upsert", "note_blocks"));
    q.enqueue(op("b2", { note_id: "n1" }, "upsert", "note_blocks"));
    q.enqueue(op("n1", { title: "Notiz 2" }, "update", "notes"));
    await q.flush();
    expect(r.calls[0]?.map((o) => `${o.table}:${o.id}`)).toEqual([
      "notes:n1",
      "note_blocks:b1",
      "note_blocks:b2",
    ]);
    expect(r.calls[0]?.[0]).toEqual(op("n1", { title: "Notiz 2" }, "upsert", "notes"));
  });

  it("serialisiert je Datensatz: nie zwei Pakete gleichzeitig, spätere Änderung folgt danach", async () => {
    const r = recorder();
    let release!: () => void;
    r.outcomes.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const q = makeQueue(r.persist);
    q.enqueue(op("t1", { title: "A" }));
    await vi.advanceTimersByTimeAsync(500);
    expect(q.getSnapshot().status).toBe("saving");

    q.enqueue(op("t1", { title: "B" }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.calls).toHaveLength(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(r.calls.map((b) => b[0]?.values.title)).toEqual(["A", "B"]);
    expect(q.getSnapshot().status).toBe("idle");
  });
});

describe("Wiederholung", () => {
  it("wiederholt mit exponentiellem Backoff und verliert keine Änderungen", async () => {
    const r = recorder();
    r.outcomes.push("fail", "fail", "ok");
    const q = makeQueue(r.persist);
    q.enqueue(op("t1", { title: "A" }));
    q.enqueue(op("t2", { title: "Z" }));

    await vi.advanceTimersByTimeAsync(500);
    expect(r.calls).toHaveLength(1);
    expect(q.getSnapshot()).toMatchObject({
      status: "retrying",
      attempts: 1,
      lastError: "Netzwerkfehler",
      pending: 2,
    });

    // während des Backoffs ändert sich t1 erneut – bleibt an erster Stelle, neuer Wert gewinnt
    q.enqueue(op("t1", { title: "A2" }));
    await vi.advanceTimersByTimeAsync(999);
    expect(r.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.calls).toHaveLength(2);
    expect(q.getSnapshot().attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(r.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.calls).toHaveLength(3);
    expect(r.calls[2]).toEqual([op("t1", { title: "A2" }), op("t2", { title: "Z" })]);
    expect(q.getSnapshot()).toMatchObject({
      status: "idle",
      attempts: 0,
      lastError: null,
      pending: 0,
    });
    expect(storage.stored()).toBeNull();
  });

  it("Backoff ist nach oben begrenzt", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, 1000, 8000))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });

  it("isoliert dauerhafte Fehler: nur die fehlerhafte Operation landet in failed", async () => {
    const r = recorder();
    // Paket mit 3 → dauerhaft; dann einzeln: ok, dauerhaft, ok
    r.outcomes.push("permanent", "ok", "permanent", "ok");
    const q = makeQueue(r.persist);
    q.enqueue(op("t1", { title: "gut" }));
    q.enqueue(op("t2", { title: "x".repeat(2000) }));
    q.enqueue(op("t3", { title: "auch gut" }));
    await q.flush();
    await vi.advanceTimersByTimeAsync(0);
    await q.flush();

    expect(r.calls.map((b) => b.map((o) => o.id))).toEqual([
      ["t1", "t2", "t3"],
      ["t1"],
      ["t2"],
      ["t3"],
    ]);
    expect(q.getSnapshot()).toMatchObject({ status: "error", failed: 1, pending: 0 });
    expect(storage.stored()?.failed.map((o) => o.id)).toEqual(["t2"]);
    expect(q.unconfirmedOps().find((o) => o.id === "t2")?.values).toEqual({
      title: "x".repeat(2000),
    });

    // nach einer Korrektur erneut versuchen
    q.retryFailed();
    q.enqueue(op("t2", { title: "kurz" }));
    await q.flush();
    expect(r.calls.at(-1)).toEqual([op("t2", { title: "kurz" })]);
    expect(q.getSnapshot()).toMatchObject({ status: "idle", failed: 0 });
  });

  it("isoliert in der Reihenfolge des Persisters, nicht in der des Eintragens (D-10)", async () => {
    const r = recorder();
    r.outcomes.push("permanent", "ok", "ok");
    // Persister-Reihenfolge: Notiz vor Block
    const order = (ops: SaveOp[]) => [...ops].sort((a) => (a.table === "notes" ? -1 : 1));
    const q = makeQueue(r.persist, { order });
    q.enqueue(op("b1", { content: "[[Neu]]" }, "upsert", "note_blocks"));
    q.enqueue(op("n1", { title: "Neu" }, "upsert", "notes"));
    await q.flush();
    await vi.advanceTimersByTimeAsync(0);
    await q.flush();
    expect(r.calls.map((b) => b.map((o) => o.id))).toEqual([["b1", "n1"], ["n1"], ["b1"]]);
  });

  it("mehrere dauerhafte Fehler am selben Datensatz ersetzen sich nicht (D-2)", async () => {
    const r = recorder();
    r.outcomes.push("permanent", "permanent");
    const q = makeQueue(r.persist);
    q.enqueue(op("w1", { kind: "woche", answers: {} }, "upsert", "recaps"));
    await q.flush();
    q.enqueue(op("w1", { answers: { good: "Sport" } }, "update", "recaps"));
    await q.flush();
    expect(q.getSnapshot().failed).toBe(1);
    // die angelegte Zeile bleibt erhalten, die spätere Antwort ist eingemischt
    expect(q.unconfirmedOps()).toEqual([
      op("w1", { kind: "woche", answers: { good: "Sport" } }, "upsert", "recaps"),
    ]);
    expect(storage.stored()?.failed).toMatchObject([
      op("w1", { kind: "woche", answers: { good: "Sport" } }, "upsert", "recaps"),
    ]);
  });

  it("„Erneut versuchen“ mischt den alten Stand vor den wartenden – der neue Wert gewinnt (D-2)", async () => {
    const r = recorder();
    r.outcomes.push("permanent");
    const q = makeQueue(r.persist);
    q.enqueue(op("n1", { title: "x".repeat(600), type: "idee" }, "update", "notes"));
    await q.flush();
    expect(q.getSnapshot().failed).toBe(1);
    // gekürzt und binnen 500 ms „Erneut versuchen“
    q.enqueue(op("n1", { title: "kurz" }, "update", "notes"));
    q.retryFailed();
    await q.flush();
    expect(r.calls.at(-1)).toEqual([op("n1", { title: "kurz", type: "idee" }, "update", "notes")]);
    expect(q.getSnapshot()).toMatchObject({ status: "idle", failed: 0 });
  });

  it("ein bestätigter neuerer Wert räumt dieselben Felder aus „fehlgeschlagen“ (D-4)", async () => {
    const r = recorder();
    r.outcomes.push("permanent");
    const q = makeQueue(r.persist);
    q.enqueue(op("n1", { title: "x".repeat(600), type: "idee" }, "update", "notes"));
    await q.flush();
    q.enqueue(op("n1", { title: "kurz" }, "update", "notes"));
    await q.flush();
    // der lange Titel überlagert den gespeicherten nicht mehr, nur „type“ bleibt offen
    expect(q.unconfirmedOps()).toEqual([op("n1", { type: "idee" }, "update", "notes")]);
    q.enqueue(op("n1", { type: "wissen" }, "update", "notes"));
    await q.flush();
    expect(q.getSnapshot()).toMatchObject({ status: "idle", failed: 0 });
    expect(storage.stored()).toBeNull();
  });

  it("Fehlgeschlagenes lässt sich verwerfen (und mit den gelieferten Ops zurückholen) (D-4)", async () => {
    const r = recorder();
    r.outcomes.push("permanent");
    const q = makeQueue(r.persist);
    q.enqueue(op("t1", { title: "nie mehr möglich" }));
    await q.flush();
    const dropped = q.discardFailed();
    expect(dropped).toEqual([op("t1", { title: "nie mehr möglich" })]);
    expect(q.getSnapshot()).toMatchObject({ status: "idle", failed: 0 });
    expect(storage.stored()).toBeNull();
    q.restoreFailed(dropped);
    expect(q.getSnapshot()).toMatchObject({ status: "error", failed: 1 });
  });

  it("nach dem Neustart wird Fehlgeschlagenes einmal von selbst wiederholt (D-4)", async () => {
    storage.data.set(
      "sz:save-queue",
      JSON.stringify({ v: 1, entries: [], failed: [op("t1", { title: "nach Abmelden" })] }),
    );
    const r = recorder();
    const q = makeQueue(r.persist);
    await q.restore();
    await vi.advanceTimersByTimeAsync(500);
    expect(r.calls).toMatchObject([[op("t1", { title: "nach Abmelden" })]]);
    expect(q.getSnapshot()).toMatchObject({ status: "idle", failed: 0 });
  });

  it("Zurückholen eines endgültig gelöschten Datensatzes wird verworfen statt Dauerfehler (D-9)", async () => {
    const r = recorder();
    r.outcomes.push("permanent");
    const dropped: SaveOp[] = [];
    const q = makeQueue(r.persist, {
      isObsolete: (o) => o.mode === "update" && o.values.deleted_at === null,
      onObsolete: (o) => dropped.push(o),
    });
    q.enqueue(op("t1", { deleted_at: null }));
    await q.flush();
    expect(q.getSnapshot()).toMatchObject({ status: "idle", failed: 0 });
    expect(dropped).toEqual([op("t1", { deleted_at: null })]);
    expect(storage.stored()).toBeNull();
  });

  it("meldet offline, solange kein Netz da ist, und versucht bei Rückkehr sofort", async () => {
    const r = recorder();
    r.outcomes.push("fail", "ok");
    let online = false;
    const q = makeQueue(r.persist, { isOnline: () => online });
    const target = new EventTarget();
    const detach = attachSaveQueueLifecycle(q, target as unknown as Window);

    q.enqueue(op("t1", { title: "offline geschrieben" }));
    await vi.advanceTimersByTimeAsync(500);
    expect(q.getSnapshot().status).toBe("offline");

    online = true;
    target.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.calls).toHaveLength(2);
    expect(q.getSnapshot().status).toBe("idle");
    detach();
  });

  it("entprellte Eingabe im Editor zählt als „wartet“, nicht als „gespeichert“", () => {
    const q = makeQueue(recorder().persist);
    const editor = {};
    q.markDirty(editor, true);
    expect(q.getSnapshot()).toMatchObject({ status: "pending", pending: 1 });
    q.markDirty(editor, false);
    expect(q.getSnapshot()).toMatchObject({ status: "idle", pending: 0 });
  });

  it("Verlassen: Editoren übernehmen ihren entprellten Stand vor dem Senden (D-6)", async () => {
    const r = recorder();
    const q = makeQueue(r.persist);
    const target = new EventTarget();
    // die Warteschlange hängt beim App-Start ein, der Editor erst beim Öffnen der Notiz
    const detach = attachSaveQueueLifecycle(q, target as unknown as Window);
    let typed: string | null = "letzte Tasten";
    const off = q.onBeforeFlush(() => {
      if (typed) q.enqueue(op("b1", { content_text: typed }, "upsert", "note_blocks"));
      typed = null;
    });
    target.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.calls).toEqual([
      [op("b1", { content_text: "letzte Tasten" }, "upsert", "note_blocks")],
    ]);
    off();
    q.enqueue(op("t1", { title: "x" }));
    await q.flush();
    expect(r.calls).toHaveLength(2);
    detach();
  });
});

describe("localStorage-Wiederherstellung", () => {
  it("spiegelt Unbestätigtes synchron, auch während des Sendens", async () => {
    const r = recorder();
    let release!: () => void;
    r.outcomes.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const q = makeQueue(r.persist);
    q.enqueue(op("t1", { title: "A" }));
    expect(storage.stored()?.entries).toMatchObject([op("t1", { title: "A" })]);

    await vi.advanceTimersByTimeAsync(500);
    expect(q.getSnapshot().status).toBe("saving");
    // Absturz jetzt → der unterwegs befindliche Stand ist noch im Speicher
    expect(storage.stored()?.entries).toMatchObject([op("t1", { title: "A" })]);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.stored()).toBeNull();
  });

  it("holt nach einem Neustart alles nach (Tippen + sofort wegnavigieren + Reload)", async () => {
    const first = recorder();
    first.outcomes.push(new Promise<void>(() => {})); // Seite wird geschlossen, bevor bestätigt wird
    const q1 = makeQueue(first.persist);
    q1.enqueue(op("n1", { title: "Notiz" }, "upsert", "notes"));
    q1.enqueue(op("b1", { content_text: "Hallo" }, "upsert", "note_blocks"));
    void q1.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.calls).toHaveLength(1);
    q1.enqueue(op("b1", { content_text: "Hallo Welt" }, "update", "note_blocks"));
    q1.dispose();

    const second = recorder();
    const q2 = makeQueue(second.persist);
    q2.enqueue(op("b2", { content_text: "neu nach Reload" }, "upsert", "note_blocks"));
    // neue Eingabe vor restore() überschreibt den Stand der letzten Sitzung nicht
    expect(storage.stored()?.entries.map((o) => o.id)).toEqual(["n1", "b1", "b2"]);
    expect(await q2.restore()).toBe(3);
    expect(q2.unconfirmedOps().find((o) => o.id === "b1")?.values).toEqual({
      content_text: "Hallo Welt",
    });
    expect(q2.unconfirmedOps().map((o) => `${o.table}:${o.id}:${o.mode}`)).toEqual([
      "notes:n1:upsert",
      "note_blocks:b1:upsert",
      "note_blocks:b2:upsert",
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.calls).toMatchObject([
      [
        op("n1", { title: "Notiz" }, "upsert", "notes"),
        op("b1", { content_text: "Hallo Welt" }, "upsert", "note_blocks"),
        op("b2", { content_text: "neu nach Reload" }, "upsert", "note_blocks"),
      ],
    ]);
    expect(storage.stored()).toBeNull();
  });

  it("ignoriert kaputte oder fremde Speicherstände", async () => {
    const r = recorder();
    storage.data.set("sz:save-queue", "{kaputt");
    expect(await makeQueue(r.persist).restore()).toBe(0);
    storage.data.set("sz:save-queue", JSON.stringify({ v: 99, entries: [op("x", {})] }));
    expect(await makeQueue(r.persist).restore()).toBe(0);
    storage.data.set(
      "sz:save-queue",
      JSON.stringify({ v: 1, entries: [{ table: 1 }, op("ok", { a: 1 })], failed: [] }),
    );
    expect(await makeQueue(r.persist).restore()).toBe(1);
  });

  it("volles localStorage bricht nichts ab, sondern wird gemeldet", async () => {
    const r = recorder();
    storage.failWrites = true;
    const q = makeQueue(r.persist);
    q.enqueue(op("t1", { title: "A" }));
    expect(q.getSnapshot().storageError).toBe(true);
    await q.flush();
    expect(r.calls).toHaveLength(1);
  });

  it("eigener Speicherschlüssel je Nutzer", () => {
    const r = recorder();
    const q = makeQueue(r.persist, { storageKey: "sz:save-queue:user-a" });
    q.enqueue(op("t1", { title: "A" }));
    expect(storage.stored("sz:save-queue:user-a")?.entries).toHaveLength(1);
    expect(storage.stored()).toBeNull();
  });
});

describe("mehrere Tabs (D-1): Spiegel je Tab, nur Verwaistes übernehmen", () => {
  const BASE = "sz:save-queue:user-a";
  const tabKey = (tab: string) => `${BASE}:tab:${tab}`;
  let clock = 0;
  const tab = (persist: SaveQueueOptions["persist"], tabId: string) =>
    makeQueue(persist, { storageKey: BASE, tabId, now: () => clock });
  beforeEach(() => {
    clock = 1_000_000;
  });

  it("Tab B speichert erfolgreich – A's ungesendeter Stand bleibt im Speicher", async () => {
    const a = recorder();
    a.outcomes.push("fail", "fail", "fail");
    const qa = tab(a.persist, "A");
    const qb = tab(recorder().persist, "B");
    qa.enqueue(op("n1", { title: "offline in A" }, "upsert", "notes"));
    qb.enqueue(op("t1", { status: "erledigt" }));
    await qb.flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(storage.stored(tabKey("A"))?.entries).toMatchObject([
      op("n1", { title: "offline in A" }, "upsert", "notes"),
    ]);
    expect(storage.stored(tabKey("B"))).toBeNull();
    qa.dispose();
    qb.dispose();
  });

  it("A stürzt ab (kein Herzschlag mehr) → der nächste Tab übernimmt A's Stand", async () => {
    const a = recorder();
    a.outcomes.push(new Promise<void>(() => {}));
    const qa = tab(a.persist, "A");
    qa.enqueue(op("n1", { title: "A-Text" }, "upsert", "notes"));
    await vi.advanceTimersByTimeAsync(500);
    qa.dispose(); // Absturz: weder pagehide noch Herzschlag
    clock += 3 * 60_000;
    const c = recorder();
    const qc = tab(c.persist, "C");
    expect(await qc.restore()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.calls).toMatchObject([
      [{ ...op("n1", { title: "A-Text" }, "upsert", "notes"), adopted: true }],
    ]);
    expect(storage.stored(tabKey("C"))).toBeNull();
    expect(storage.stored(tabKey("A"))?.entries ?? []).toEqual([]);
    qc.dispose();
  });

  it("ein neuer Tab übernimmt nichts von einem lebenden Tab (auch nach Minuten dank Herzschlag)", async () => {
    const a = recorder();
    a.outcomes.push(...Array.from({ length: 50 }, () => "fail" as const));
    const qa = tab(a.persist, "A");
    qa.enqueue(op("t1", { title: "abc" }));
    for (let i = 0; i < 10; i += 1) {
      clock += 30_000;
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const c = recorder();
    const qc = tab(c.persist, "C");
    expect(await qc.restore()).toBe(0);
    expect(qc.unconfirmedOps()).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.calls).toEqual([]);
    expect(storage.stored(tabKey("A"))?.entries).toMatchObject([op("t1", { title: "abc" })]);
    qa.dispose();
    qc.dispose();
  });

  it("geschlossener Tab (pagehide) wird sofort übernommen; kommt er zurück, sendet er nichts doppelt", async () => {
    const a = recorder();
    a.outcomes.push("fail");
    const qa = tab(a.persist, "A");
    qa.enqueue(op("t1", { title: "vor Reload" }));
    await vi.advanceTimersByTimeAsync(500);
    qa.markClosed();
    const c = recorder();
    const qc = tab(c.persist, "C");
    expect(await qc.restore()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.calls).toMatchObject([[op("t1", { title: "vor Reload" })]]);
    // A kommt aus dem Zwischenspeicher des Browsers zurück: seine Ops gehören jetzt C
    qa.resume();
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.calls).toHaveLength(1);
    expect(qa.getSnapshot()).toMatchObject({ pending: 0, failed: 0 });
    qa.dispose();
    qc.dispose();
  });

  it("Übernommenes ist älter: eigene Eingaben vor restore() gewinnen, ein zweites restore() übernimmt nichts", async () => {
    storage.data.set(
      tabKey("A"),
      JSON.stringify({
        v: 1,
        entries: [op("t1", { title: "alt", status: "offen" })],
        failed: [],
        at: clock,
        closed: true,
      }),
    );
    const c = recorder();
    const qc = tab(c.persist, "C");
    // im Konstruktor wird nichts übernommen und nichts geschrieben (React verwirft evtl. eine Instanz)
    expect(storage.data.has(tabKey("C"))).toBe(false);
    qc.enqueue(op("t1", { title: "neu" }));
    expect(await qc.restore()).toBe(1);
    expect(await qc.restore()).toBe(1);
    await qc.flush();
    expect(c.calls).toMatchObject([[op("t1", { title: "neu", status: "offen" })]]);
    qc.dispose();
  });

  it("beendet (Abmelden): der Spiegel gilt als geschlossen und wird sofort übernommen (D-4)", async () => {
    const a = recorder();
    a.outcomes.push("fail");
    const qa = tab(a.persist, "A");
    qa.enqueue(op("t1", { title: "vor dem Abmelden" }));
    await vi.advanceTimersByTimeAsync(500);
    qa.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a.calls).toHaveLength(1);
    const qc = tab(recorder().persist, "C");
    expect(await qc.restore()).toBe(1);
    qc.dispose();
  });

  it("übernimmt den Spiegel der Vorgängerversion (ein Schlüssel je Nutzer) einmal", async () => {
    storage.data.set(
      BASE,
      JSON.stringify({ v: 1, entries: [op("t9", { title: "alt" })], failed: [op("t8", { x: 1 })] }),
    );
    const c = recorder();
    const qc = tab(c.persist, "C");
    expect(await qc.restore()).toBe(1);
    expect(storage.data.has(BASE)).toBe(false);
    // Fehlgeschlagenes wird dabei einmal von selbst wiederholt (D-4)
    expect(qc.getSnapshot()).toMatchObject({ failed: 0, pending: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.calls).toMatchObject([[op("t8", { x: 1 }), op("t9", { title: "alt" })]]);
    qc.dispose();
  });
});

describe("Lebenszyklus", () => {
  it("pagehide und verborgener Tab speichern sofort", async () => {
    const r = recorder();
    const q = makeQueue(r.persist);
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), {
      visibilityState: "visible" as DocumentVisibilityState,
    });
    const detach = attachSaveQueueLifecycle(
      q,
      win as unknown as Window,
      doc as unknown as Document,
    );

    q.enqueue(op("t1", { title: "A" }));
    win.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.calls).toHaveLength(1);

    q.enqueue(op("t1", { title: "B" }));
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.calls).toHaveLength(2);

    detach();
    q.enqueue(op("t1", { title: "C" }));
    win.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.calls).toHaveLength(2);
  });

  it("benachrichtigt Abonnenten bei Statuswechseln", async () => {
    const r = recorder();
    const q = makeQueue(r.persist);
    const seen: string[] = [];
    q.subscribe(() => seen.push(q.getSnapshot().status));
    q.enqueue(op("t1", { title: "A" }));
    await q.flush();
    expect(seen).toEqual(["pending", "saving", "idle"]);
  });
});

describe("Übernommenes mit Zeitpunkt und Web Locks (Review Teil B, V-4/V-12)", () => {
  const BASE = "sz:save-queue:user-b";
  const tabKey = (tab: string) => `${BASE}:tab:${tab}`;
  let clock = 0;
  beforeEach(() => {
    clock = 2_000_000;
  });

  /** gespielte Web Locks: gehaltene Sperren je Name, exklusive Anfragen laufen nacheinander */
  function fakeLocks() {
    const held = new Set<string>();
    const chains = new Map<string, Promise<unknown>>();
    const requests: string[] = [];
    return {
      held,
      requests,
      locks: {
        request: (name: string, _options: { mode: string }, callback: () => unknown) => {
          requests.push(name);
          const run = (chains.get(name) ?? Promise.resolve()).then(async () => {
            held.add(name);
            try {
              return await callback();
            } finally {
              held.delete(name);
            }
          });
          chains.set(
            name,
            run.catch(() => {}),
          );
          return run;
        },
        query: async () => ({ held: [...held].map((name) => ({ name })) }),
      },
    };
  }

  it("jede Operation trägt ihren Zeitpunkt; Übernommenes trägt die Marke, eigene Änderung daran hebt sie auf", async () => {
    const q = makeQueue(recorder().persist, { now: () => clock, locks: null });
    q.enqueue(op("t1", { title: "a" }));
    // der Zeitpunkt steht im Spiegel, nicht an der Op (Pakete bleiben unverändert)
    expect(storage.stored()?.entries[0]).toMatchObject({ at: clock });
    expect(q.unconfirmedOps()[0]?.at).toBeUndefined();
    expect(q.unconfirmedOps()[0]?.adopted).toBeUndefined();
    expect(
      mergeOps({ ...op("t1", { a: 1 }), at: 1, adopted: true }, { ...op("t1", { b: 2 }), at: 2 }),
    ).toEqual({ ...op("t1", { a: 1, b: 2 }), at: 2 });
    expect(
      mergeOps(
        { ...op("t1", { a: 1 }), at: 1, adopted: true },
        { ...op("t1", { b: 2 }), at: 2, adopted: true },
      ),
    ).toMatchObject({ adopted: true, at: 2 });
    q.dispose();
  });

  it("Spiegel eines Tabs ohne gehaltene Sperre ist sofort verwaist – auch mit frischem Herzschlag", async () => {
    const { locks } = fakeLocks();
    const a = recorder();
    a.outcomes.push(new Promise<void>(() => {}));
    const qa = makeQueue(a.persist, {
      storageKey: BASE,
      tabId: "A",
      now: () => clock,
      locks: null,
    });
    qa.enqueue(op("n1", { title: "A-Text" }, "upsert", "notes"));
    await vi.advanceTimersByTimeAsync(500);
    // A ist weg (Absturz, Herzschlag erst 10 s alt), hält aber keine Sperre
    clock += 10_000;
    const c = recorder();
    const qc = makeQueue(c.persist, { storageKey: BASE, tabId: "C", now: () => clock, locks });
    expect(await qc.restore()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.calls).toMatchObject([
      [
        {
          ...op("n1", { title: "A-Text" }, "upsert", "notes"),
          adopted: true,
          at: expect.any(Number),
        },
      ],
    ]);
    expect(storage.stored(tabKey("A"))?.entries ?? []).toEqual([]);
    qa.dispose();
    qc.dispose();
  });

  it("lebender Tab (hält seine Sperre) wird nicht übernommen, Herzschlag spielt dann keine Rolle", async () => {
    const { locks } = fakeLocks();
    const a = recorder();
    a.outcomes.push(...Array.from({ length: 50 }, () => "fail" as const));
    const qa = makeQueue(a.persist, { storageKey: BASE, tabId: "A", now: () => clock, locks });
    await qa.restore();
    qa.enqueue(op("t1", { title: "abc" }));
    await vi.advanceTimersByTimeAsync(500);
    clock += 10 * 60_000;
    const c = recorder();
    const qc = makeQueue(c.persist, { storageKey: BASE, tabId: "C", now: () => clock, locks });
    expect(await qc.restore()).toBe(0);
    expect(storage.stored(tabKey("A"))?.entries).toHaveLength(1);
    qa.dispose();
    qc.dispose();
  });

  it("zwei gleichzeitig startende Tabs: nur einer übernimmt den verwaisten Spiegel", async () => {
    const { locks, requests } = fakeLocks();
    storage.data.set(
      tabKey("alt"),
      JSON.stringify({
        v: 1,
        entries: [op("n1", { title: "alt" }, "upsert", "notes")],
        failed: [],
        at: clock - 60_000,
        closed: true,
      }),
    );
    const c = recorder();
    const d = recorder();
    const qc = makeQueue(c.persist, { storageKey: BASE, tabId: "C", now: () => clock, locks });
    const qd = makeQueue(d.persist, { storageKey: BASE, tabId: "D", now: () => clock, locks });
    const [fromC, fromD] = await Promise.all([qc.restore(), qd.restore()]);
    expect(fromC + fromD).toBe(1);
    expect(requests.filter((name) => name === `${BASE}:adopt`)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.calls.length + d.calls.length).toBe(1);
    qc.dispose();
    qd.dispose();
  });

  it("„Erneut versuchen“ mit force nimmt übernommenen Operationen die Marke", async () => {
    const r = recorder();
    r.outcomes.push("permanent");
    storage.data.set(
      tabKey("alt"),
      JSON.stringify({
        v: 1,
        entries: [op("n1", { title: "alt" }, "upsert", "notes")],
        failed: [],
        at: clock - 60_000,
        closed: true,
      }),
    );
    const q = makeQueue(r.persist, { storageKey: BASE, tabId: "E", now: () => clock, locks: null });
    expect(await q.restore()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.getSnapshot().failed).toBe(1);
    // die gescheiterte Operation trägt die Marke; ein gewöhnliches Wiederholen behält sie …
    expect(q.unconfirmedOps()[0]?.adopted).toBe(true);
    expect(r.calls[0]?.[0]?.adopted).toBe(true);
    // … „Erneut versuchen“ (force) nimmt sie: die Operation gilt dann als bewusst gewollt
    q.retryFailed({ force: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]?.[0]?.adopted).toBeUndefined();
    expect(r.calls[1]?.[0]).toMatchObject(op("n1", { title: "alt" }, "upsert", "notes"));
    q.dispose();
  });
});
