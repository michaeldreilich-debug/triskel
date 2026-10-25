import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import { createRecapActions, recapsKey } from "./api";
import type { RecapRow } from "./types";

/** Gerät mit eigenem Cache und eigener (aufzeichnender) Warteschlange */
function device(userId: string) {
  const ops: SaveOp[] = [];
  const queue = { enqueue: (op: SaveOp) => ops.push(op) } as unknown as SaveQueue;
  const queryClient = new QueryClient();
  queryClient.setQueryData<RecapRow[]>(recapsKey, []);
  return { ops, actions: createRecapActions(queue, queryClient, userId) };
}

describe("Wochenrückblick anlegen (D-3)", () => {
  it("zwei Geräte mit veraltetem Cache legen dieselbe Woche mit derselben ID an", () => {
    const mac = device("user-a");
    const iphone = device("user-a");
    const a = mac.actions.createWeek("2026-10-12", "2026-10-18", []);
    const b = iphone.actions.createWeek("2026-10-12", "2026-10-18", []);
    expect(b.id).toBe(a.id);
    expect(device("user-b").actions.createWeek("2026-10-12", "2026-10-18", []).id).not.toBe(a.id);
    expect(mac.actions.createWeek("2026-10-19", "2026-10-25", []).id).not.toBe(a.id);
  });

  it("das Anlegen überschreibt keine Antworten, die ein anderes Gerät schon gespeichert hat", () => {
    const { ops, actions } = device("user-a");
    actions.createWeek("2026-10-12", "2026-10-18", []);
    expect(ops).toHaveLength(1);
    const [create] = ops;
    expect(create?.mode).toBe("upsert");
    expect(Object.keys(create?.values ?? {}).sort()).toEqual(
      ["deleted_at", "kind", "period_end", "period_start", "questions"].sort(),
    );
  });
});

describe("Monatsrückblick anlegen (S1a)", () => {
  it("feste ID je Monat, eigene als die Woche; Fokus gilt dem nächsten Monat", () => {
    const mac = device("user-a");
    const iphone = device("user-a");
    const questions = [
      { key: "mood", label: "Wie ging es mir (1–5)?", type: "scale" as const },
      {
        key: "focus_next",
        label: "Fokus nächste Woche (3 Punkte)",
        type: "list" as const,
        count: 3,
      },
    ];
    const month = mac.actions.create("monat", "2026-10-01", "2026-10-31", questions);
    expect(iphone.actions.create("monat", "2026-10-01", "2026-10-31", questions).id).toBe(month.id);
    expect(mac.actions.createWeek("2026-10-01", "2026-10-07", questions).id).not.toBe(month.id);
    expect(month.kind).toBe("monat");
    expect(month.questions.map((q) => q.label)).toEqual([
      "Wie ging es mir (1–5)?",
      "Fokus nächster Monat (3 Punkte)",
    ]);
    // ein zweites Anlegen auf demselben Gerät liefert den vorhandenen
    expect(mac.actions.create("monat", "2026-10-01", "2026-10-31", questions)).toBe(month);
    expect(mac.ops.filter((op) => op.id === month.id)).toHaveLength(1);
  });
});
