import { describe, expect, it } from "vitest";
import { project } from "../projects/fixtures";
import type { MilestoneRow } from "../projects/types";
import { task } from "../tasks/fixtures";
import {
  axisMonths,
  axisPos,
  axisWeeks,
  buildTimeline,
  DEFAULT_TIMELINE_FILTERS,
  nextStepCards,
  parseTimelineFilters,
  type TimelineFilters,
  timelineStats,
  timelineWindow,
} from "./model";

const TODAY = "2026-10-18";

const ms = (id: string, project_id: string, extra: Partial<MilestoneRow> = {}): MilestoneRow => ({
  id,
  project_id,
  title: id,
  due_date: null,
  done_at: null,
  sort: id,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  deleted_at: null,
  ...extra,
});

const filters = (extra: Partial<TimelineFilters> = {}): TimelineFilters => ({
  ...DEFAULT_TIMELINE_FILTERS,
  zoom: "3m",
  ...extra,
});

const build = (
  projects = [project("a", { start_date: "2026-10-01", target_date: "2026-11-30" })],
  milestones: MilestoneRow[] = [],
  extra: Partial<Parameters<typeof buildTimeline>[0]> = {},
) =>
  buildTimeline({
    projects,
    milestones,
    tasks: [],
    area: null,
    filters: filters(),
    offset: 0,
    today: TODAY,
    ...extra,
  });

