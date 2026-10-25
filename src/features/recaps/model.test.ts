import { describe, expect, it } from "vitest";
import { task } from "@/features/tasks/fixtures";
import {
  aggregateValue,
  answerOf,
  answerPatch,
  CONVERSATION_QUESTIONS,
  DEFAULT_QUESTIONS,
  dayActivity,
  daySummary,
  dueMonth,
  formatValue,
  gapCount,
  groupBySection,
  historyGaps,
  historyPeriods,
  historyRows,
  historyYears,
  isAnswered,
  monthOfWeek,
  monthQuestions,
  monthWeeks,
  onThisDay,
  parsePeriodSlug,
  parseQuestions,
  parseStats,
  periodSlug,
  previousHints,
  previousRecap,
  questionsOf,
  recapLabel,
  recapMonths,
  recapTitle,
  recapWeeks,
  recapYear,
  themeCounts,
  toRecap,
  weekActivity,
  withConversationFields,
} from "./model";
import type { RecapQuestion } from "./types";

const recap = (id: string, start: string, extra: Record<string, unknown> = {}) =>
  toRecap({ id, kind: "woche", period_start: start, period_end: start, ...extra });

const q = (key: string): RecapQuestion =>
  DEFAULT_QUESTIONS.find((question) => question.key === key) as RecapQuestion;

describe("Leitfragen", () => {
  it("liest die Vorlage aus Migration 09 ({questions: […]})", () => {
    expect(parseQuestions({ questions: DEFAULT_QUESTIONS })).toEqual(DEFAULT_QUESTIONS);
  });

  it("verwirft Ungültiges, Doppeltes und umgedeutete feste Schlüssel", () => {
    expect(
      parseQuestions([
        { key: "good", label: "Gut?", type: "text" },
        { key: "good", label: "Doppelt", type: "text" },
        { key: "mood", label: "Stimmung als Text", type: "text" },
        { key: "x", label: "", type: "text" },
        { key: "y", label: "Y", type: "farbe" },
        { key: "z", label: "Liste", type: "list", count: 99 },
      ]),
    ).toEqual([
      { key: "good", label: "Gut?", type: "text" },
      { key: "z", label: "Liste", type: "list", count: 10 },
    ]);
  });

  it("Antworten: feste Spalten bzw. answers", () => {
    const r = recap("r", "2026-10-12", {
      mood: 4,
      sport: "2.5",
      focus_next: ["Bericht", "", "Sport"],
      answers: { good: "Viel geschafft", eigene: 3 },
    });
    expect(answerOf(r, q("mood"))).toBe(4);
    expect(answerOf(r, q("sport"))).toBe(2.5);
    expect(answerOf(r, q("good"))).toBe("Viel geschafft");
    expect(answerOf(r, q("hard"))).toBe("");
    expect(answerOf(r, { key: "eigene", label: "Eigene", type: "scale" })).toBe(3);
    expect(answerOf(r, q("focus_next"))).toEqual(["Bericht", "", "Sport"]);
    expect(isAnswered(r, q("hard"))).toBe(false);
    expect(isAnswered(r, q("focus_next"))).toBe(true);
    expect(answerPatch(r, q("energy"), 2)).toEqual({ energy: 2 });
    expect(answerPatch(r, q("hard"), "Schlaf")).toEqual({
      answers: { good: "Viel geschafft", eigene: 3, hard: "Schlaf" },
    });
  });
});

