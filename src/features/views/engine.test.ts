import { describe, expect, it } from "vitest";
import { project } from "@/features/projects/fixtures";
import { task } from "@/features/tasks/fixtures";
import type { TaskRow } from "@/features/tasks/types";
import { parseViewConfig, sameConfig } from "./config";
import {
  applyFilters,
  applySearch,
  archiveFilterState,
  archiveOnlyFilters,
  dateBucket,
  groupRows,
  matchesDatePreset,
  runView,
  sortRows,
} from "./engine";
import { PROJECT_FIELDS, type ProjectViewCtx } from "./entities/projects";
import {
  FOR_ME_FILTER,
  TASK_BOARD_FIELDS,
  TASK_DEFAULTS,
  TASK_FIELDS,
  type TaskViewCtx,
  withForMeFilter,
} from "./entities/tasks";

const TODAY = "2026-10-11"; // Sonntag
const ctx: TaskViewCtx = {
  projects: [
    { id: "p1", title: "Werkstatt" } as TaskViewCtx["projects"][number],
    { id: "p2", title: "Bewerbung" } as TaskViewCtx["projects"][number],
  ],
  milestones: [],
  areas: [
    { id: "fw", name: "Beruf", color: "orange" },
    { id: "pv", name: "Privat", color: "blue" },
  ],
  blocked: new Set(["c"]),
  today: TODAY,
  blockersOf: (id) => (id === "c" ? [task("a", { title: "Angebot" })] : []),
};

const rows: TaskRow[] = [
  task("a", {
    title: "Angebot",
    status: "offen",
    priority: 1,
    due_date: "2026-10-10",
    project_id: "p1",
    area_id: "fw",
    updated_at: "2026-10-11T08:00:00Z",
  }),
  task("b", {
    title: "Brot",
    status: "erledigt",
    priority: null,
    due_date: null,
    area_id: "pv",
    updated_at: "2026-10-11T09:00:00Z",
  }),
  task("c", {
    title: "Code",
    status: "wartet",
    priority: 3,
    due_date: "2026-10-11",
    project_id: "p2",
    area_id: "pv",
    updated_at: "2026-10-10T08:00:00Z",
  }),
  task("d", {
    title: "Dach",
    status: "in_arbeit",
    priority: 2,
    due_date: "2026-10-30",
    area_id: null,
    in_inbox: true,
    updated_at: "2026-10-09T08:00:00Z",
  }),
];
const ids = (list: TaskRow[]) => list.map((t) => t.id);

