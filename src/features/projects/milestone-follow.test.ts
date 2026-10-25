import { describe, expect, it } from "vitest";
import type { TaskRow } from "../tasks/types";
import { followMilestones } from "./milestone-follow";

type T = Pick<TaskRow, "milestone_id" | "status" | "deleted_at">;
const task = (milestone_id: string | null, status: TaskRow["status"] = "offen"): T => ({
  milestone_id,
  status,
  deleted_at: null,
});
const NOW = "2026-10-18T12:00:00.000Z";
const open = { id: "m1", done_at: null, deleted_at: null };
const reached = { id: "m1", done_at: "2026-10-01T08:00:00.000Z", deleted_at: null };

describe("followMilestones (wie Migration 35, #60)", () => {
  it("letzte offene Aufgabe erledigt → Meilenstein erreicht", () => {
    const after = task("m1", "erledigt");
    expect(
      followMilestones(task("m1"), after, [after, task("m1", "erledigt")], [open], NOW),
    ).toEqual([{ id: "m1", done_at: NOW }]);
  });

  it("noch eine offene (auch „in Arbeit“) → bleibt offen", () => {
    const after = task("m1", "erledigt");
    expect(
      followMilestones(task("m1"), after, [after, task("m1", "in_arbeit")], [open], NOW),
    ).toEqual([]);
  });

  it("wieder geöffnet oder neu angelegt → wieder offen", () => {
    const after = task("m1");
    expect(followMilestones(task("m1", "erledigt"), after, [after], [reached], NOW)).toEqual([
      { id: "m1", done_at: null },
    ]);
    expect(followMilestones(undefined, after, [after], [reached], NOW)).toEqual([
      { id: "m1", done_at: null },
    ]);
  });

  it("letzte offene in den Papierkorb: mit erledigten → erreicht, ohne Aufgaben → bleibt", () => {
    const trashed = { ...task("m1"), deleted_at: NOW };
    expect(
      followMilestones(task("m1"), trashed, [trashed, task("m1", "erledigt")], [open], NOW),
    ).toEqual([{ id: "m1", done_at: NOW }]);
    expect(followMilestones(task("m1"), trashed, [trashed], [open], NOW)).toEqual([]);
  });

  it("hinausverschoben: alter erreicht, neuer wieder offen", () => {
    const moved = task("m2");
    expect(
      followMilestones(
        task("m1"),
        moved,
        [moved, task("m1", "erledigt")],
        [open, { id: "m2", done_at: NOW, deleted_at: null }],
        NOW,
      ),
    ).toEqual([
      { id: "m2", done_at: null },
      { id: "m1", done_at: NOW },
    ]);
  });

  it("Statuswechsel zwischen offenen Zuständen und Aufgaben ohne Meilenstein ändern nichts", () => {
    expect(followMilestones(task("m1"), task("m1", "wartet"), [], [reached], NOW)).toEqual([]);
    expect(followMilestones(task(null), task(null, "erledigt"), [], [open], NOW)).toEqual([]);
  });

  it("von Hand erreichter Meilenstein bleibt erreicht, Meilenstein im Papierkorb unberührt", () => {
    const after = task("m1", "erledigt");
    expect(followMilestones(task("m1"), after, [after], [reached], NOW)).toEqual([]);
    expect(
      followMilestones(undefined, task("m1"), [], [{ ...reached, deleted_at: NOW }], NOW),
    ).toEqual([]);
  });
});