describe("Zahlen", () => {
  it("liest week_stats samt Tagesverlauf; alte Snapshots ohne activity", () => {
    const stats = parseStats({
      period: { start: "2026-10-12", end: "2026-10-18" },
      tasks_done: { total: 3, by_area: [{ area_id: "a", name: "Beruf", count: 3 }] },
      milestones_done: 1,
      focus_days: { achieved: 2, planned: 4 },
      stuck_projects: [{ id: "p", title: "Übung" }],
      stale_projects: [],
      activity: [
        {
          date: "2026-10-13",
          done: [{ id: "t", title: "Bericht", at: "2026-10-13T08:00:00Z" }],
          milestones: [],
          notes_created: [],
          notes_edited: [],
        },
      ],
    });
    expect(stats).toMatchObject({ tasksDone: 3, milestonesDone: 1, notesCreated: null });
    expect(stats?.activity?.[0]?.done[0]?.title).toBe("Bericht");
    expect(parseStats({ tasks_done: { total: 1 } })?.activity).toBeNull();
    expect(parseStats(null)).toBeNull();
  });

  it("Kurzfassung eines Tages", () => {
    expect(
      daySummary({
        date: "2026-10-13",
        done: [
          { id: "1", title: "a", at: "" },
          { id: "2", title: "b", at: "" },
        ],
        milestones: [{ id: "m", title: "m", at: "" }],
        notes_created: [{ id: "n", title: "n", at: "" }],
        notes_edited: [{ id: "o", title: "o", at: "" }],
      }),
    ).toBe("2 erledigt · 1 Meilenstein · 2 Notizen");
  });
});

describe("Verlauf mit Lücken", () => {
  it("alle Wochen von der ältesten bis zur laufenden, neueste zuerst", () => {
    const slots = recapWeeks(
      [recap("a", "2026-09-28"), recap("b", "2026-10-05", { deleted_at: "2026-10-06T00:00:00Z" })],
      "2026-10-16",
    );
    expect(slots.map((s) => [s.start, s.week, s.recap?.id ?? null, s.current])).toEqual([
      ["2026-10-12", 42, null, true],
      ["2026-10-05", 41, null, false],
      ["2026-09-28", 40, "a", false],
    ]);
    expect(gapCount(slots, "2026-10-16")).toBe(1);
  });

  it("fasst drei und mehr Lücken hintereinander zusammen", () => {
    const slots = recapWeeks(
      [recap("a", "2026-08-31"), recap("b", "2026-09-28")],
      "2026-10-16",
    ).filter((s) => !s.current);
    expect(
      historyRows(slots).map((row) =>
        row.kind === "gaps" ? `Lücke ${row.slots.length}` : row.slot.recap ? "R" : "L",
      ),
    ).toEqual(["L", "R", "Lücke 3", "R"]);
  });

  it("ohne Rückblicke nur die laufende Woche", () => {
    expect(recapWeeks([], "2026-10-16").map((s) => s.start)).toEqual(["2026-10-12"]);
  });

  it("Titel mit Kalenderwoche", () => {
    expect(recapTitle({ kind: "woche", period_start: "2026-10-12" })).toBe("Wochenrückblick KW 42");
  });
});

describe("Tagesverlauf (live)", () => {
  it("erledigt, Meilensteine, neue und bearbeitete Notizen eines Tages im Bereich", () => {
    const day = dayActivity({
      day: "2026-10-16",
      area: "fw",
      tasks: [
        task("spät", { area_id: "fw", status: "erledigt", completed_at: "2026-10-16T15:00:00Z" }),
        task("früh", { area_id: "fw", status: "erledigt", completed_at: "2026-10-16T06:00:00Z" }),
        task("privat", { area_id: "p", status: "erledigt", completed_at: "2026-10-16T07:00:00Z" }),
        // 23:30 Ortszeit am Vortag
        task("gestern", {
          area_id: "fw",
          status: "erledigt",
          completed_at: "2026-10-15T21:30:00Z",
        }),
      ],
      milestones: [
        {
          id: "m",
          project_id: "proj",
          title: "Plan steht",
          due_date: null,
          done_at: "2026-10-16T09:00:00Z",
          sort: "a0",
          created_at: "",
          updated_at: "",
          deleted_at: null,
        },
      ],
      projects: [{ id: "proj", area_id: "fw" } as never],
      notes: [
        {
          id: "neu",
          title: "Neu",
          area_id: "fw",
          created_at: "2026-10-16T08:00:00Z",
          edited_at: "2026-10-16T10:00:00Z",
        },
        {
          id: "alt",
          title: "Alt",
          area_id: "fw",
          created_at: "2026-09-01T08:00:00Z",
          edited_at: "2026-10-16T11:00:00Z",
        },
      ],
    });
    expect(day.done.map((e) => e.title)).toEqual(["früh", "spät"]);
    expect(day.milestones.map((e) => e.title)).toEqual(["Plan steht"]);
    expect(day.notes_created.map((e) => e.title)).toEqual(["Neu"]);
    expect(day.notes_edited.map((e) => e.title)).toEqual(["Alt"]);
  });
});

