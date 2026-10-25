import { describe, expect, it } from "vitest";
import { task } from "../tasks/fixtures";
import { project } from "./fixtures";
import {
  activeCountByArea,
  formatProgress,
  isStale,
  lastActivity,
  overloadedAreas,
  projectProgress,
  stuckReasons,
  stuckText,
} from "./rules";

describe("Fortschritt = erledigte ÷ alle Aufgaben (F4)", () => {
  it("rechnet nur Aufgaben des Projekts, ohne Aufgaben „–“", () => {
    const tasks = [
      task("a", { project_id: "p", status: "erledigt" }),
      task("b", { project_id: "p" }),
      task("c", { project_id: "p", status: "in_arbeit" }),
      task("d", { project_id: "x", status: "erledigt" }),
    ];
    const progress = projectProgress("p", tasks);
    expect(progress).toEqual({ total: 3, done: 1, ratio: 0.3333 });
    expect(formatProgress(progress)).toBe("33 %");
    expect(formatProgress(projectProgress("leer", tasks))).toBe("–");
    expect(projectProgress("x", tasks).ratio).toBe(1);
  });
});

describe("festgefahren (aktiv ohne Ergebnis oder ohne offenen nächsten Schritt)", () => {
  const next = task("n", { project_id: "p" });
  it("nennt die Gründe", () => {
    expect(stuckReasons(project("p"), [next])).toEqual(["ergebnis", "naechster-schritt"]);
    const withOutcome = project("p", {
      outcome: [{ id: "1", text: "Läuft digital", done: false }],
    });
    expect(stuckReasons(withOutcome, [next])).toEqual(["naechster-schritt"]);
    expect(stuckReasons({ ...withOutcome, next_task_id: "n" }, [next])).toEqual([]);
    expect(
      stuckReasons({ ...withOutcome, next_task_id: "n" }, [{ ...next, status: "erledigt" }]),
    ).toEqual(["naechster-schritt"]);
  });

  it("leere Ergebnis-Punkte zählen nicht; nur aktive Projekte", () => {
    expect(
      stuckReasons(
        project("p", { outcome: [{ id: "1", text: "  ", done: false }], next_task_id: "n" }),
        [next],
      ),
    ).toEqual(["ergebnis"]);
    expect(stuckReasons(project("p", { status: "geplant" }), [])).toEqual([]);
  });

  it("Kurzform mit Grund (Muster 5)", () => {
    expect(stuckText([])).toBe("");
    expect(stuckText(["ergebnis"])).toBe("Festgefahren: Ergebnis fehlt");
    expect(stuckText(["naechster-schritt"])).toBe("Festgefahren: nächster Schritt fehlt");
    expect(stuckText(["ergebnis", "naechster-schritt"])).toBe(
      "Festgefahren: Ergebnis, nächster Schritt fehlen",
    );
  });
});

describe("14 Tage still", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");
  it("aktiv und 14 Tage ohne Bewegung (Projekt oder Aufgaben)", () => {
    const p = project("p", {
      last_activity_at: "2026-10-05T09:00:00Z",
      updated_at: "2026-10-05T09:00:00Z",
    });
    expect(isStale(p, [], now)).toBe(true);
    expect(isStale(p, [], Date.parse("2026-10-19T08:00:00Z"))).toBe(false);
    const touched = [task("t", { project_id: "p", updated_at: "2026-10-18T10:00:00Z" })];
    expect(isStale(p, touched, now)).toBe(false);
    expect(lastActivity(p, touched)).toBe(Date.parse("2026-10-18T10:00:00Z"));
    expect(isStale({ ...p, status: "pausiert" }, [], now)).toBe(false);
  });
});

describe("höchstens 3 aktive Projekte je Bereich", () => {
  it("zählt je Bereich und meldet Überlast", () => {
    const projects = [
      project("1"),
      project("2"),
      project("3"),
      project("4"),
      project("5", { area_id: "pv" }),
      project("6", { status: "geplant" }),
      project("7", { deleted_at: "2026-10-02T00:00:00Z" }),
    ];
    expect(Object.fromEntries(activeCountByArea(projects))).toEqual({ fw: 4, pv: 1 });
    expect(overloadedAreas(projects)).toEqual([{ areaId: "fw", count: 4 }]);
    expect(overloadedAreas(projects.slice(1))).toEqual([]);
  });
});
