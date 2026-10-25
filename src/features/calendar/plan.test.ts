import { describe, expect, it } from "vitest";
import { task } from "@/features/tasks/fixtures";
import type { TaskRow } from "@/features/tasks/types";
import {
  ALL_PLAN_FILTERS,
  buildPlan,
  isNow,
  isPlannable,
  PLAN_BIG_PROJECT,
  type PlanOptions,
} from "./plan";

const TODAY = "2026-10-21"; // Mittwoch

const areas = [
  { id: "fw", name: "Beruf" },
  { id: "pr", name: "Privat" },
];
const projects = [
  { id: "tt", title: "Rezeptbuch", area_id: "pr", sort: "a0" },
  { id: "wf", title: "Werkstatt", area_id: "fw", sort: "a1" },
];
const milestones = [
  { id: "m1", project_id: "tt", title: "Import", sort: "a0", done_at: null },
  { id: "m2", project_id: "tt", title: "Journal", sort: "a1", done_at: null },
  { id: "m3", project_id: "tt", title: "Release", sort: "a2", done_at: null },
];

const options = (extra: Partial<PlanOptions> = {}): PlanOptions => ({
  today: TODAY,
  area: null,
  projectId: null,
  query: "",
  filters: ALL_PLAN_FILTERS,
  projects,
  milestones,
  areas,
  ...extra,
});

const ids = (list: TaskRow[]) => list.map((t) => t.id);

/** Alle Zeilen, die die Spalte zeigt (zum Prüfen „jede Aufgabe genau einmal“) */
const everyId = (model: ReturnType<typeof buildPlan>) => [
  ...ids(model.now),
  ...ids(model.inbox),
  ...model.projects.flatMap((p) => [
    ...ids(p.loose),
    ...(p.current ? ids(p.current.tasks) : []),
    ...p.later.flatMap((g) => ids(g.tasks)),
  ]),
  ...model.areas.flatMap((a) => ids(a.tasks)),
];

describe("Einplanen: was noch einzuplanen ist", () => {
  it("offen und ohne Uhrzeit – auch mit Fälligkeit; Zeitblöcke, Erledigtes, Papierkorb nicht", () => {
    expect(isPlannable(task("a"), TODAY)).toBe(true);
    expect(isPlannable(task("a", { due_date: "2026-12-01" }), TODAY)).toBe(true);
    expect(isPlannable(task("a", { scheduled_at: "2026-10-22T08:00:00Z" }), TODAY)).toBe(false);
    expect(isPlannable(task("a", { status: "erledigt" }), TODAY)).toBe(false);
    expect(isPlannable(task("a", { deleted_at: "2026-10-01T00:00:00Z" }), TODAY)).toBe(false);
  });

  it("Fokus-Tage ab übermorgen gelten schon als eingeplant, heute/morgen und früher nicht", () => {
    expect(isPlannable(task("a", { focus_date: "2026-10-23" }), TODAY)).toBe(false);
    expect(isPlannable(task("a", { focus_date: "2026-10-22" }), TODAY)).toBe(true);
    expect(isPlannable(task("a", { focus_date: TODAY }), TODAY)).toBe(true);
    expect(isPlannable(task("a", { focus_date: "2026-10-15" }), TODAY)).toBe(true);
  });
});

describe("Einplanen: Jetzt-Regel", () => {
  it("überfällig, heute und bis zu 7 Tage voraus zählen – der 8. Tag nicht (Grenze 7/8)", () => {
    expect(isNow(task("a", { due_date: "2026-10-20" }), TODAY)).toBe(true);
    expect(isNow(task("a", { due_date: TODAY }), TODAY)).toBe(true);
    expect(isNow(task("a", { due_date: "2026-10-28" }), TODAY)).toBe(true);
    expect(isNow(task("a", { due_date: "2026-10-29" }), TODAY)).toBe(false);
  });

  it("Priorität hoch ja, mittel/niedrig nein; Fokus heute und morgen ja, übermorgen nein", () => {
    expect(isNow(task("a", { priority: 1 }), TODAY)).toBe(true);
    expect(isNow(task("a", { priority: 2 }), TODAY)).toBe(false);
    expect(isNow(task("a", { priority: 3 }), TODAY)).toBe(false);
    expect(isNow(task("a", { focus_date: TODAY }), TODAY)).toBe(true);
    expect(isNow(task("a", { focus_date: "2026-10-22" }), TODAY)).toBe(true);
    expect(isNow(task("a", { focus_date: "2026-10-23" }), TODAY)).toBe(false);
  });

  it("Inbox-Aufgaben bleiben in der Inbox, auch wenn sie fällig sind", () => {
    expect(isNow(task("a", { in_inbox: true, area_id: null, due_date: TODAY }), TODAY)).toBe(false);
  });
});

