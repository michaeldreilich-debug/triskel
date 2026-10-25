import { describe, expect, it } from "vitest";
import { project } from "@/features/projects/fixtures";
import { task } from "@/features/tasks/fixtures";
import { formatDayShort } from "@/lib/dates";
import { parseReview, toRecap } from "./model";
import {
  focusSuggestions,
  nextWeek,
  REVIEW_STEPS,
  reviewProjects,
  reviewWeek,
  todayHints,
} from "./review";

const week = (start: string, review: Record<string, unknown> = {}, extra = {}) =>
  toRecap({
    id: `w-${start}`,
    kind: "woche",
    period_start: start,
    period_end: start,
    review,
    ...extra,
  });
const paths = {
  review: "/wochenreview",
  month: (start: string) => `/rueckblicke/monat-${start.slice(0, 7)}`,
};

describe("Wochenreview (S1c)", () => {
  it("fünf Schritte in fester Reihenfolge", () => {
    expect(REVIEW_STEPS.map((s) => s.key)).toEqual([
      "inbox",
      "projekte",
      "faellig",
      "rueckblick",
      "fokus",
    ]);
  });

  it("Stand lesen: Schritt begrenzt, Projekte eindeutig, Fremdes fällt weg", () => {
    expect(parseReview(null)).toEqual({
      step: 0,
      projects: [],
      started_at: null,
      finished_at: null,
    });
    expect(
      parseReview({ step: 9, projects: ["a", "a", 3, "b"], started_at: "2026-10-18T08:00Z", x: 1 }),
    ).toEqual({
      step: 4,
      projects: ["a", "b"],
      started_at: "2026-10-18T08:00Z",
      finished_at: null,
    });
    expect(parseReview({ step: -2 }).step).toBe(0);
  });

  it("Woche: die laufende, montags noch die vergangene; ?woche= wählt eine andere", () => {
    expect(reviewWeek("2026-10-18")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(reviewWeek("2026-10-19")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(reviewWeek("2026-10-20")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(reviewWeek("2026-10-18", "2021-03-17")).toEqual({
      start: "2021-03-15",
      end: "2021-03-21",
    });
    expect(reviewWeek("2026-10-18", "quatsch").start).toBe("2026-10-12");
    expect(nextWeek({ start: "2026-10-12" })).toEqual({ start: "2026-10-19", end: "2026-10-25" });
  });

  it("Projekte: nur aktive, festgefahrene und stille zuerst", () => {
    const now = Date.parse("2026-10-18T10:00:00Z");
    const fresh = "2026-10-17T10:00:00Z";
    const next = task("n1", { project_id: "ok", title: "Angebot schreiben" });
    const list = reviewProjects(
      [
        project("ok", {
          title: "B läuft",
          outcome: [{ id: "o", text: "fertig", done: false }],
          next_task_id: "n1",
          last_activity_at: fresh,
          updated_at: fresh,
        }),
        project("still", {
          title: "C still",
          outcome: [{ id: "o", text: "fertig", done: false }],
          next_task_id: "n2",
        }),
        project("fest", { title: "D fest", last_activity_at: fresh, updated_at: fresh }),
        project("pause", { title: "A pausiert", status: "pausiert" }),
      ],
      [next, task("n2", { project_id: "still", updated_at: "2026-09-01T10:00:00Z" })],
      now,
    );
    expect(list.map((p) => p.project.id)).toEqual(["fest", "still", "ok"]);
    expect(list[0]?.stuck).toEqual(["ergebnis", "naechster-schritt"]);
    expect(list[1]?.stale).toBe(true);
    expect(list[2]?.next?.title).toBe("Angebot schreiben");
  });

  it("Fokus-Vorschläge: wichtige Fälligkeiten, nächste Schritte, übrige – je Titel einmal", () => {
    const projects = reviewProjects(
      [project("p", { title: "Werkstatt", next_task_id: "n" })],
      [task("n", { project_id: "p", title: "Raum buchen" })],
      Date.parse("2026-10-18T10:00:00Z"),
    );
    const suggestions = focusSuggestions({
      projects,
      tasks: [
        task("t1", { title: "Bericht", due_date: "2026-10-21" }),
        task("t2", { title: "Steuer", due_date: "2026-10-23", priority: 1 }),
        task("t3", { title: "raum buchen", due_date: "2026-10-20" }),
        task("t4", { title: "Später", due_date: "2026-11-02" }),
        task("t5", { title: "Erledigt", due_date: "2026-10-21", status: "erledigt" }),
      ],
      week: { start: "2026-10-19", end: "2026-10-25" },
      taken: ["Bericht"],
      formatDay: formatDayShort,
    });
    expect(suggestions.map((s) => [s.title, s.reason])).toEqual([
      ["Steuer", "hoch · fällig Fr, 23.10."],
      ["Raum buchen", "nächster Schritt · Werkstatt"],
    ]);
  });

  it("Hinweise auf Heute: sonntags das Review, montags nur ein angefangenes; Monatsende", () => {
    expect(todayHints([], "2026-10-18", paths)).toEqual([
      {
        kind: "woche",
        text: "Sonntag: Zeit fürs Wochenreview (KW 42)",
        action: "Starten",
        href: "/wochenreview",
      },
    ]);
    expect(todayHints([], "2026-10-19", paths)).toEqual([]);
    const started = [week("2026-10-12", { step: 2, started_at: "2026-10-18T09:00:00Z" })];
    expect(todayHints(started, "2026-10-19", paths)[0]?.text).toBe(
      "Wochenreview KW 42 · Schritt 3 von 5",
    );
    const finished = [week("2026-10-12", { started_at: "x", finished_at: "2026-10-18T10:00:00Z" })];
    expect(todayHints(finished, "2026-10-18", paths)).toEqual([]);
    expect(todayHints([], "2026-10-31", paths)).toEqual([
      {
        kind: "monat",
        text: "Monatsende: Monatsrückblick Oktober 2026",
        action: "Schreiben",
        href: "/rueckblicke/monat-2026-10",
      },
    ]);
    expect(todayHints([], "2026-11-02", paths)[0]?.text).toBe(
      "Monat vorbei: Monatsrückblick Oktober 2026",
    );
    expect(todayHints([], "2026-11-04", paths)).toEqual([]);
    const closed = toRecap({
      id: "m",
      kind: "monat",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      closed_at: "2026-10-31T20:00:00Z",
    });
    expect(todayHints([closed], "2026-11-01", paths)).toEqual([
      expect.objectContaining({ kind: "woche" }),
    ]);
  });
});