describe("Fenster", () => {
  it("3 Monate: ein Monat zurück bis zwei Monate voraus", () => {
    expect(timelineWindow("3m", 0, TODAY)).toEqual({ start: "2026-09-01", end: "2026-11-30" });
  });
  it("verschiebt um die Schrittweite (3 Monate = 1, 6 Monate = 3, Jahr = 6)", () => {
    expect(timelineWindow("3m", 1, TODAY).start).toBe("2026-10-01");
    expect(timelineWindow("3m", -2, TODAY).start).toBe("2026-07-01");
    expect(timelineWindow("6m", 1, TODAY)).toEqual({ start: "2026-12-01", end: "2027-05-31" });
    expect(timelineWindow("12m", 0, TODAY)).toEqual({ start: "2026-09-01", end: "2027-08-31" });
  });
  it("alles: Grenzen der Zeilen und heute, auf Monatsgrenzen, mindestens 3 Monate", () => {
    expect(timelineWindow("alles", 0, TODAY, { from: "2026-03-15", to: "2027-02-10" })).toEqual({
      start: "2026-03-01",
      end: "2027-02-28",
    });
    expect(timelineWindow("alles", 0, TODAY, null)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });
});

describe("Achse", () => {
  const w = { start: "2026-09-01", end: "2026-11-30" };
  it("Position = Mitte des Tages in Prozent", () => {
    expect(axisPos(w, "2026-09-01")).toBeCloseTo((0.5 / 91) * 100, 5);
    expect(axisPos(w, "2026-11-30")).toBeCloseTo((90.5 / 91) * 100, 5);
    expect(axisPos(w, "2026-08-31")).toBeLessThan(0);
    expect(axisPos(w, "2026-12-01")).toBeGreaterThan(100);
  });
  it("Monatsraster mit Jahreszahl im ersten Monat und im Januar", () => {
    const months = axisMonths({ start: "2026-12-01", end: "2027-02-28" });
    expect(months.map((m) => m.label)).toEqual(["Dez 26", "Jan 27", "Feb"]);
    expect(months[0]?.left).toBe(0);
    const total = months.reduce((n, m) => n + m.width, 0);
    expect(total).toBeCloseTo(100, 5);
  });
  it("Monatsraster schneidet einen angebrochenen ersten Monat ab", () => {
    const months = axisMonths({ start: "2026-09-15", end: "2026-10-31" });
    expect(months[0]?.left).toBe(0);
    expect(months[0]?.width).toBeCloseTo((16 / 47) * 100, 5);
  });
  it("Wochenlinien an den Montagen", () => {
    const weeks = axisWeeks({ start: "2026-10-01", end: "2026-10-31" });
    expect(weeks).toHaveLength(4); // 5., 12., 19., 26.10.
    expect(weeks[0]).toBeCloseTo((4 / 31) * 100, 5);
  });
});

describe("Zeilen", () => {
  it("Balken von Start bis Ziel, auf das Fenster zugeschnitten", () => {
    const row = build().rows[0];
    expect(row?.bar).toMatchObject({ inferred: false, cutLeft: false, cutRight: false });
    expect(row?.bar?.left).toBeCloseTo((30 / 91) * 100, 5);
    expect(row?.bar?.width).toBeCloseTo((61 / 91) * 100, 5);
    const cut = build(undefined, [], { offset: 2 }).rows[0]; // Fenster ab 1.11.
    expect(cut?.bar).toMatchObject({ cutLeft: true, cutRight: false, left: 0 });
    expect(cut?.bar?.width).toBeCloseTo((30 / 92) * 100, 5);
    const right = build(undefined, [], { offset: -1 }).rows[0]; // Fenster 1.8.–31.10.
    expect(right?.bar).toMatchObject({ cutLeft: false, cutRight: true });
  });
  it("ohne Überschneidung mit dem Fenster keine Zeile", () => {
    expect(build(undefined, [], { offset: 6 }).rows).toHaveLength(0);
  });
  it("nur Ziel: abgeleiteter Balken ab Anlage; nur Start: bis zum letzten Meilenstein", () => {
    const onlyTarget = build([
      project("t", { target_date: "2026-11-15", created_at: "2026-10-05T10:00:00Z" }),
    ]).rows[0];
    expect(onlyTarget?.bar).toMatchObject({ inferred: true, from: "2026-10-05", to: "2026-11-15" });
    const onlyStart = build(
      [project("s", { start_date: "2026-10-01" })],
      [ms("m", "s", { due_date: "2026-11-10" })],
    ).rows[0];
    expect(onlyStart?.bar).toMatchObject({ inferred: true, from: "2026-10-01", to: "2026-11-10" });
  });
  it("ohne Balken, aber mit Meilenstein-Datum: nur Punkte; ganz ohne Datum: Liste „ohne Termin“", () => {
    const model = build([project("p"), project("q")], [ms("m", "p", { due_date: "2026-10-20" })]);
    expect(model.rows.map((r) => r.project.id)).toEqual(["p"]);
    expect(model.rows[0]?.bar).toBeNull();
    expect(model.undated.map((p) => p.id)).toEqual(["q"]);
  });
  it("Meilensteine: erreicht, offen, überfällig; erreicht ohne Fälligkeit liegt am Erreicht-Tag", () => {
    const row = build(
      undefined,
      [
        ms("ok", "a", { due_date: "2026-10-05", done_at: "2026-10-04T08:00:00Z" }),
        ms("late", "a", { due_date: "2026-10-10" }),
        ms("soon", "a", { due_date: "2026-10-18" }),
        ms("später", "a", { due_date: "2026-11-20" }),
        ms("ohne", "a"),
        ms("nur-erreicht", "a", { done_at: "2026-10-12T08:00:00Z" }),
        ms("weg", "a", { due_date: "2026-10-12", deleted_at: "2026-10-13T00:00:00Z" }),
      ],
      {
        tasks: [
          task("t1", { milestone_id: "late", status: "erledigt" }),
          task("t2", { milestone_id: "late" }),
        ],
      },
    ).rows[0];
    expect(row?.milestones.map((m) => [m.id, m.state])).toEqual([
      ["ok", "done"],
      ["late", "overdue"],
      ["nur-erreicht", "done"],
      ["soon", "open"],
      ["später", "open"],
    ]);
    expect(row?.milestones.find((m) => m.id === "late")).toMatchObject({
      tasksDone: 1,
      tasksTotal: 2,
    });
    expect(row).toMatchObject({ milestoneTotal: 6, milestoneDone: 2, overdue: 1 });
  });
  it("Heute-Linie nur, wenn heute im Fenster liegt", () => {
    expect(build().todayPos).toBeCloseTo(
      axisPos({ start: "2026-09-01", end: "2026-11-30" }, TODAY),
      5,
    );
    expect(build(undefined, [], { offset: 4 }).todayPos).toBeNull();
  });
});

describe("Filter", () => {
  const projects = [
    project("akt", {
      status: "aktiv",
      area_id: "fw",
      start_date: "2026-10-01",
      target_date: "2026-10-30",
    }),
    project("gep", {
      status: "geplant",
      area_id: "pr",
      start_date: "2026-10-05",
      target_date: "2026-11-05",
    }),
    project("pau", {
      status: "pausiert",
      area_id: "fw",
      start_date: "2026-10-02",
      target_date: "2026-11-02",
    }),
    project("abg", {
      status: "abgeschlossen",
      area_id: "fw",
      start_date: "2026-09-02",
      target_date: "2026-09-20",
    }),
    project("arc", {
      status: "archiv",
      area_id: "fw",
      start_date: "2026-09-02",
      target_date: "2026-09-20",
    }),
    project("weg", {
      status: "aktiv",
      start_date: "2026-10-02",
      target_date: "2026-11-02",
      deleted_at: "2026-10-10T00:00:00Z",
    }),
  ];
  const ids = (m: ReturnType<typeof build>) => m.rows.map((r) => r.project.id);
  it("Standard: aktiv + geplant", () => {
    expect(ids(build(projects))).toEqual(["akt", "gep"]);
  });
  it("Status wählbar; Archiv und Papierkorb nie", () => {
    const all = filters({ statuses: ["aktiv", "geplant", "pausiert", "idee", "abgeschlossen"] });
    expect(ids(build(projects, [], { filters: all })).sort()).toEqual(["abg", "akt", "gep", "pau"]);
    expect(ids(build(projects, [], { filters: filters({ statuses: ["pausiert"] }) }))).toEqual([
      "pau",
    ]);
  });
  it("Bereich: Rest zählt als „weitere in anderen Bereichen“", () => {
    const model = build(projects, [], { area: "fw" });
    expect(ids(model)).toEqual(["akt"]);
    expect(model.hiddenByArea).toBe(1);
    expect(build(projects).hiddenByArea).toBe(0);
  });
  it("Zeitraum wirkt: Abgeschlossenes aus dem September erst im früheren Fenster", () => {
    const s = filters({ statuses: ["abgeschlossen"] });
    expect(ids(build(projects, [], { filters: s }))).toEqual(["abg"]); // Fenster ab 1.9.
    expect(ids(build(projects, [], { filters: s, offset: 1 }))).toEqual([]);
    expect(ids(build(projects, [], { filters: { ...s, zoom: "alles" } }))).toEqual(["abg"]);
  });
  it("Sortierung nach Ziel bzw. Start", () => {
    const p = [
      project("x", { start_date: "2026-10-01", target_date: "2026-11-20" }),
      project("y", { start_date: "2026-10-10", target_date: "2026-10-25" }),
    ];
    expect(ids(build(p))).toEqual(["y", "x"]);
    expect(ids(build(p, [], { filters: filters({ sort: "start" }) }))).toEqual(["x", "y"]);
  });
  it("liest gespeicherte Filter defensiv", () => {
    expect(parseTimelineFilters(null)).toEqual(DEFAULT_TIMELINE_FILTERS);
    expect(
      parseTimelineFilters({ statuses: ["idee", "x", "aktiv"], zoom: "12m", sort: "start" }),
    ).toEqual({ statuses: ["aktiv", "idee"], zoom: "12m", sort: "start" });
    expect(parseTimelineFilters({ statuses: [], zoom: "9m", sort: 3 })).toEqual({
      statuses: [],
      zoom: "6m",
      sort: "ziel",
    });
  });
});

describe("Kennzahlen", () => {
  const projects = [
    project("a", { status: "aktiv", area_id: "fw" }),
    project("b", { status: "aktiv", area_id: "pr" }),
    project("c", { status: "abgeschlossen", area_id: "fw" }),
    project("d", { status: "idee", area_id: "fw" }),
  ];
  const milestones = [
    ms("1", "a", { due_date: "2026-10-05", done_at: "2026-10-04T10:00:00Z" }),
    ms("2", "a", { due_date: "2026-10-10" }), // überfällig
    ms("3", "a", { due_date: "2026-10-28" }),
    ms("4", "b", { due_date: "2026-09-01" }), // überfällig, anderer Bereich
    ms("5", "c", { due_date: "2026-10-01" }), // abgeschlossenes Projekt zählt nicht
    ms("6", "a", { due_date: "2026-11-02" }),
  ];
  const tasks = [
    task("t1", { project_id: "a", status: "erledigt" }),
    task("t2", { project_id: "a" }),
    task("t3", { project_id: "b", status: "erledigt" }),
    task("t4", { project_id: "c" }),
  ];
  it("alle Bereiche", () => {
    expect(timelineStats(projects, milestones, tasks, null, TODAY)).toEqual({
      active: 2,
      monthMilestones: 3,
      monthDone: 1,
      overdueMilestones: 2,
      overdueProjects: 2,
      taskDone: 2,
      taskTotal: 3,
      progress: 0.6667,
    });
  });
  it("ein Bereich; ohne Aufgaben kein Fortschritt", () => {
    expect(timelineStats(projects, milestones, tasks, "pr", TODAY)).toMatchObject({
      active: 1,
      monthMilestones: 0,
      overdueMilestones: 1,
      progress: 1,
    });
    expect(timelineStats([project("z")], [], [], null, TODAY).progress).toBeNull();
  });
});

describe("Karten „Nächster Schritt“", () => {
  it("nächste offene Aufgabe und nächster Meilenstein, frühestes Ziel zuerst, nur aktive", () => {
    const projects = [
      project("spät", { target_date: "2026-12-01", next_task_id: "t-done" }),
      project("früh", { target_date: "2026-11-01", next_task_id: "t-open" }),
      project("kein-ziel"),
      project("idee", { status: "idee" }),
    ];
    const tasks = [task("t-done", { status: "erledigt" }), task("t-open")];
    const milestones = [
      ms("m-ohne", "früh"),
      ms("m-spaet", "früh", { due_date: "2026-11-20" }),
      ms("m-frueh", "früh", { due_date: "2026-11-05" }),
      ms("m-ok", "früh", { due_date: "2026-10-01", done_at: "2026-10-02T00:00:00Z" }),
    ];
    const cards = nextStepCards(projects, milestones, tasks, null);
    expect(cards.map((c) => c.project.id)).toEqual(["früh", "spät", "kein-ziel"]);
    expect(cards[0]?.task?.id).toBe("t-open");
    expect(cards[0]?.milestone?.id).toBe("m-frueh");
    expect(cards[1]?.task).toBeNull();
    expect(nextStepCards(projects, milestones, tasks, "anderer")).toEqual([]);
  });
});