describe("Einplanen: Gruppierung", () => {
  const data: TaskRow[] = [
    task("over", { area_id: "fw", due_date: "2026-10-10" }),
    task("soon", { area_id: "fw", due_date: "2026-10-26" }),
    task("later", { area_id: "fw", due_date: "2026-11-30" }),
    task("high", { area_id: "pr", priority: 1 }),
    task("focus", { area_id: "pr", focus_date: "2026-10-22" }),
    task("inbox-due", { area_id: null, in_inbox: true, due_date: TODAY }),
    task("inbox", { area_id: null, in_inbox: true }),
    task("tt1", { area_id: "pr", project_id: "tt", milestone_id: "m1" }),
    task("tt2", { area_id: "pr", project_id: "tt", milestone_id: "m1", due_date: "2026-10-27" }),
    task("tt3", { area_id: "pr", project_id: "tt", milestone_id: "m2" }),
    task("tt4", { area_id: "pr", project_id: "tt", milestone_id: "m3" }),
    task("tt5", { area_id: "pr", project_id: "tt" }),
    task("fw1", { area_id: "fw" }),
    task("pr1", { area_id: "pr" }),
    task("done", { area_id: "fw", status: "erledigt" }),
    task("timed", { area_id: "fw", scheduled_at: "2026-10-22T08:00:00Z" }),
  ];

  it("jede Aufgabe steht genau einmal; Erledigtes und Zeitblöcke fehlen", () => {
    const model = buildPlan(data, options());
    const seen = everyId(model);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(
      [
        "over",
        "soon",
        "later",
        "high",
        "focus",
        "inbox-due",
        "inbox",
        "tt1",
        "tt2",
        "tt3",
        "tt4",
        "tt5",
        "fw1",
        "pr1",
      ].sort(),
    );
    // was oben steht, fehlt unten
    expect(ids(model.now)).toEqual(
      expect.arrayContaining(["over", "soon", "high", "focus", "tt2"]),
    );
    expect(model.projects[0]?.current?.tasks.map((t) => t.id)).not.toContain("tt2");
  });

  it("Kopfzeile: N offen, M jetzt; Jetzt nach Fälligkeit sortiert", () => {
    const model = buildPlan(data, options());
    expect(model.open).toBe(14);
    expect(model.nowCount).toBe(5);
    expect(ids(model.now)).toEqual(["over", "soon", "tt2", "high", "focus"]);
  });

  it("Fällige ohne Uhrzeit stehen in der Spalte, die weit fällige unten bei ihrem Bereich", () => {
    const model = buildPlan(data, options());
    expect(ids(model.areas.find((a) => a.id === "fw")?.tasks ?? [])).toEqual(["later", "fw1"]);
  });

  it("Inbox getrennt, nach Priorität", () => {
    const model = buildPlan(data, options());
    expect(ids(model.inbox).sort()).toEqual(["inbox", "inbox-due"]);
  });

  it("Projekt: nur der nächste offene Meilenstein aufgeklappt, spätere als Zeile mit Zählung", () => {
    const model = buildPlan(data, options());
    const tt = model.projects.find((p) => p.id === "tt");
    expect(tt?.current?.title).toBe("Import");
    expect(ids(tt?.current?.tasks ?? [])).toEqual(["tt1"]);
    expect(tt?.later.map((g) => g.title)).toEqual(["Journal", "Release"]);
    expect(tt?.laterTasks).toBe(2);
    expect(ids(tt?.loose ?? [])).toEqual(["tt5"]);
    expect(tt?.big).toBe(false);
  });

  it("ein erreichter Meilenstein rückt hinter die offenen", () => {
    const done = milestones.map((m) =>
      m.id === "m1" ? { ...m, done_at: "2026-10-01T00:00:00Z" } : m,
    );
    const model = buildPlan(data, options({ milestones: done }));
    expect(model.projects[0]?.current?.title).toBe("Journal");
  });

  it("Projekte mit mehr als 8 offenen Aufgaben sind zu (Grenze 8/9)", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => task(`p${i}`, { area_id: "pr", project_id: "tt" }));
    expect(buildPlan(many(PLAN_BIG_PROJECT), options()).projects[0]?.big).toBe(false);
    expect(buildPlan(many(PLAN_BIG_PROJECT + 1), options()).projects[0]?.big).toBe(true);
  });

  it("Aufgabe eines gelöschten Projekts steht lose bei ihrem Bereich", () => {
    const orphan = task("o", { area_id: "fw", project_id: "weg" });
    const model = buildPlan([orphan], options());
    expect(ids(model.areas[0]?.tasks ?? [])).toEqual(["o"]);
  });
});

