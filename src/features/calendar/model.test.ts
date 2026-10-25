import { describe, expect, it } from "vitest";
import type { MilestoneRow, ProjectRow } from "@/features/projects/types";
import { task } from "@/features/tasks/fixtures";
import { berlinDateTime } from "@/lib/dates";
import { easterSunday, holidayOn, holidaysBW } from "./holidays";
import {
  formatMinutes,
  freeWindows,
  minutesToTime,
  placeEntries,
  snapMinutes,
  visibleHours,
  weekTaskLimit,
} from "./layout";
import {
  buildCalendarDays,
  type CalendarInput,
  calendarSummary,
  DEFAULT_FILTERS,
  dominantMonth,
  endOfMonth,
  eventsWanted,
  extendMonthWindow,
  inMonthWindow,
  itemTitle,
  MONTH_WINDOW,
  monthOf,
  monthsOfRange,
  monthWindowAround,
  monthWindowRange,
  parseDateParam,
  periodMeta,
  periodTitle,
  placeTask,
  stepDate,
  viewRange,
} from "./model";
import type { CalendarEvent } from "./types";

const TODAY = "2026-10-21"; // Mittwoch, KW 43
const WEEK = { start: "2026-10-19", end: "2026-10-25" };

const project = (id: string, extra: Partial<ProjectRow> = {}): ProjectRow => ({
  id,
  area_id: "a",
  title: id,
  status: "aktiv",
  priority: null,
  start_date: null,
  target_date: null,
  why: "",
  outcome: [],
  links: [],
  body: null,
  body_text: "",
  next_task_id: null,
  last_activity_at: "2026-10-01T00:00:00Z",
  closing_reflection: null,
  sort: "a0",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  deleted_at: null,
  ...extra,
});

const milestone = (id: string, extra: Partial<MilestoneRow> = {}): MilestoneRow => ({
  id,
  project_id: "p1",
  title: id,
  due_date: null,
  done_at: null,
  sort: "a0",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  deleted_at: null,
  ...extra,
});

const event = (
  id: string,
  date: string,
  from: number | null,
  to: number | null,
): CalendarEvent => ({
  id,
  sourceId: "q",
  sourceName: "Beruf",
  color: "orange",
  uid: id,
  title: id,
  location: null,
  description: null,
  allDay: from === null,
  start: from === null ? `${date}T00:00:00Z` : berlinDateTime(date, minutesToTime(from)),
  end: to === null ? `${date}T00:00:00Z` : berlinDateTime(date, minutesToTime(Math.min(to, 1439))),
  date,
  endDate: date,
  startMinutes: from,
  endMinutes: to,
  busy: true,
  recurring: false,
  link: null,
});

const input = (extra: Partial<CalendarInput> = {}): CalendarInput => ({
  range: WEEK,
  today: TODAY,
  events: [],
  tasks: [],
  projects: [],
  milestones: [],
  recaps: [],
  area: null,
  filters: DEFAULT_FILTERS,
  ...extra,
});

const dayOf = (result: ReturnType<typeof buildCalendarDays>, date: string) =>
  result.days.find((d) => d.date === date) as NonNullable<
    ReturnType<typeof buildCalendarDays>["days"][number]
  >;

describe("Termine laden (K-2)", () => {
  it("K-2: Termine werden erst geladen, wenn der heutige Tag bekannt ist (kein Abruf um 2000-01-01)", () => {
    const filters = DEFAULT_FILTERS;
    expect(eventsWanted({ today: "", hasSources: true, filters })).toBe(false);
    expect(eventsWanted({ today: TODAY, hasSources: true, filters })).toBe(true);
    expect(eventsWanted({ today: TODAY, hasSources: false, filters })).toBe(false);
    expect(
      eventsWanted({ today: TODAY, hasSources: true, filters: { ...filters, events: false } }),
    ).toBe(false);
  });
});

