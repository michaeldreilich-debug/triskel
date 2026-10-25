import { describe, expect, it } from "vitest";
import { setAllOptions, toggleOption } from "./view-menus";

const status = { field: "status", op: "in" as const, values: ["offen"] };

describe("Filter mit Häkchen (#78)", () => {
  it("Alle auswählen = keine Einschränkung, Alle abwählen = nichts; andere Filter bleiben", () => {
    const filters = [status, { field: "assignee", op: "in" as const, values: ["user"] }];
    expect(setAllOptions(filters, "assignee", true)).toEqual([status]);
    expect(setAllOptions(filters, "assignee", false)).toEqual([
      status,
      { field: "assignee", op: "in", values: [] },
    ]);
    // aus „nichts“ heraus ein Häkchen setzen: nur diese Option
    expect(
      toggleOption(setAllOptions([], "assignee", false), "assignee", ["user", "ai"], "ai", true),
    ).toEqual([{ field: "assignee", op: "in", values: ["ai"] }]);
  });
});
