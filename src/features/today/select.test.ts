import { describe, expect, it } from "vitest";
import { project } from "../projects/fixtures";
import { task } from "../tasks/fixtures";
import { isEvening, suggestionReason, timeline, todayData, todaySummary } from "./select";

// 24.10.2026, 12:00 Sommerzeit (Tag vor der Zeitumstellung)
const NOON = new Date("2026-10-24T10:00:00Z");

describe("Heute", () => {
  const tasks = [
    task("fokus", { focus_date: "2026-10-24", priority: 2 }),
    task("fokus-erledigt", { focus_date: "2026-10-24", status: "erledigt" }),
    task("fokus-blockiert", { focus_date: "2026-10-24" }),
    task("ueberfaellig", { due_date: "2026-10-20" }),
    task("heute-faellig", { due_date: "2026-10-24", priority: 1 }),
    task("blockiert", { due_date: "2026-10-24" }),
    task("erledigt-faellig", { due_date: "2026-10-23", status: "erledigt" }),
    task("morgen", { due_date: "2026-10-25" }),
    task("termin-spaet", { scheduled_at: "2026-10-24T16:00:00Z" }),
    task("termin-frueh", { scheduled_at: "2026-10-24T07:00:00Z" }),
    // 23:30 UTC am 24.10. ist in Berlin schon der 25.10.
    task("termin-morgen", { scheduled_at: "2026-10-24T22:30:00Z" }),
    task("inbox", { in_inbox: true, area_id: null, created_at: "2026-10-24T08:00:00Z" }),
    task("anderer-bereich", { area_id: "pv", due_date: "2026-10-24" }),
  ];
  const blocked = new Set(["fokus-blockiert", "blockiert"]);
  const data = todayData({ tasks, blocked, projects: [], area: null, now: NOON });
  const ids = (list: Array<{ id: string }>) => list.map((t) => t.id);

  it("Fokus: Fokus-Tag heute, ohne blockierte", () => {
    expect(ids(data.focus)).toEqual(["fokus", "fokus-erledigt"]);
    expect(data.focusDone).toBe(1);
  });

  it("Fällig & überfällig: offen, bis heute, ohne blockierte, älteste zuerst", () => {
    expect(ids(data.due)).toEqual(["ueberfaellig", "heute-faellig", "anderer-bereich"]);
    expect(data.hiddenBlocked).toBe(2);
  });

  it("Tagesablauf: geplant für heute in Europe/Berlin, nach Uhrzeit", () => {
    expect(data.schedule.map((s) => [s.task.id, s.time])).toEqual([
      ["termin-frueh", "09:00"],
      ["termin-spaet", "18:00"],
    ]);
    expect(ids(data.inbox)).toEqual(["inbox"]);
  });

  it("Bereichs-Schalter filtert (Inbox bleibt)", () => {
    const fw = todayData({ tasks, blocked, projects: [], area: "a", now: NOON });
    expect(ids(fw.due)).toEqual(["ueberfaellig", "heute-faellig"]);
    expect(ids(fw.inbox)).toEqual(["inbox"]);
  });

  it("Abendplanung: Fokus für morgen, Vorschläge ohne blockierte und ohne Inbox", () => {
    const planned = [...tasks, task("geplant", { focus_date: "2026-10-25" })];
    const evening = todayData({ tasks: planned, blocked, projects: [], area: null, now: NOON });
    expect(evening.tomorrow).toBe("2026-10-25");
    expect(ids(evening.planned)).toEqual(["geplant"]);
    expect(ids(evening.candidates)).not.toContain("blockiert");
    expect(ids(evening.candidates)).not.toContain("inbox");
    expect(ids(evening.suggestions)).toEqual([
      "ueberfaellig",
      "heute-faellig",
      "anderer-bereich",
      "morgen",
    ]);
  });

  it("Projekte im Blick: aktive, stille zuerst", () => {
    const projects = [
      project("frisch", {
        last_activity_at: "2026-10-23T10:00:00Z",
        updated_at: "2026-10-23T10:00:00Z",
      }),
      project("still", {
        last_activity_at: "2026-10-01T10:00:00Z",
        updated_at: "2026-10-01T10:00:00Z",
      }),
      project("idee", { status: "idee" }),
    ];
    const result = todayData({ tasks: [], blocked: new Set(), projects, area: null, now: NOON });
    expect(result.projects.map((p) => [p.project.id, p.stale])).toEqual([
      ["still", true],
      ["frisch", false],
    ]);
  });
});