describe("Feiertage Baden-Württemberg", () => {
  it("Ostern und die beweglichen Feiertage 2026", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    const names = Object.fromEntries(holidaysBW(2026).map((h) => [h.name, h.date]));
    expect(names).toMatchObject({
      Karfreitag: "2026-04-03",
      Ostermontag: "2026-04-06",
      "Christi Himmelfahrt": "2026-05-14",
      Pfingstmontag: "2026-05-25",
      Fronleichnam: "2026-06-04",
      "Heilige Drei Könige": "2026-01-06",
      Allerheiligen: "2026-11-01",
    });
    expect(holidaysBW(2026)).toHaveLength(12);
  });

  it("holidayOn: Feiertag oder null", () => {
    expect(holidayOn("2026-10-03")).toBe("Tag der Deutschen Einheit");
    expect(holidayOn("2026-10-21")).toBeNull();
    expect(holidayOn("2026-12-26")).toBe("2. Weihnachtstag");
  });
});

describe("Aufgaben im Kalender: ein Eintrag, nie zwei", () => {
  it("Tag = geplant › Fokus › fällig; ohne Datum nicht im Kalender", () => {
    expect(placeTask(task("ohne"), TODAY)).toBeNull();
    expect(placeTask(task("f", { due_date: "2026-10-23" }), TODAY)?.date).toBe("2026-10-23");
    const focus = placeTask(
      task("fo", { due_date: "2026-10-23", focus_date: "2026-10-22" }),
      TODAY,
    );
    expect(focus?.date).toBe("2026-10-22");
    expect(focus?.focus).toBe(true);
    expect(focus?.dueElsewhere).toBe("2026-10-23");
    const planned = placeTask(
      task("g", {
        due_date: "2026-10-23",
        scheduled_at: berlinDateTime("2026-10-24", "09:30"),
        duration_min: 45,
      }),
      TODAY,
    );
    expect(planned).toMatchObject({ date: "2026-10-24", time: 570, duration: 45 });
    // ohne Dauer: Standardblock
    expect(
      placeTask(task("h", { scheduled_at: berlinDateTime("2026-10-24", "14:00") }), TODAY)
        ?.duration,
    ).toBe(60);
  });

  it("Offenes aus der Vergangenheit steht heute mit „überfällig seit“; Erledigtes bleibt an seinem Tag", () => {
    const overdue = placeTask(task("alt", { due_date: "2026-10-14" }), TODAY);
    expect(overdue).toMatchObject({ date: TODAY, overdueSince: "2026-10-14", time: null });
    const missed = placeTask(
      task("verpasst", { scheduled_at: berlinDateTime("2026-10-19", "10:00") }),
      TODAY,
    );
    expect(missed).toMatchObject({ date: TODAY, overdueSince: "2026-10-19", time: null });
    const done = placeTask(
      task("fertig", {
        due_date: "2026-10-14",
        status: "erledigt",
        completed_at: "2026-10-14T10:00:00Z",
      }),
      TODAY,
    );
    expect(done).toMatchObject({ date: "2026-10-14", overdueSince: null, done: true });
  });
});