describe("Filter", () => {
  it("Auswahl: nur gewählte Werte (auch „keine“)", () => {
    expect(
      ids(
        applyFilters(
          rows,
          [{ field: "status", op: "in", values: ["offen", "wartet"] }],
          TASK_FIELDS,
          ctx,
          TODAY,
        ),
      ),
    ).toEqual(["a", "c"]);
    expect(
      ids(
        applyFilters(
          rows,
          [{ field: "priority", op: "in", values: [""] }],
          TASK_FIELDS,
          ctx,
          TODAY,
        ),
      ),
    ).toEqual(["b"]);
    expect(
      ids(applyFilters(rows, [{ field: "area", op: "in", values: [""] }], TASK_FIELDS, ctx, TODAY)),
    ).toEqual(["d"]);
    expect(
      ids(
        applyFilters(
          rows,
          [{ field: "blocked", op: "in", values: ["ja"] }],
          TASK_FIELDS,
          ctx,
          TODAY,
        ),
      ),
    ).toEqual(["c"]);
  });

  it("Angelegt von (#69): Ich / KI, ohne Filter alle; Ansicht mit dem Filter bleibt lesbar", () => {
    const mixed = [...rows, task("e", { title: "Von KI", created_by: "ai" })];
    const by = (values: string[]) =>
      ids(
        applyFilters(mixed, [{ field: "created_by", op: "in", values }], TASK_FIELDS, ctx, TODAY),
      );
    expect(by(["ai"])).toEqual(["e"]);
    expect(by(["user"])).toEqual(ids(rows));
    expect(by(["user", "ai"])).toEqual(ids(mixed));
    expect(ids(applyFilters(mixed, [], TASK_FIELDS, ctx, TODAY))).toEqual(ids(mixed));
    // gespeicherte Ansicht mit dem Filter wird gelesen, nicht verworfen
    const parsed = parseViewConfig(
      { filters: [{ field: "created_by", op: "in", values: ["ai"] }] },
      TASK_FIELDS,
      TASK_DEFAULTS,
      TASK_BOARD_FIELDS,
    );
    expect(parsed.filters).toEqual([{ field: "created_by", op: "in", values: ["ai"] }]);
  });

  it("Zuständig (#77): Ich / KI filtern; ein alter Gerätestand bekommt „Ich“ einmal dazu", () => {
    const mixed = [...rows, task("k", { title: "Bauschritt", assignee: "ai" })];
    const by = (values: string[]) =>
      ids(applyFilters(mixed, [{ field: "assignee", op: "in", values }], TASK_FIELDS, ctx, TODAY));
    expect(by(["ai"])).toEqual(["k"]);
    expect(by(["user"])).toEqual(ids(rows));
    expect(ids(applyFilters(mixed, [FOR_ME_FILTER], TASK_FIELDS, ctx, TODAY))).toEqual(ids(rows));
    // Upgrade: übrige Filter bleiben, ein vorhandener Zuständig-Filter wird ersetzt
    const status = { field: "status", op: "in" as const, values: ["offen"] };
    expect(withForMeFilter({ filters: [status] })).toEqual({ filters: [status, FOR_ME_FILTER] });
    expect(withForMeFilter({ filters: [{ field: "assignee", op: "in", values: ["ai"] }] })).toEqual(
      { filters: [FOR_ME_FILTER] },
    );
    // ohne Filter im alten Stand: Vorgabe + „Ich“
    expect(withForMeFilter({ group: "project" })).toEqual({
      filters: [...TASK_DEFAULTS.filters, FOR_ME_FILTER],
    });
  });

  it("mehrere Filter gelten zusammen; unbekannte Felder werden ignoriert", () => {
    const filtered = applyFilters(
      rows,
      [
        { field: "status", op: "in", values: ["offen", "wartet", "in_arbeit"] },
        { field: "due_date", op: "date", value: "any" },
        { field: "gibt-es-nicht", op: "in", values: ["x"] },
      ],
      TASK_FIELDS,
      ctx,
      TODAY,
    );
    expect(ids(filtered)).toEqual(["a", "c", "d"]);
  });

  it("Datum: überfällig, heute, diese Woche (Mo–So), nächste 7 Tage, ohne/mit", () => {
    expect(matchesDatePreset("2026-10-10", "overdue", TODAY)).toBe(true);
    expect(matchesDatePreset("2026-10-11", "today", TODAY)).toBe(true);
    expect(matchesDatePreset("2026-10-05", "week", TODAY)).toBe(true);
    expect(matchesDatePreset("2026-10-12", "week", TODAY)).toBe(false);
    expect(matchesDatePreset("2026-10-17", "next7", TODAY)).toBe(true);
    expect(matchesDatePreset("2026-10-18", "next7", TODAY)).toBe(false);
    expect(matchesDatePreset(null, "none", TODAY)).toBe(true);
    expect(matchesDatePreset(null, "any", TODAY)).toBe(false);
    expect(
      ids(
        applyFilters(
          rows,
          [{ field: "due_date", op: "date", value: "overdue" }],
          TASK_FIELDS,
          ctx,
          TODAY,
        ),
      ),
    ).toEqual(["a"]);
  });

  it("Suche im Titel", () => {
    const titleOnly = TASK_FIELDS.filter((f) => f.key === "title");
    expect(ids(applySearch(rows, "co", titleOnly, ctx))).toEqual(["c"]);
    expect(applySearch(rows, " ", titleOnly, ctx)).toBe(rows);
  });
});

