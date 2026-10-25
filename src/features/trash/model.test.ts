import { describe, expect, it } from "vitest";
import type { SaveOp } from "@/lib/save-queue/save-queue";
import { RPC_EMPTY_TRASH } from "@/lib/save-queue/supabase-persister";
import {
  applyPendingTrashOps,
  matchesTrashQuery,
  purgeNote,
  restoreTargets,
  sortTrash,
  type TrashItem,
  trashTitle,
} from "./model";

const item = (
  table: TrashItem["table"],
  id: string,
  extra: Partial<TrashItem> = {},
): TrashItem => ({
  table,
  id,
  title: id,
  deletedAt: "2026-10-16T10:00:00.000Z",
  areaId: null,
  projectId: null,
  topicId: null,
  ...extra,
});

const op = (table: string, id: string, values: Record<string, unknown>): SaveOp => ({
  table,
  id,
  mode: "update",
  values,
});

describe("Papierkorb (B13)", () => {
  it("neueste zuerst, über alle Tabellen", () => {
    const sorted = sortTrash([
      item("tasks", "alt", { deletedAt: "2026-10-01T08:00:00Z" }),
      item("notes", "neu", { deletedAt: "2026-10-16T08:00:00.000Z" }),
      item("projects", "mitte", { deletedAt: "2026-10-10T08:00:00+00:00" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["neu", "mitte", "alt"]);
  });

  it("lokal Zurückgeholtes und endgültig Gelöschtes verschwindet sofort", () => {
    const items = [item("tasks", "t1"), item("notes", "n1"), item("projects", "p1")];
    const shown = applyPendingTrashOps(items, [
      op("tasks", "t1", { deleted_at: null }),
      op(RPC_EMPTY_TRASH, "n1", { entity: "notes" }),
      op("projects", "p1", { title: "nur umbenannt" }),
    ]);
    expect(shown.map((i) => i.id)).toEqual(["p1"]);
  });

  it("zurückgeholt und wieder gelöscht: bleibt im Papierkorb (spätere Op gewinnt)", () => {
    const items = [item("tasks", "t1")];
    expect(
      applyPendingTrashOps(items, [
        op("tasks", "t1", { deleted_at: null }),
        op("tasks", "t1", { deleted_at: "2026-10-16T11:00:00Z" }),
      ]),
    ).toHaveLength(1);
  });

  it("gleiche ID in einer anderen Tabelle bleibt unberührt", () => {
    const items = [item("tasks", "x"), item("notes", "x")];
    const shown = applyPendingTrashOps(items, [op(RPC_EMPTY_TRASH, "x", { entity: "notes" })]);
    expect(shown.map((i) => i.table)).toEqual(["tasks"]);
  });

  it("Meilenstein kommt samt gelöschtem Projekt zurück, Aufgaben allein", () => {
    const project = item("projects", "p1");
    const milestone = item("milestones", "m1", { projectId: "p1" });
    const task = item("tasks", "t1", { projectId: "p1" });
    const all = [project, milestone, task];
    expect(restoreTargets(milestone, all)).toEqual([milestone, project]);
    expect(restoreTargets(task, all)).toEqual([task]);
    // Projekt nicht im Papierkorb → nur der Meilenstein
    expect(restoreTargets(milestone, [milestone])).toEqual([milestone]);
  });

  it("Suche im Titel, Titel-Ersatz und Hinweise vor dem endgültigen Löschen", () => {
    expect(matchesTrashQuery(item("notes", "n", { title: "Atemschutz Übung" }), "übung")).toBe(
      true,
    );
    expect(matchesTrashQuery(item("notes", "n", { title: "Atemschutz" }), "Leiter")).toBe(false);
    expect(matchesTrashQuery(item("notes", "n", { title: "" }), "  ")).toBe(true);
    expect(trashTitle({ title: "  " })).toBe("Ohne Titel");
    expect(purgeNote("projects")).toMatch(/Meilensteine gehen mit/);
    expect(purgeNote("tasks")).toBeNull();
  });
});