describe("buildCalendarDays: feste Ordnung je Tag, Fristen, Wiederholungen, Rückblick-Tage", () => {
  it("ganztägig + Fristen oben, Termine nach Uhrzeit, Aufgaben darunter (überfällig zuerst)", () => {
    const result = buildCalendarDays(
      input({
        events: [
          event("Übung", TODAY, 19 * 60, 21 * 60 + 30),
          event("Herbstfest", TODAY, null, null),
        ],
        tasks: [
          task("Später", { due_date: TODAY, priority: 3 }),
          task("Wichtig", { due_date: TODAY, priority: 1 }),
          task("Alt", { due_date: "2026-10-12" }),
          task("Fokus", { due_date: TODAY, focus_date: TODAY }),
          task("Block", { scheduled_at: berlinDateTime(TODAY, "09:00"), duration_min: 90 }),
          task("Fertig", { due_date: TODAY, status: "erledigt" }),
        ],
        projects: [project("p1", { title: "Werkstatt", target_date: TODAY })],
        milestones: [milestone("m1", { title: "Rohbau", due_date: TODAY })],
      }),
    );
    const day = dayOf(result, TODAY);
    expect(day.allDay.map(itemTitle)).toEqual(["Herbstfest", "Ziel: Werkstatt", "Rohbau"]);
    expect(
      day.timed.map((e) => `${minutesToTime(e.from)}–${minutesToTime(e.to)} ${itemTitle(e.item)}`),
    ).toEqual(["09:00–10:30 Block", "19:00–21:30 Übung"]);
    expect(day.tasks.map(itemTitle)).toEqual(["Alt", "Fokus", "Wichtig", "Später", "Fertig"]);
    expect(day.isToday).toBe(true);
    expect(result.hiddenByArea).toBe(0);
  });

  it("Tageslast: belegte Termin-Minuten + Aufgaben; Frist an einem vollen Tag", () => {
    const result = buildCalendarDays(
      input({
        events: [
          event("A", "2026-10-22", 9 * 60, 12 * 60),
          event("B", "2026-10-22", 11 * 60, 13 * 60), // überlappt A: zählt einmal
          event("C", "2026-10-22", 14 * 60, 17 * 60),
        ],
        tasks: [
          task("T1", { due_date: "2026-10-22" }),
          task("T2", { due_date: "2026-10-22", duration_min: 120 }),
        ],
        projects: [project("p1", { target_date: "2026-10-22" })],
      }),
    );
    const day = dayOf(result, "2026-10-22");
    expect(day.load).toEqual({
      busyMinutes: 7 * 60,
      taskMinutes: 150,
      openTasks: 2,
      level: "ueberladen",
    });
    expect(day.deadlineOnFullDay).toBe(true);
    expect(dayOf(result, "2026-10-23").load.level).toBe("frei");
    // 8 offene Aufgaben = überladen, auch ohne Termine
    const many = buildCalendarDays(
      input({
        tasks: Array.from({ length: 8 }, (_, i) => task(`A${i}`, { due_date: "2026-10-23" })),
      }),
    );
    expect(dayOf(many, "2026-10-23").load.level).toBe("ueberladen");
    const some = buildCalendarDays(input({ events: [event("A", "2026-10-23", 8 * 60, 14 * 60)] }));
    expect(dayOf(some, "2026-10-23").load.level).toBe("voll");
  });

  it("wiederkehrende Aufgabe: echte Instanz am Fälligkeitstag, danach blass vorausberechnet", () => {
    const result = buildCalendarDays(
      input({
        tasks: [task("Müll", { due_date: "2026-10-22", recurrence: "FREQ=WEEKLY;BYDAY=TH" })],
      }),
    );
    expect(dayOf(result, "2026-10-22").tasks.map((i) => i.kind)).toEqual(["task"]);
    expect(dayOf(result, "2026-10-15")).toBeUndefined();
    const next = buildCalendarDays(
      input({
        range: { start: "2026-10-26", end: "2026-11-08" },
        tasks: [task("Müll", { due_date: "2026-10-22", recurrence: "FREQ=WEEKLY;BYDAY=TH" })],
      }),
    );
    expect(
      next.days.filter((d) => d.tasks.length).map((d) => `${d.date} ${d.tasks[0]?.kind}`),
    ).toEqual(["2026-10-29 preview", "2026-11-05 preview"]);
    // überfällig: die echte Aufgabe steht heute, Vorschau erst nach der Fälligkeit
    const overdue = buildCalendarDays(
      input({
        tasks: [task("Müll", { due_date: "2026-10-13", recurrence: "FREQ=WEEKLY;BYDAY=TU" })],
      }),
    );
    expect(dayOf(overdue, TODAY).tasks[0]).toMatchObject({
      kind: "task",
      overdueSince: "2026-10-13",
    });
    expect(dayOf(overdue, "2026-10-20").tasks[0]?.kind).toBe("preview");
  });

  it("Rückblick-Tage: Sonntag Wochenrückblick (mit vorhandenem Rückblick), Monatsletzter Monatsrückblick", () => {
    const result = buildCalendarDays(
      input({
        range: { start: "2026-10-26", end: "2026-11-01" },
        recaps: [
          {
            id: "r1",
            kind: "woche",
            period_start: "2026-10-26",
            period_end: "2026-11-01",
            mood: null,
            energy: null,
            sport: null,
            relations: null,
            learning: null,
            answers: {},
            focus_next: [],
            themes: [],
            questions: [],
            stats: null,
            review: { step: 0, projects: [], started_at: null, finished_at: null },
            closed_at: null,
            created_at: "",
            updated_at: "",
            deleted_at: null,
          },
        ],
      }),
    );
    expect(dayOf(result, "2026-10-31").allDay.map(itemTitle)).toEqual(["Monatsrückblick"]);
    const sunday = dayOf(result, "2026-11-01");
    expect(sunday.holiday).toBe("Allerheiligen");
    expect(sunday.allDay).toHaveLength(1);
    expect(sunday.allDay[0]).toMatchObject({
      kind: "recap",
      recapKind: "woche",
      recap: { id: "r1" },
    });
    // Datenbank-Ansicht (S2c): ohne Rückblick-Tage
    const plain = buildCalendarDays(
      input({ range: { start: "2026-10-26", end: "2026-11-01" }, recapDays: false }),
    );
    expect(dayOf(plain, "2026-10-31").allDay).toEqual([]);
    expect(dayOf(plain, "2026-11-01").allDay).toEqual([]);
  });

  it("Bereich und Filter: ausgeblendete Aufgaben werden gezählt, Termine bleiben", () => {
    const result = buildCalendarDays(
      input({
        area: "a",
        events: [event("E", TODAY, 10 * 60, 11 * 60)],
        tasks: [
          task("mein", { due_date: TODAY }),
          task("fremd", { area_id: "b", due_date: TODAY }),
          task("inbox", { area_id: null, in_inbox: true, due_date: TODAY }),
          task("fertig", { due_date: TODAY, status: "erledigt" }),
        ],
        projects: [project("p1", { area_id: "b", target_date: TODAY })],
      }),
    );
    expect(result.hiddenByArea).toBe(2);
    expect(result.hiddenDates).toEqual([TODAY, TODAY]);
    expect(dayOf(result, TODAY).tasks.map(itemTitle)).toEqual(["mein", "fertig"]);
    expect(dayOf(result, TODAY).allDay).toEqual([]);
    const filtered = buildCalendarDays(
      input({
        events: [event("E", TODAY, 10 * 60, 11 * 60)],
        tasks: [task("a", { due_date: TODAY }), task("b", { due_date: TODAY, status: "erledigt" })],
        filters: { events: false, tasks: true, done: false, projectId: null },
      }),
    );
    expect(dayOf(filtered, TODAY).timed).toEqual([]);
    expect(dayOf(filtered, TODAY).tasks.map(itemTitle)).toEqual(["a"]);
    const byProject = buildCalendarDays(
      input({
        tasks: [
          task("im", { project_id: "p1", due_date: TODAY }),
          task("drau", { due_date: TODAY }),
        ],
        projects: [project("p1"), project("p2", { target_date: TODAY })],
        filters: { ...DEFAULT_FILTERS, projectId: "p1" },
      }),
    );
    expect(dayOf(byProject, TODAY).tasks.map(itemTitle)).toEqual(["im"]);
    expect(dayOf(byProject, TODAY).allDay).toEqual([]);
    // Projektfilter: keine Rückblick-Tage
    expect(dayOf(byProject, "2026-10-25").allDay).toEqual([]);
  });

  it("Zusammenfassung: Termine, offene Aufgaben, überfällig, vollster Tag", () => {
    const result = buildCalendarDays(
      input({
        events: [
          event("A", "2026-10-22", 8 * 60, 15 * 60),
          event("B", "2026-10-23", 9 * 60, 10 * 60),
        ],
        tasks: [task("alt", { due_date: "2026-10-01" }), task("neu", { due_date: "2026-10-24" })],
      }),
    );
    const summary = calendarSummary(result.days, WEEK);
    expect(summary).toMatchObject({ events: 2, tasks: 2, overdue: 1 });
    expect(summary.fullest?.date).toBe("2026-10-22");
  });
});