describe("An diesem Tag", () => {
  it("findet, was vor 1, 3 und 12 Monaten im selben Zeitraum entstand", () => {
    const groups = onThisDay(
      { start: "2026-10-12", end: "2026-10-18" },
      {
        notes: [
          { id: "n1", title: "Vor einem Monat", created_at: "2026-09-14T10:00:00Z" },
          { id: "n2", title: "Zu früh", created_at: "2026-09-10T10:00:00Z" },
          { id: "n3", title: "Vor einem Jahr", created_at: "2025-10-18T10:00:00Z" },
        ],
        projects: [{ id: "p", title: "Projekt", created_at: "2026-07-13T10:00:00Z" }],
        recaps: [recap("r", "2026-07-13", { period_end: "2026-07-19" })],
        tasks: [task("t", { status: "erledigt", completed_at: "2026-09-15T10:00:00Z" })],
      },
    );
    expect(groups.map((g) => [g.months, g.start, g.end])).toEqual([
      [1, "2026-09-12", "2026-09-18"],
      [3, "2026-07-12", "2026-07-18"],
      [12, "2025-10-12", "2025-10-18"],
    ]);
    expect(groups[0]?.notes.map((n) => n.title)).toEqual(["Vor einem Monat"]);
    expect(groups[0]?.tasksDone).toBe(1);
    expect(groups[1]?.projects.map((p) => p.title)).toEqual(["Projekt"]);
    expect(groups[1]?.recaps.map((r) => r.id)).toEqual(["r"]);
    expect(groups[2]?.notes.map((n) => n.title)).toEqual(["Vor einem Jahr"]);
  });

  it("ohne Treffer nichts; der eigene Eintrag zählt nicht", () => {
    expect(
      onThisDay(
        { start: "2026-10-16", end: "2026-10-16" },
        { notes: [{ id: "self", title: "x", created_at: "2026-09-16T10:00:00Z" }] },
        "self",
      ),
    ).toEqual([]);
  });
});

