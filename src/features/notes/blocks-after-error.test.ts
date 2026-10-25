import { describe, expect, it } from "vitest";
import type { BlockRow } from "@/features/outliner/model/serializer";
import type { SaveOp } from "@/lib/save-queue/save-queue";
import { blocksAfterLoadError } from "./api";

const row = (id: string, text: string, sort: string): BlockRow => ({
  id,
  parent_id: null,
  sort,
  content: { type: "paragraph", content: [{ type: "text", text }] },
  content_text: text,
  collapsed: false,
  task_id: null,
});

describe("Notiz wieder öffnen, Neuladen gescheitert (Review Teil B, V-5)", () => {
  it("legt die noch unbestätigten Änderungen über den Cache und zählt sie", () => {
    const cached = { rows: [row("b1", "alt", "a0"), row("b2", "zwei", "a1")], unconfirmed: 0 };
    const ops: SaveOp[] = [
      // Block getippt, aber noch nicht bestätigt
      {
        table: "note_blocks",
        id: "b1",
        mode: "upsert",
        values: {
          note_id: "n1",
          content_text: "neu",
          sort: "a0",
          content: row("b1", "neu", "a0").content,
        },
      },
      // neuer Block derselben Notiz
      {
        table: "note_blocks",
        id: "b3",
        mode: "upsert",
        values: { ...row("b3", "drei", "a2"), note_id: "n1" },
      },
      // gelöschter Block
      {
        table: "note_blocks",
        id: "b2",
        mode: "update",
        values: { deleted_at: "2026-10-24T10:00:00Z" },
      },
      // andere Notiz: zählt nicht
      {
        table: "note_blocks",
        id: "x",
        mode: "upsert",
        values: { ...row("x", "fremd", "a0"), note_id: "n2" },
      },
      { table: "tasks", id: "t1", mode: "update", values: { title: "egal" } },
    ];
    const result = blocksAfterLoadError({ unconfirmedOps: () => ops }, cached, "n1");
    expect(result.rows.map((r) => [r.id, r.content_text])).toEqual([
      ["b1", "neu"],
      ["b3", "drei"],
    ]);
    expect(result.unconfirmed).toBe(3);
  });

  it("ohne Unbestätigtes bleibt der Cache wie er ist", () => {
    const cached = { rows: [row("b1", "alt", "a0")], unconfirmed: 0 };
    const result = blocksAfterLoadError({ unconfirmedOps: () => [] }, cached, "n1");
    expect(result.rows).toEqual(cached.rows);
    expect(result.unconfirmed).toBe(0);
  });
});