describe("Zeiträume und Tasten", () => {
  it("viewRange und stepDate je Ansicht", () => {
    expect(viewRange("tag", TODAY)).toEqual({ start: TODAY, end: TODAY });
    expect(viewRange("woche", TODAY)).toEqual(WEEK);
    expect(viewRange("monat", TODAY)).toEqual({ start: "2026-09-28", end: "2026-11-01" });
    expect(viewRange("liste", TODAY)).toEqual({ start: TODAY, end: "2026-11-03" });
    expect(stepDate("woche", TODAY, 1)).toBe("2026-10-28");
    expect(stepDate("monat", "2026-10-31", 1)).toBe("2026-11-01");
    expect(stepDate("monat", "2026-01-15", -1)).toBe("2025-12-01");
    expect(stepDate("tag", TODAY, -1)).toBe("2026-10-20");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });
});

describe("Tagesraster: Spalten, freie Fenster, Stunden", () => {
  it("überlappende Einträge nebeneinander, getrennte Gruppen in voller Breite", () => {
    const placed = placeEntries([
      { id: "a", from: 540, to: 660 },
      { id: "b", from: 600, to: 720 },
      { id: "c", from: 660, to: 700 },
      { id: "d", from: 900, to: 960 },
    ]);
    expect(placed.map((p) => `${p.entry.id}:${p.column}/${p.columns}`)).toEqual([
      "a:0/2",
      "b:1/2",
      "c:0/2",
      "d:0/1",
    ]);
    // Dauer 0 belegt sichtbar 30 Minuten
    const zero = placeEntries([
      { id: "x", from: 600, to: 600 },
      { id: "y", from: 615, to: 645 },
    ]);
    expect(zero.map((p) => p.columns)).toEqual([2, 2]);
  });

  it("freie Fenster ab 60 Minuten zwischen 8 und 18 Uhr", () => {
    expect(freeWindows([])).toEqual([{ from: 480, to: 1080 }]);
    expect(
      freeWindows([
        { from: 540, to: 600 },
        { from: 630, to: 720 },
        { from: 1020, to: 1140 },
      ]),
    ).toEqual([
      { from: 480, to: 540 },
      { from: 720, to: 1020 },
    ]);
  });

  it("sichtbare Stunden, Zeiten und Dauer formatieren, Raster", () => {
    expect(visibleHours([])).toEqual({ from: 7, to: 20 });
    expect(
      visibleHours([
        { from: 6 * 60 + 30, to: 7 * 60 },
        { from: 21 * 60, to: 22 * 60 + 15 },
      ]),
    ).toEqual({
      from: 6,
      to: 23,
    });
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(1440)).toBe("24:00");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(45)).toBe("45 min");
    expect(snapMinutes(583)).toBe(585);
    expect(snapMinutes(1439)).toBe(1425);
  });

  it("Aufgaben-Band der Woche wächst mit der Fensterhöhe, mindestens 3 (#97)", () => {
    expect(weekTaskLimit(600, 25)).toBe(3);
    expect(weekTaskLimit(800, 25)).toBe(3);
    expect(weekTaskLimit(874, 25)).toBe(3);
    expect(weekTaskLimit(875, 25)).toBe(4);
    expect(weekTaskLimit(1100, 25)).toBe(7);
    // größere Schrift = höhere Zeilen = weniger zusätzliche Aufgaben
    expect(weekTaskLimit(1100, 30)).toBe(6);
    expect(weekTaskLimit(1100, 0)).toBeGreaterThanOrEqual(3);
  });
});