describe("Einplanen: Bereich, Filter, Suche", () => {
  const data: TaskRow[] = [
    task("fw1", { area_id: "fw" }),
    task("pr1", { area_id: "pr" }),
    task("pr2", { area_id: "pr", due_date: TODAY }),
    task("inb", { area_id: null, in_inbox: true }),
    task("ki", { area_id: "fw", created_by: "ai" }),
    task("kip", {
      area_id: "pr",
      project_id: "tt",
      created_by: "ai",
      body_text: "Parser für IBKR",
    }),
  ];

  it("Bereichs-Schalter blendet andere aus und zählt sie für den Hinweis; die Inbox bleibt", () => {
    const model = buildPlan(data, options({ area: "fw" }));
    expect(everyId(model).sort()).toEqual(["fw1", "inb", "ki"]);
    expect(model.hiddenByArea).toBe(3);
  });

  it("Filter: Inbox, Projekte und „von KI angelegt“ lassen sich ausblenden", () => {
    const only = (filters: Partial<typeof ALL_PLAN_FILTERS>) =>
      everyId(buildPlan(data, options({ filters: { ...ALL_PLAN_FILTERS, ...filters } }))).sort();
    expect(only({ inbox: false })).not.toContain("inb");
    expect(only({ projects: false })).not.toContain("kip");
    expect(only({ ai: false })).toEqual(["fw1", "inb", "pr1", "pr2"]);
  });

  it("Suche geht über alles, auch über ausgeblendete Filter und Notizen, und klappt nichts weg", () => {
    const model = buildPlan(
      data,
      options({ query: "ibkr", filters: { inbox: false, projects: false, ai: false } }),
    );
    expect(everyId(model)).toEqual(["kip"]);
    expect(model.searching).toBe(true);
    expect(model.shown).toBe(1);
    // Projektname zählt als Treffer
    expect(everyId(buildPlan(data, options({ query: "rezept" })))).toEqual(["kip"]);
  });

  it("Projekt-Filter des Kalenders zeigt nur dieses Projekt", () => {
    expect(everyId(buildPlan(data, options({ projectId: "tt" })))).toEqual(["kip"]);
  });
});

describe("Einplanen: heutiger Tag noch unbekannt (Prüfung O8)", () => {
  it("leeres Modell statt „Invalid time value“ (Fälligkeit und Fokus gesetzt)", () => {
    const tasks = [
      task("a", { area_id: "fw", due_date: "2026-10-22" }),
      task("b", { area_id: "pr", focus_date: "2026-10-21" }),
    ];
    const model = buildPlan(tasks, options({ today: "" }));
    expect(model.open).toBe(0);
    expect(everyId(model)).toEqual([]);
    expect(buildPlan(tasks, options()).open).toBe(2);
  });
});

describe("Spalte „Wählen“ auf Heute (#90): eigener Vorrat statt „einzuplanen“", () => {
  it("mit `pool` zählt, was der Aufrufer mitbringt – auch Aufgaben mit Uhrzeit oder Fokus weit voraus", () => {
    const tasks = [
      task("a", { area_id: "fw", scheduled_at: "2026-10-22T08:00:00Z" }),
      task("b", { area_id: "fw", focus_date: "2026-12-01" }),
      task("c", { area_id: "pr", project_id: "tt", milestone_id: "m1" }),
    ];
    // Standard: Aufgaben mit Uhrzeit bzw. fernem Fokus gelten als eingeplant
    expect(everyId(buildPlan(tasks, options()))).toEqual(["c"]);
    // mit eigenem Vorrat: alle, jede genau einmal
    const model = buildPlan(tasks, options({ pool: () => true }));
    expect([...everyId(model)].sort()).toEqual(["a", "b", "c"]);
    expect(model.open).toBe(3);
  });
});