describe("Monatsrückblick (S1a)", () => {
  const month = (id: string, start: string, extra: Record<string, unknown> = {}) =>
    toRecap({ id, kind: "monat", period_start: start, period_end: start, ...extra });

  it("Titel, Kurzform und Adresse des Zeitraums", () => {
    const oct = month("m", "2026-10-01");
    expect(recapTitle(oct)).toBe("Monatsrückblick 10/2026");
    expect(recapLabel(oct)).toBe("Oktober 2026");
    expect(recapLabel(recap("w", "2026-10-12"))).toBe("KW 42");
    expect(periodSlug("monat", "2026-10-01")).toBe("monat-2026-10");
    expect(periodSlug("woche", "2026-10-14")).toBe("woche-2026-10-12");
    expect(parsePeriodSlug("monat-2026-02")).toEqual({
      kind: "monat",
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(parsePeriodSlug("woche-2026-10-14")).toEqual({
      kind: "woche",
      start: "2026-10-12",
      end: "2026-10-18",
    });
    expect(parsePeriodSlug("monat-2026-13")).toBeNull();
    expect(parsePeriodSlug("3f1c0b9e-0000-4000-8000-000000000000")).toBeNull();
  });

  it("Leitfragen: Fokus gilt dem nächsten Monat, eigene Texte bleiben", () => {
    const labels = monthQuestions(DEFAULT_QUESTIONS).map((x) => x.label);
    expect(labels).toContain("Fokus nächster Monat (3 Punkte)");
    expect(labels).not.toContain("Fokus nächste Woche (3 Punkte)");
    expect(
      monthQuestions([{ key: "focus_next", label: "Drei Ziele", type: "list", count: 3 }])[0]
        ?.label,
    ).toBe("Drei Ziele");
    // ohne Schnappschuss: die eingebauten, im Monat angepasst
    expect(questionsOf(month("m", "2026-10-01")).find((q) => q.key === "focus_next")?.label).toBe(
      "Fokus nächster Monat (3 Punkte)",
    );
    expect(questionsOf(recap("w", "2026-10-12")).find((q) => q.key === "focus_next")?.label).toBe(
      "Fokus nächste Woche (3 Punkte)",
    );
  });

  it("Monate mit Lücken: ab dem ältesten Rückblick (auch Wochen), laufender oben", () => {
    const slots = recapMonths(
      [recap("w", "2026-07-27"), month("aug", "2026-08-01", { created_at: "2026-09-01T10:00Z" })],
      "2026-10-18",
    );
    // KW 31 (27.07.–02.08.) zählt zum Juli (Donnerstag 30.07.)
    expect(slots.map((s) => s.start)).toEqual([
      "2026-10-01",
      "2026-09-01",
      "2026-08-01",
      "2026-07-01",
    ]);
    expect(slots[0]?.current).toBe(true);
    expect(slots[0]?.label).toBe("Oktober 2026");
    expect(slots[2]?.recap?.id).toBe("aug");
    expect(gapCount(slots, "2026-10-18")).toBe(2);
    expect(monthOfWeek("2026-09-28")).toBe("2026-10-01");
  });

  it("dran ist in der ersten Monatswoche noch der vorige Monat, solange er offen ist", () => {
    const open = recapMonths([month("sep", "2026-09-01")], "2026-10-03");
    expect(dueMonth(open, "2026-10-03")?.start).toBe("2026-09-01");
    expect(dueMonth(open, "2026-10-08")?.start).toBe("2026-10-01");
    const closed = recapMonths(
      [month("sep", "2026-09-01", { closed_at: "2026-10-01T08:00:00Z" })],
      "2026-10-03",
    );
    expect(dueMonth(closed, "2026-10-03")?.start).toBe("2026-10-01");
  });

  it("Wochen des Monats: jede Woche genau einem Monat (Donnerstag), mit ihrem Rückblick", () => {
    const weeks = monthWeeks("2026-10-01", [recap("kw41", "2026-10-05"), recap("x", "2026-11-02")]);
    expect(weeks.map((w) => w.start)).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ]);
    expect(weeks.map((w) => w.recap?.id ?? null)).toEqual([null, "kw41", null, null, null]);
    // November 2026 beginnt mit KW 45 (02.11.), die Woche ab 26.10. gehört zum Oktober
    expect(monthWeeks("2026-11-01", [])[0]?.start).toBe("2026-11-02");
  });

  it("Werte über Wochen: Skalen als Durchschnitt, Sport als Summe; Themen nach Häufigkeit", () => {
    const list = [
      recap("a", "2026-10-05", { mood: 3, sport: 2, themes: ["schlaf", "dienst"] }),
      recap("b", "2026-10-12", { mood: 4, sport: 1.5, themes: ["schlaf"] }),
      recap("c", "2026-10-19", { themes: ["schlaf", "dienst", "familie"] }),
    ];
    expect(aggregateValue(list, "mood")).toBe(3.5);
    expect(aggregateValue(list, "sport")).toBe(3.5);
    expect(aggregateValue(list, "energy")).toBeNull();
    expect(formatValue(3.5)).toBe("3,5");
    expect(formatValue(4)).toBe("4");
    expect(themeCounts(list)).toEqual([
      { theme: "schlaf", count: 3 },
      { theme: "dienst", count: 2 },
      { theme: "familie", count: 1 },
    ]);
  });

  it("Aktivität je Woche nur aus den Tagen des Monats", () => {
    const day = (date: string, done: number) => ({
      date,
      done: Array.from({ length: done }, (_, i) => ({ id: `${date}-${i}`, title: "", at: "" })),
      milestones: [],
      notes_created: [],
      notes_edited: [],
    });
    const days = [day("2026-10-01", 2), day("2026-10-04", 1), day("2026-10-05", 4)];
    expect(weekActivity(days, { start: "2026-09-28", end: "2026-10-04" }).done).toBe(3);
    expect(weekActivity(null, { start: "2026-09-28", end: "2026-10-04" }).done).toBe(0);
  });
});