describe("Adresse der Seite (K-3)", () => {
  it("K-3: ?tag= nimmt nur echte Kalendertage – 2026-13-45 passt zwar der Form nach, ist aber keins", () => {
    expect(parseDateParam("2026-10-21")).toBe("2026-10-21");
    expect(parseDateParam("2026-13-45")).toBeNull();
    expect(parseDateParam("2026-1-5")).toBeNull();
    expect(parseDateParam(null)).toBeNull();
    expect(parseDateParam("heute")).toBeNull();
  });
});

describe("#67: Monat groß in der Überschrift", () => {
  it("Monat und Tag: Monat und Jahr", () => {
    expect(periodTitle("monat", "2026-11-04")).toBe("November 2026");
    expect(periodTitle("tag", "2026-11-04")).toBe("November 2026");
  });
  it("Woche: ein Monat voll ausgeschrieben, zwei Monate kurz, Jahreswechsel mit beiden Jahren", () => {
    expect(periodTitle("woche", "2026-10-21")).toBe("Oktober 2026");
    expect(periodTitle("woche", "2026-10-28")).toBe("Okt – Nov 2026");
    expect(periodTitle("woche", "2026-12-30")).toBe("Dez 2026 – Jan 2027");
  });
  it("Kleine Zeile: „Kalender“, außer im Monat mit Zeitraum", () => {
    expect(periodMeta("monat", "2026-11-04")).toBe("Kalender");
    expect(periodMeta("woche", "2026-10-21")).toBe("Kalender · KW 43 · 19.–25.10.2026");
  });
});

