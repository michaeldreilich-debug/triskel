import { describe, expect, it } from "vitest";
import type { SaveOp } from "@/lib/save-queue/save-queue";
import { fetchWithOverlay, hasUnconfirmed, overlayUnconfirmed } from "./unconfirmed";

const source = (ops: SaveOp[]) => ({ unconfirmedOps: () => ops });

interface Row {
  id: string;
  title: string;
  topic_id: string | null;
  deleted_at?: string | null;
}

const server: Row[] = [
  { id: "a", title: "Alt A", topic_id: "t1" },
  { id: "b", title: "B", topic_id: "t1" },
];

describe("overlayUnconfirmed", () => {
  it("ohne unbestätigte Änderungen bleibt alles, wie es ist (gleiche Referenz)", () => {
    expect(overlayUnconfirmed(source([]), "notes", server)).toBe(server);
  });

  it("legt unbestätigte Werte über Serverzeilen (lokaler Stand hat Vorrang)", () => {
    const rows = overlayUnconfirmed(
      source([{ table: "notes", id: "a", mode: "update", values: { title: "Neu A" } }]),
      "notes",
      server,
    );
    expect(rows.map((r) => r.title)).toEqual(["Neu A", "B"]);
  });

  it("ignoriert andere Tabellen", () => {
    const rows = overlayUnconfirmed(
      source([{ table: "topics", id: "a", mode: "update", values: { title: "x" } }]),
      "notes",
      server,
    );
    expect(rows).toBe(server);
  });

  it("lokal gelöschte Zeilen verschwinden", () => {
    const rows = overlayUnconfirmed(
      source([{ table: "notes", id: "b", mode: "update", values: { deleted_at: "2026-10-11" } }]),
      "notes",
      server,
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("nimmt neue, noch nicht gespeicherte Zeilen auf, wenn sie zur Abfrage passen", () => {
    const ops: SaveOp[] = [
      { table: "notes", id: "c", mode: "upsert", values: { title: "C", topic_id: "t1" } },
      { table: "notes", id: "d", mode: "upsert", values: { title: "D", topic_id: "t2" } },
      { table: "notes", id: "e", mode: "update", values: { title: "nur Update" } },
    ];
    const rows = overlayUnconfirmed(source(ops), "notes", server, {
      include: (row) => row.topic_id === "t1",
    });
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("hasUnconfirmed", () => {
  it("zählt passende Operationen", () => {
    const ops: SaveOp[] = [
      { table: "note_blocks", id: "1", mode: "upsert", values: { note_id: "n1" } },
      { table: "note_blocks", id: "2", mode: "upsert", values: { note_id: "n2" } },
      { table: "notes", id: "n1", mode: "update", values: {} },
    ];
    expect(hasUnconfirmed(source(ops), "note_blocks", (op) => op.values.note_id === "n1")).toBe(1);
  });
});

describe("fetchWithOverlay", () => {
  it("während des Ladens bestätigte Änderungen überdecken eine veraltete Antwort", async () => {
    let pending: SaveOp[] = [
      { table: "notes", id: "a", mode: "update", values: { title: "Neu A" } },
    ];
    const queue = { unconfirmedOps: () => pending };
    const rows = await fetchWithOverlay(queue, "notes", async () => {
      pending = []; // Speichern bestätigt, Antwort enthält aber noch den alten Stand
      return server;
    });
    expect(rows.map((r) => r.title)).toEqual(["Neu A", "B"]);
  });

  it("vorher und nachher erfasste Änderungen desselben Datensatzes werden zusammengeführt", async () => {
    let pending: SaveOp[] = [
      { table: "notes", id: "a", mode: "update", values: { title: "Neu A" } },
    ];
    const queue = { unconfirmedOps: () => pending };
    const rows = await fetchWithOverlay(queue, "notes", async () => {
      pending = [{ table: "notes", id: "a", mode: "update", values: { topic_id: "t9" } }];
      return server;
    });
    expect(rows[0]).toEqual({ id: "a", title: "Neu A", topic_id: "t9" });
  });

  it("während des Ladens angelegt und bestätigt: wird nachgeladen statt zu verschwinden", async () => {
    let persisted = 0;
    let serverRows = [...server];
    const calls: number[] = [];
    const queue = { unconfirmedOps: () => [] as SaveOp[], persistedCount: () => persisted };
    const rows = await fetchWithOverlay(queue, "notes", async () => {
      calls.push(persisted);
      const answer = serverRows;
      if (calls.length === 1) {
        // neue Zeile angelegt UND gespeichert, während die erste Antwort unterwegs war
        serverRows = [...serverRows, { id: "c", title: "C", topic_id: null }];
        persisted += 1;
      }
      return answer;
    });
    expect(calls).toEqual([0, 1]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("höchstens dreimal laden", async () => {
    let persisted = 0;
    let count = 0;
    const queue = { unconfirmedOps: () => [] as SaveOp[], persistedCount: () => persisted };
    await fetchWithOverlay(queue, "notes", async () => {
      count += 1;
      persisted += 1;
      return server;
    });
    expect(count).toBe(3);
  });
});
