import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import { docToRows } from "./model/serializer";
import { OutlineSync } from "./sync";
import { outline } from "./test-utils";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("OutlineSync", () => {
  it("entprellt, diffed und reiht nur Änderungen ein; Entferntes als Soft-Delete", async () => {
    const calls: SaveOp[][] = [];
    const queue = new SaveQueue({ persist: async (b) => void calls.push(b), debounceMs: 0 });
    const initialRows = docToRows(outline(["A", "B"]));
    const sync = new OutlineSync(queue, { initialRows, extra: { note_id: "n1" }, delayMs: 400 });

    sync.change(outline(["A!", "B"]));
    sync.change(outline(["A!!", "B"]));
    await vi.advanceTimersByTimeAsync(399);
    expect(calls).toHaveLength(0);
    // 400 ms → übernehmen; der 0-ms-Debounce der Warteschlange läuft bei Fake-Timern 1 ms später
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    // IDs aus der Kurzschreibweise hängen am Text: „A!!“ ist ein neuer Block, „A“ wurde entfernt
    expect(
      calls[0]?.map((o) => [o.id, o.mode, o.values.deleted_at === null ? "live" : "gelöscht"]),
    ).toEqual([
      ["id-A!!", "upsert", "live"],
      ["id-A", "update", "gelöscht"],
    ]);
    expect(calls[0]?.[0]?.values.note_id).toBe("n1");
  });

  it("flush() übernimmt sofort (z. B. bei pagehide)", async () => {
    const calls: SaveOp[][] = [];
    const queue = new SaveQueue({ persist: async (b) => void calls.push(b) });
    const sync = new OutlineSync(queue, { initialRows: docToRows(outline(["A"])) });
    sync.change(outline(["A", "B"]));
    await sync.flush();
    expect(calls[0]?.map((o) => o.id)).toEqual(["id-B"]);
  });
});

describe("OutlineSync: frischer Serverstand (Review Teil B, V-6)", () => {
  it("reset() übernimmt neue Zeilen nur ohne wartende Eingabe; der nächste Diff rechnet dagegen", async () => {
    const calls: SaveOp[][] = [];
    const queue = new SaveQueue({ persist: async (b) => void calls.push(b), debounceMs: 0 });
    const sync = new OutlineSync(queue, { initialRows: docToRows(outline(["A"])), delayMs: 400 });
    expect(sync.hasPending()).toBe(false);
    sync.change(outline(["A!"]));
    expect(sync.hasPending()).toBe(true);
    // Eingabe wartet → der Serverstand wird nicht übernommen
    expect(sync.reset(docToRows(outline(["A", "KI"])))).toBe(false);
    await vi.advanceTimersByTimeAsync(402);
    expect(sync.hasPending()).toBe(false);
    // jetzt übernehmen: der Stand mit dem KI-Block ist Ausgangspunkt, nichts wird gelöscht
    const fresh = docToRows(outline(["A!", "KI"]));
    expect(sync.reset(fresh)).toBe(true);
    expect(sync.rows()).toBe(fresh);
    sync.change(outline(["A!", "KI", "neu"]));
    await sync.flush();
    const last = calls.at(-1) ?? [];
    expect(last.map((o) => [o.id, o.values.deleted_at === null ? "live" : "gelöscht"])).toEqual([
      ["id-neu", "live"],
    ]);
  });
});