describe("Abendplanung hervorgehoben ab 19:00 (Abendzeit 20:00 − 1 h)", () => {
  it("vor und nach der Zeitumstellung am 25.10.2026", () => {
    // Sommerzeit: 19:00 = 17:00 UTC
    expect(isEvening(new Date("2026-10-24T16:59:00Z"))).toBe(false);
    expect(isEvening(new Date("2026-10-24T17:00:00Z"))).toBe(true);
    // Winterzeit: 19:00 = 18:00 UTC
    expect(isEvening(new Date("2026-10-25T17:59:00Z"))).toBe(false);
    expect(isEvening(new Date("2026-10-25T18:00:00Z"))).toBe(true);
    expect(isEvening(new Date("2026-10-25T22:30:00Z"))).toBe(true);
  });

  it("eigene Abendzeit aus den Einstellungen", () => {
    expect(isEvening(new Date("2026-10-24T17:30:00Z"), "21:00:00")).toBe(false); // 19:30
    expect(isEvening(new Date("2026-10-24T18:00:00Z"), "21:00:00")).toBe(true); // 20:00 = 21:00 − 1 h
  });

  it("nach Mitternacht beginnt ein neuer Tag: der Plan von gestern ist der heutige Fokus", () => {
    const tasks = [task("plan", { focus_date: "2026-10-25" })];
    const evening = todayData({
      tasks,
      blocked: new Set(),
      projects: [],
      area: null,
      now: new Date("2026-10-24T18:00:00Z"),
    });
    expect(evening.planned.map((t) => t.id)).toEqual(["plan"]);
    const morning = todayData({
      tasks,
      blocked: new Set(),
      projects: [],
      area: null,
      now: new Date("2026-10-25T08:00:00Z"),
    });
    expect(morning.today).toBe("2026-10-25");
    expect(morning.focus.map((t) => t.id)).toEqual(["plan"]);
    expect(morning.evening).toBe(false);
  });
});

describe("Feinschliff (#23): Vorschlagsgrund, Zusammenfassung, Zeitleiste", () => {
  const today = "2026-10-24";
  const tomorrow = "2026-10-25";

  it("nennt den Grund eines Vorschlags", () => {
    expect(suggestionReason(task("a", { due_date: "2026-10-20" }), today, tomorrow)).toEqual({
      label: "überfällig",
      urgent: true,
    });
    expect(suggestionReason(task("b", { due_date: today, priority: 1 }), today, tomorrow)).toEqual({
      label: "hoch · heute fällig",
      urgent: false,
    });
    expect(suggestionReason(task("c", { due_date: tomorrow }), today, tomorrow).label).toBe(
      "morgen fällig",
    );
    expect(suggestionReason(task("d", { focus_date: today }), today, tomorrow).label).toBe(
      "heute im Fokus",
    );
  });

  it("fasst den Tag zusammen", () => {
    const data = todayData({
      tasks: [
        task("f1", { focus_date: today }),
        task("f2", { focus_date: today, status: "erledigt" }),
        task("alt", { due_date: "2026-10-20" }),
        task("heute", { due_date: today }),
        task("i", { in_inbox: true, area_id: null }),
        task("frueh", { scheduled_at: "2026-10-24T05:30:00Z" }),
        task("spaet", { scheduled_at: "2026-10-24T16:00:00Z" }),
      ],
      blocked: new Set(),
      projects: [],
      area: null,
      now: NOON,
    });
    expect(todaySummary(data, "12:00")).toEqual({
      focus: 2,
      focusDone: 1,
      overdue: 1,
      inbox: 1,
      nextAppointment: "18:00",
    });
    // mit Google-Terminen (S2c): der nächste offene Eintrag zählt, erledigte und vergangene nicht
    expect(
      todaySummary(data, "12:00", [
        { time: "09:00" },
        { time: "14:00", done: true },
        { time: "15:30" },
        { time: "18:00" },
      ]).nextAppointment,
    ).toBe("15:30");
  });

  it("setzt die Jetzt-Linie vor den nächsten Eintrag", () => {
    const a = task("a");
    const b = task("b");
    const schedule = [
      { task: a, time: "07:30" },
      { task: b, time: "21:00" },
    ];
    const kinds = (items: ReturnType<typeof timeline>) => items.map((i) => `${i.kind}@${i.time}`);
    expect(kinds(timeline(schedule, "08:39", "20:00"))).toEqual([
      "entry@07:30",
      "now@08:39",
      "evening@20:00",
      "entry@21:00",
    ]);
    expect(kinds(timeline([], "22:10", "20:00"))).toEqual(["evening@20:00", "now@22:10"]);
  });
});
