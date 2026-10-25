import { describe, expect, it } from "vitest";
import { blockedTaskIds, blockersOf, dependentsOf, wouldCreateCycle } from "./dependencies";
import { task } from "./fixtures";
import { type DependencyRow, dependencyId } from "./types";

const dep = (task: string, blocker: string, deleted = false): DependencyRow => ({
  id: dependencyId(task, blocker),
  task_id: task,
  blocked_by_task_id: blocker,
  deleted_at: deleted ? "2026-10-01T00:00:00Z" : null,
});

describe("Zyklus-Sperre (wie der DB-Trigger)", () => {
  // B wartet auf A, C wartet auf B
  const deps = [dep("B", "A"), dep("C", "B")];

  it("Selbstverweis ist ein Kreis", () => {
    expect(wouldCreateCycle(deps, "A", "A")).toBe(true);
  });

  it("direkter und indirekter Kreis werden erkannt", () => {
    expect(wouldCreateCycle(deps, "A", "B")).toBe(true); // A wartet auf B, B auf A
    expect(wouldCreateCycle(deps, "A", "C")).toBe(true); // A → C → B → A
  });

  it("erlaubte Abhängigkeiten", () => {
    expect(wouldCreateCycle(deps, "C", "A")).toBe(false);
    expect(wouldCreateCycle(deps, "D", "C")).toBe(false);
  });

  it("gelöschte Abhängigkeiten zählen nicht", () => {
    expect(wouldCreateCycle([dep("B", "A", true)], "A", "B")).toBe(false);
  });
});

describe("blockiert (wie v_tasks.is_blocked)", () => {
  it("nur offene, nicht gelöschte Blockaden zählen", () => {
    const tasks = [
      task("A"),
      task("B"),
      task("C", { status: "erledigt" }),
      task("D"),
      task("E", { deleted_at: "2026-10-02T00:00:00Z" }),
      task("F"),
    ];
    const deps = [dep("B", "A"), dep("D", "C"), dep("F", "E"), dep("A", "F", true)];
    expect([...blockedTaskIds(tasks, deps)]).toEqual(["B"]);
    expect(blockersOf("B", tasks, deps).map((t) => t.id)).toEqual(["A"]);
    expect(blockersOf("F", tasks, deps)).toEqual([]);
    expect(dependentsOf("A", tasks, deps).map((t) => t.id)).toEqual(["B"]);
  });
});