describe("Verlauf (S1b)", () => {
  const month = (id: string, start: string, extra: Record<string, unknown> = {}) =>
    toRecap({ id, kind: "monat", period_start: start, period_end: start, ...extra });

  it("die letzten zwölf Wochen bis heute, älteste zuerst, mit Lücken", () => {
    const periods = historyPeriods(
      [recap("a", "2026-10-05", { mood: 4 }), recap("b", "2026-08-03")],
      { kind: "woche", year: null },
      "2026-10-18",
    );
    expect(periods).toHaveLength(12);
    expect(periods[0]?.start).toBe("2026-07-27");
    expect(periods.at(-1)?.start).toBe("2026-10-12");
    expect(periods.at(-1)?.current).toBe(true);
    expect(periods.at(-2)?.recap?.id).toBe("a");
    expect(periods.at(-2)?.short).toBe("41");
    expect(periods.at(-2)?.title).toBe("KW 41 · 05.–11.10.2026");
    // ab dem ersten Rückblick (KW 32): 10 Wochen, 2 mit Rückblick, die laufende ist keine Lücke
    expect(periods[0]?.beforeFirst).toBe(true);
    expect(periods[1]?.beforeFirst).toBe(false);
    expect(historyGaps(periods, "2026-10-18")).toBe(8);
  });

  it("ein ganzes Jahr: Wochen nach ISO-Jahr, im laufenden Jahr bis heute", () => {
    const y2026 = historyPeriods([], { kind: "woche", year: 2026 }, "2026-10-18");
    expect(y2026[0]?.start).toBe("2025-12-29");
    expect(y2026.at(-1)?.start).toBe("2026-10-12");
    expect(historyPeriods([], { kind: "woche", year: 2020 }, "2026-10-18")).toHaveLength(53);
    const months = historyPeriods(
      [month("m", "2026-03-01", { energy: 2 })],
      { kind: "monat", year: 2026 },
      "2026-10-18",
    );
    expect(months.map((p) => p.short)).toEqual([
      "Jan",
      "Feb",
      "Mär",
      "Apr",
      "Mai",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Okt",
    ]);
    expect(months[2]?.recap?.id).toBe("m");
    expect(months[2]?.title).toBe("März 2026");
    expect(historyPeriods([], { kind: "monat", year: null }, "2026-10-18")[0]?.start).toBe(
      "2025-11-01",
    );
  });

  it("Jahre zur Auswahl: mit Rückblicken dieser Art und das laufende", () => {
    const list = [recap("a", "2025-12-29"), month("m", "2024-05-01"), recap("b", "2025-06-02")];
    expect(historyYears(list, "woche", "2026-10-18")).toEqual([2026, 2025]);
    expect(historyYears(list, "monat", "2026-10-18")).toEqual([2026, 2024]);
    expect(recapYear(list[0] as ReturnType<typeof recap>)).toBe(2026);
  });
});

