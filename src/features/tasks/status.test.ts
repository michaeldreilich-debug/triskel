import { describe, expect, it } from "vitest";
import type { SaveOp } from "@/lib/save-queue/save-queue";
import { task } from "./fixtures";
import { applyComplete, applyPendingStatus, applyUndo, nextInstance } from "./status";

const NOW = "2026-10-11T18:00:00.000Z";
const op = (id: string, values: Record<string, unknown>): SaveOp => ({
  table: "rpc:task_status",
  id,
  mode: "update",
  values,
});

describe("Erledigen/Rückgängig im Client (wie complete_task / undo_complete_task)", () => {
  const recurring = task("A", {
    recurrence: "FREQ=DAILY",
    due_date: "2026-10-24",
    scheduled_at: "2026-10-24T07:00:00Z",
    focus_date: "2026-10-24",
    body: {
      type: "doc",
      content: [{ type: "taskItem", attrs: { checked: true } }],
    },
  });

  it("Folgeinstanz: offen, neuer Termin, Uhrzeit über die Zeitumstellung, Checkliste leer", () => {
    const next = nextInstance(recurring, "2026-10-25", "N", NOW);
    expect(next).toMatchObject({
      id: "N",
      status: "offen",
      due_date: "2026-10-25",
      scheduled_at: "2026-10-25T08:00:00.000Z",
      recurrence_source_id: "A",
      focus_date: null,
      in_inbox: false,
      completed_at: null,
      sort: "a0V",
    });
    expect(JSON.stringify(next.body)).not.toContain('"checked":true');
  });

  it("erledigen ist idempotent, rückgängig entfernt nur offene Folgeinstanzen", () => {
    let rows = applyComplete([recurring], "A", { due: "2026-10-25", id: "N" }, NOW);
    expect(rows.map((t) => [t.id, t.status])).toEqual([
      ["A", "erledigt"],
      ["N", "offen"],
    ]);
    expect(applyComplete(rows, "A", { due: "2026-10-25", id: "X" }, NOW)).toBe(rows);
    rows = applyUndo(rows, "A", NOW);
    expect(rows.map((t) => [t.id, t.status])).toEqual([["A", "offen"]]);
    const doneFollower = [
      task("A", { status: "erledigt" }),
      task("F", { recurrence_source_id: "A", status: "erledigt" }),
    ];
    expect(applyUndo(doneFollower, "A", NOW).map((t) => t.id)).toEqual(["A", "F"]);
  });

  it("ungespeicherte Operationen liegen über dem Serverstand (zusammengeführt je Aufgabe)", () => {
    const server = [recurring, task("B")];
    const pending = applyPendingStatus(server, [
      op("A", { action: "complete", p_next_due: "2026-10-25", p_next_id: "N" }),
      op("B", { action: "complete", p_next_due: null, p_next_id: null }),
      op("B", { action: "undo", p_next_due: null, p_next_id: null }),
      { table: "tasks", id: "B", mode: "update", values: { title: "egal" } },
    ]);
    expect(pending.map((t) => [t.id, t.status])).toEqual([
      ["A", "erledigt"],
      ["B", "offen"],
      ["N", "offen"],
    ]);
    // Server hat schon gespeichert: nichts doppelt
    const saved = applyComplete(server, "A", { due: "2026-10-25", id: "N" }, NOW);
    expect(
      applyPendingStatus(saved, [
        op("A", { action: "complete", p_next_due: "2026-10-25", p_next_id: "N" }),
      ]),
    ).toHaveLength(3);
    expect(applyPendingStatus(server, [])).toBe(server);
  });
});