describe("#85: Monat zum Durchscrollen", () => {
  it("Fenster um den Monat: drei davor, drei danach, ganze Wochen", () => {
    const window = monthWindowAround("2026-10-22");
    expect(window).toEqual({ first: "2026-07-01", last: "2027-01-01" });
    // 1.7.2026 ist ein Mittwoch, 31.1.2027 ein Sonntag
    expect(monthWindowRange(window)).toEqual({ start: "2026-06-29", end: "2027-01-31" });
    expect(inMonthWindow(window, "2026-07-31")).toBe(true);
    expect(inMonthWindow(window, "2027-01-15")).toBe(true);
    expect(inMonthWindow(window, "2027-02-01")).toBe(false);
    expect(inMonthWindow(window, "2026-06-30")).toBe(false);
    expect(monthOf("2026-03-31", -1)).toBe("2026-02-01");
  });

  it("Nachladen: drei Monate dazu, über 15 fällt das ferne Ende weg", () => {
    const window = monthWindowAround("2026-10-22");
    const down = extendMonthWindow(window, 1);
    expect(down).toEqual({ first: "2026-07-01", last: "2027-04-01" });
    const up = extendMonthWindow(window, -1);
    expect(up).toEqual({ first: "2026-04-01", last: "2027-01-01" });
    let far = window;
    for (let i = 0; i < 5; i++) far = extendMonthWindow(far, 1);
    // bis April 2028 verlängert → die letzten 15 Monate
    expect(far).toEqual({ first: "2027-02-01", last: "2028-04-01" });
    let back = far;
    for (let i = 0; i < 2; i++) back = extendMonthWindow(back, -1);
    expect(back).toEqual({ first: "2026-08-01", last: "2027-10-01" });
    expect(MONTH_WINDOW.max).toBe(15);
  });

  it("Termine monatsweise: jeder Monat, den der Zeitraum berührt", () => {
    expect(monthsOfRange({ start: "2026-06-29", end: "2026-08-02" })).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
    expect(monthsOfRange({ start: "2026-12-28", end: "2027-01-03" })).toEqual([
      "2026-12-01",
      "2027-01-01",
    ]);
  });

  it("Monat im Bild: die meisten sichtbaren Tage, Wochen anteilig", () => {
    // 26.10.–1.11.: sechs Oktober-, ein Novembertag
    expect(dominantMonth([{ start: "2026-10-26", visible: 1 }])).toBe("2026-10-01");
    expect(
      dominantMonth([
        { start: "2026-10-26", visible: 1 },
        { start: "2026-11-02", visible: 1 },
      ]),
    ).toBe("2026-11-01");
    // oben noch zwei Oktoberwochen ganz, die Novemberwoche nur halb
    expect(
      dominantMonth([
        { start: "2026-10-12", visible: 1 },
        { start: "2026-10-19", visible: 1 },
        { start: "2026-11-02", visible: 0.5 },
      ]),
    ).toBe("2026-10-01");
    expect(dominantMonth([])).toBeNull();
    expect(dominantMonth([{ start: "2026-10-26", visible: 0 }])).toBeNull();
  });
});