describe("Sortieren", () => {
  it("zuletzt bearbeitet zuerst (Standard)", () => {
    expect(ids(sortRows(rows, { field: "updated_at", dir: "desc" }, TASK_FIELDS, ctx))).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("Fälligkeit aufsteigend und absteigend, ohne Datum immer am Ende", () => {
    expect(ids(sortRows(rows, { field: "due_date", dir: "asc" }, TASK_FIELDS, ctx))).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
    expect(ids(sortRows(rows, { field: "due_date", dir: "desc" }, TASK_FIELDS, ctx))).toEqual([
      "d",
      "c",
      "a",
      "b",
    ]);
  });

  it("Auswahlfelder in Optionsreihenfolge (Priorität Hoch → Keine), Titel nach deutscher Ordnung", () => {
    expect(ids(sortRows(rows, { field: "priority", dir: "asc" }, TASK_FIELDS, ctx))).toEqual([
      "a",
      "d",
      "c",
      "b",
    ]);
    expect(ids(sortRows(rows, { field: "status", dir: "asc" }, TASK_FIELDS, ctx))).toEqual([
      "a",
      "d",
      "c",
      "b",
    ]);
    const umlaut = [task("x", { title: "Zange" }), task("y", { title: "Äpfel" })];
    expect(ids(sortRows(umlaut, { field: "title", dir: "asc" }, TASK_FIELDS, ctx))).toEqual([
      "y",
      "x",
    ]);
  });
});

describe("Gruppieren", () => {
  it("nach Status in fester Reihenfolge; Board behält leere Spalten", () => {
    const groups = groupRows(rows, "status", TASK_FIELDS, ctx, TODAY);
    expect(groups.map((g) => [g.label, ids(g.rows)])).toEqual([
      ["Offen", ["a"]],
      ["In Arbeit", ["d"]],
      ["Wartet", ["c"]],
      ["Erledigt", ["b"]],
    ]);
    const board = groupRows([rows[0] as TaskRow], "status", TASK_FIELDS, ctx, TODAY, true);
    expect(board.map((g) => g.rows.length)).toEqual([1, 0, 0, 0]);
  });

  it("Projekte nach Status: aktive oben, das Board behält den Ablauf (#74)", () => {
    const projectCtx: ProjectViewCtx = { tasks: [], areas: [], now: 0 };
    const projects = [
      project("i", { status: "idee" }),
      project("g", { status: "geplant" }),
      project("a", { status: "aktiv" }),
      project("p", { status: "pausiert" }),
      project("x", { status: "abgeschlossen" }),
    ];
    expect(
      groupRows(projects, "status", PROJECT_FIELDS, projectCtx, TODAY).map((g) => g.key),
    ).toEqual(["aktiv", "geplant", "pausiert", "idee", "abgeschlossen"]);
    expect(
      groupRows(projects, "status", PROJECT_FIELDS, projectCtx, TODAY, true).map((g) => g.key),
    ).toEqual(["idee", "geplant", "aktiv", "pausiert", "abgeschlossen", "archiv"]);
  });

  it("nach Projekt (ohne = oben, #79) und Bereich (Inbox am Ende)", () => {
    expect(groupRows(rows, "project", TASK_FIELDS, ctx, TODAY).map((g) => g.label)).toEqual([
      "Ohne Projekt",
      "Bewerbung",
      "Werkstatt",
    ]);
    expect(
      groupRows(rows, "area", TASK_FIELDS, ctx, TODAY).map((g) => [g.label, g.rows.length]),
    ).toEqual([
      ["Beruf", 1],
      ["Privat", 2],
      ["Inbox", 1],
    ]);
  });

  it("nach Fälligkeit in Zeit-Gruppen", () => {
    expect(dateBucket("2026-10-10", TODAY)).toBe("overdue");
    expect(dateBucket("2026-10-11", TODAY)).toBe("today");
    expect(dateBucket("2026-10-30", TODAY)).toBe("later");
    expect(dateBucket("2026-10-08", "2026-10-07")).toBe("week");
    expect(groupRows(rows, "due_date", TASK_FIELDS, ctx, TODAY).map((g) => g.label)).toEqual([
      "Überfällig",
      "Heute",
      "Später",
      "Ohne Datum",
    ]);
  });

  it("alles zusammen: Filter, Suche, Sortierung", () => {
    const result = runView(rows, TASK_DEFAULTS, TASK_FIELDS, ctx, { today: TODAY, query: "a" });
    expect(ids(result)).toEqual(["a", "d"]);
  });
});

describe("gespeicherte Konfiguration", () => {
  const parse = (raw: unknown) =>
    parseViewConfig(raw, TASK_FIELDS, TASK_DEFAULTS, TASK_BOARD_FIELDS);

  it("stellt gültige Werte wieder her", () => {
    const raw = {
      type: "board",
      filters: [
        { field: "priority", op: "in", values: ["1"] },
        { field: "due_date", op: "date", value: "week" },
      ],
      sort: { field: "due_date", dir: "asc" },
      group: "area",
      board: "priority",
      columns: ["title", "due_date"],
    };
    expect(parse(raw)).toEqual(raw);
  });

  it("verwirft Unbekanntes und fällt auf die Vorgabe zurück", () => {
    expect(parse("kaputt")).toEqual(TASK_DEFAULTS);
    const parsed = parse({
      type: "galerie",
      filters: [
        { field: "title", op: "in", values: ["x"] },
        { field: "status", op: "date", value: "today" },
        { field: "status", op: "in", values: ["offen"] },
        "Unsinn",
      ],
      sort: { field: "gibt-es-nicht", dir: "asc" },
      group: "title",
      board: "project",
      columns: ["title", "gibt-es-nicht"],
    });
    expect(parsed).toEqual(TASK_DEFAULTS);
  });

  it("erkennt gleiche Konfigurationen unabhängig von der Reihenfolge", () => {
    const a = {
      ...TASK_DEFAULTS,
      filters: [{ field: "status", op: "in" as const, values: ["wartet", "offen"] }],
    };
    const b = {
      ...TASK_DEFAULTS,
      filters: [{ field: "status", op: "in" as const, values: ["offen", "wartet"] }],
    };
    expect(sameConfig(a, b)).toBe(true);
    expect(sameConfig(a, { ...b, group: "status" })).toBe(false);
  });
});

describe("Archiv-Hinweis (B13)", () => {
  const archive = { field: "status", value: "archiv" };
  const open = ["idee", "geplant", "aktiv", "pausiert", "abgeschlossen"];

  it("erkennt ausgeblendetes Archiv, nur Archiv und kein Status-Filter", () => {
    expect(archiveFilterState([{ field: "status", op: "in", values: open }], archive)).toBe(
      "hidden",
    );
    expect(archiveFilterState([{ field: "status", op: "in", values: ["archiv"] }], archive)).toBe(
      "only",
    );
    expect(
      archiveFilterState([{ field: "status", op: "in", values: [...open, "archiv"] }], archive),
    ).toBe("shown");
    expect(archiveFilterState([], archive)).toBe("shown");
  });

  it("„Archiv zeigen“ ersetzt nur den Status-Filter", () => {
    const area = { field: "area", op: "in" as const, values: ["a1"] };
    expect(
      archiveOnlyFilters([{ field: "status", op: "in", values: open }, area], archive),
    ).toEqual([area, { field: "status", op: "in", values: ["archiv"] }]);
  });
});