describe("Gesprächsfelder (#66)", () => {
  const keys = ["conversation", "hypothesis", "counter_hypothesis", "plain_talk", "last_week"];

  it("eingebaute Leitfragen enthalten den Abschnitt „Gespräch“ mit festen Schlüsseln, Art Text", () => {
    const section = DEFAULT_QUESTIONS.filter((q) => q.section === "Gespräch");
    expect(section.map((q) => q.key)).toEqual(keys);
    expect(section.map((q) => q.label)).toEqual([
      "Gespräch",
      "Hypothese",
      "Gegenhypothese",
      "Klartext",
      "Bezug zur Vorwoche",
    ]);
    expect(section.every((q) => q.type === "text")).toBe(true);
  });

  it("parseQuestions behält den Abschnitt; Leerzeichen und Nicht-Text fallen weg", () => {
    const parsed = parseQuestions([
      { key: "a", label: "A", type: "text", section: " Gespräch " },
      { key: "b", label: "B", type: "text", section: 5 },
    ]);
    expect(parsed).toEqual([
      { key: "a", label: "A", type: "text", section: "Gespräch" },
      { key: "b", label: "B", type: "text" },
    ]);
  });

  it("additiv ergänzen: nur fehlende Schlüssel, eigene Fragen und Beschriftungen bleiben", () => {
    const mine: RecapQuestion[] = [
      { key: "good", label: "Mein Gutes", type: "text" },
      { key: "hypothesis", label: "Meine Hypothese", type: "text" },
    ];
    const merged = withConversationFields(mine);
    expect(merged.map((q) => q.key)).toEqual([
      "good",
      "hypothesis",
      "conversation",
      "counter_hypothesis",
      "plain_talk",
      "last_week",
    ]);
    expect(merged[1]?.label).toBe("Meine Hypothese");
    // wiederholbar: nichts doppelt
    expect(withConversationFields(merged)).toBe(merged);
    expect(withConversationFields([...CONVERSATION_QUESTIONS])).toHaveLength(5);
  });

  it("groupBySection fasst aufeinanderfolgende Fragen desselben Abschnitts zusammen", () => {
    const groups = groupBySection(DEFAULT_QUESTIONS);
    expect(groups.map((g) => g.section)).toEqual([null, "Gespräch"]);
    expect(groups[1]?.questions).toHaveLength(5);
    expect(groupBySection([])).toEqual([]);
  });

  it("Monat: „Bezug zum Vormonat“", () => {
    const month = monthQuestions(DEFAULT_QUESTIONS);
    expect(month.find((q) => q.key === "last_week")?.label).toBe("Bezug zum Vormonat");
    expect(month.find((q) => q.key === "last_week")?.section).toBe("Gespräch");
  });

  it("Antworten liegen in answers, abgeschlossene Rückblicke ohne die Felder bleiben lesbar", () => {
    const r = recap("r1", "2026-10-12", {
      answers: { hypothesis: "H" },
      questions: [{ key: "good", label: "Gut", type: "text" }],
    });
    expect(questionsOf(r).map((q) => q.key)).toEqual(["good"]);
    const q = DEFAULT_QUESTIONS.find((x) => x.key === "hypothesis") as RecapQuestion;
    expect(answerOf(r, q)).toBe("H");
    expect(answerPatch(r, q, "H2")).toEqual({ answers: { hypothesis: "H2" } });
  });

  it("Vorwoche: findet die Woche davor, ohne Papierkorb; Fokus und Mitnehmen zum Nachlesen", () => {
    const prev = recap("p", "2026-10-12", {
      focus_next: ["A", " ", "B"],
      answers: { takeaway: " Ruhe " },
    });
    const trashed = recap("t", "2026-10-12", { deleted_at: "2026-10-15T00:00:00Z" });
    const now = recap("n", "2026-10-19");
    expect(previousRecap([trashed, now], now)).toBeNull();
    expect(previousRecap([prev, now], now)?.id).toBe("p");
    expect(previousHints(prev)).toEqual({ focus: ["A", "B"], takeaway: "Ruhe" });
    expect(previousHints(recap("leer", "2026-10-05"))).toBeNull();
    expect(previousHints(null)).toBeNull();
    const month = toRecap({
      id: "m",
      kind: "monat",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
    });
    const septMonth = toRecap({
      id: "s",
      kind: "monat",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
    });
    expect(previousRecap([septMonth, month], month)?.id).toBe("s");
  });
});
