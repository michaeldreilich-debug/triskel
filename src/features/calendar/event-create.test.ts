import { describe, expect, it } from "vitest";
import {
  dayDraft,
  defaultCalendar,
  draftIssue,
  draftTimes,
  type EventDraft,
  gridDraft,
  gridRange,
  isCut,
  lockedTexts,
  optimisticEvent,
  textChange,
  textChangeMessage,
  toCreateBody,
  toRestoreBody,
  writableCalendars,
} from "./event-create";
import type { CalendarEvent } from "./types";

const draft = (extra: Partial<EventDraft> = {}): EventDraft => ({
  title: "Zahnarzt",
  sourceId: "q1",
  date: "2026-12-09",
  time: "10:00",
  durationMin: 60,
  allDay: false,
  endDate: "2026-12-09",
  location: "",
  description: "",
  ...extra,
});

const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "q1:abc:2026-12-09T09:00:00.000Z",
  sourceId: "q1",
  sourceName: "Haupt",
  color: "blau",
  uid: "abc",
  title: "Zahnarzt",
  location: "Praxis",
  description: "Kärtchen mitnehmen",
  allDay: false,
  start: "2026-12-09T09:00:00.000Z",
  end: "2026-12-09T10:00:00.000Z",
  date: "2026-12-09",
  endDate: "2026-12-09",
  startMinutes: 600,
  endMinutes: 660,
  busy: true,
  recurring: false,
  link: null,
  google: {
    calendarId: "haupt@example.com",
    eventId: "abc",
    etag: '"1"',
    editable: true,
    recurringEventId: null,
    timeZone: "Europe/Berlin",
  },
  ...extra,
});

describe("Vorbelegung aus dem Zeitraster", () => {
  it("Klick: 1 h ab dem angeklickten Halbstundenfeld", () => {
    expect(gridRange(600, null)).toEqual({ start: 600, duration: 60 });
    expect(gridRange(615, null)).toEqual({ start: 600, duration: 60 }); // 10:15 → Feld 10:00
    expect(gridRange(630, null)).toEqual({ start: 630, duration: 60 });
    expect(gridRange(0, null)).toEqual({ start: 0, duration: 60 });
  });

  it("Ziehen: von Zeile zu Zeile im 15-min-Raster, die letzte Zeile zählt mit", () => {
    // 10:00 bis in die Zeile 11:30 → bis 11:45
    expect(gridRange(600, 690)).toEqual({ start: 600, duration: 105 });
    // gleiche Zeile: mindestens 15 min
    expect(gridRange(605, 610)).toEqual({ start: 600, duration: 15 });
  });

  it("Ziehen nach oben ergibt denselben Zeitraum wie nach unten", () => {
    expect(gridRange(690, 600)).toEqual(gridRange(600, 690));
  });

  it("spätester Beginn 23:45, nie über den Tag hinaus gerutscht", () => {
    expect(gridRange(1439, 1439)).toEqual({ start: 1425, duration: 15 });
    expect(gridRange(-30, null).start).toBe(0);
  });

  it("Entwurf aus dem Raster: Tag, Uhrzeit, Dauer, nicht ganztägig", () => {
    expect(gridDraft("q1", "2026-12-09", 600, 690)).toMatchObject({
      sourceId: "q1",
      date: "2026-12-09",
      endDate: "2026-12-09",
      time: "10:00",
      durationMin: 105,
      allDay: false,
      title: "",
    });
    expect(gridDraft("q1", "2026-12-09", 14 * 60 + 40, null)).toMatchObject({
      time: "14:30",
      durationMin: 60,
    });
  });
});

describe("Vorbelegung „＋ Termin“", () => {
  it("heute: nächste volle Stunde, spätestens 22 Uhr; anderer Tag: 9 Uhr", () => {
    expect(dayDraft("q1", "2026-12-09", "2026-12-09", 9 * 60 + 20).time).toBe("10:00");
    expect(dayDraft("q1", "2026-12-09", "2026-12-09", 23 * 60 + 10).time).toBe("22:00");
    expect(dayDraft("q1", "2026-12-10", "2026-12-09", 9 * 60 + 20).time).toBe("09:00");
    expect(dayDraft("q1", "2026-12-09", "2026-12-09", null).time).toBe("09:00");
    expect(dayDraft("q1", "2026-12-10", "2026-12-09", null)).toMatchObject({
      date: "2026-12-10",
      endDate: "2026-12-10",
      durationMin: 60,
    });
  });
});

describe("Entwurf → Zeiten und Eingabe", () => {
  it("mit Uhrzeit: Zeitpunkte als UTC (Winterzeit, Sommerzeit), Dauer in Minuten", () => {
    expect(draftTimes(draft())).toEqual({
      allDay: false,
      start: "2026-12-09T09:00:00.000Z",
      end: "2026-12-09T10:00:00.000Z",
    });
    expect(draftTimes(draft({ date: "2026-07-01", durationMin: 90 }))).toEqual({
      allDay: false,
      start: "2026-07-01T08:00:00.000Z",
      end: "2026-07-01T09:30:00.000Z",
    });
  });

  it("ganztägig: Tage, Ende exklusiv; ein Ende vor dem Beginn gilt als eintägig", () => {
    expect(draftTimes(draft({ allDay: true, endDate: "2026-12-11" }))).toEqual({
      allDay: true,
      start: "2026-12-09",
      end: "2026-12-12",
    });
    expect(draftTimes(draft({ allDay: true, endDate: "2026-12-01" }))).toEqual({
      allDay: true,
      start: "2026-12-09",
      end: "2026-12-10",
    });
  });

  it("Eingabe für die Route: getrimmte Texte, Zone nur mit Uhrzeit", () => {
    expect(
      toCreateBody(draft({ title: "  Zahnarzt ", location: " Praxis ", description: "Text" })),
    ).toEqual({
      sourceId: "q1",
      summary: "Zahnarzt",
      location: "Praxis",
      description: "Text",
      allDay: false,
      start: "2026-12-09T09:00:00.000Z",
      end: "2026-12-09T10:00:00.000Z",
      timeZone: "Europe/Berlin",
    });
    expect(toCreateBody(draft({ allDay: true }))).toMatchObject({
      allDay: true,
      start: "2026-12-09",
      end: "2026-12-10",
      timeZone: null,
    });
  });

  it("Prüfung: Titel, Länge, Kalender, Uhrzeit, ganztägiges Ende", () => {
    expect(draftIssue(draft())).toBeNull();
    expect(draftIssue(draft({ title: "   " }))).toBe("Bitte einen Titel eingeben.");
    expect(draftIssue(draft({ title: "x".repeat(300) }))).toBeNull();
    expect(draftIssue(draft({ title: "x".repeat(301) }))).toContain("zu lang");
    expect(draftIssue(draft({ location: "x".repeat(301) }))).toContain("Ort");
    expect(draftIssue(draft({ description: "x".repeat(8001) }))).toContain("Beschreibung");
    expect(draftIssue(draft({ sourceId: "" }))).toBe("Bitte einen Kalender wählen.");
    expect(draftIssue(draft({ time: "" }))).toBe("Bitte eine Uhrzeit angeben.");
    expect(draftIssue(draft({ allDay: true, time: "", endDate: "2026-12-08" }))).toBe(
      "Das Ende liegt vor dem Beginn.",
    );
    expect(draftIssue(draft({ allDay: true, time: "" }))).toBeNull();
  });

  it("sofortige Anzeige: Zeiten, Tage und Minuten stimmen, noch nicht änderbar", () => {
    const shown = optimisticEvent(
      draft({ location: "Praxis" }),
      { sourceId: "q1", name: "Haupt", color: "lila" },
      "neu-1",
    );
    expect(shown).toMatchObject({
      sourceId: "q1",
      color: "lila",
      title: "Zahnarzt",
      location: "Praxis",
      date: "2026-12-09",
      startMinutes: 600,
      endMinutes: 660,
      google: { editable: false, eventId: "neu-1" },
    });
    const day = optimisticEvent(
      draft({ allDay: true, endDate: "2026-12-10" }),
      { sourceId: "q1", name: "Haupt", color: "blau" },
      "neu-2",
    );
    expect(day).toMatchObject({ allDay: true, date: "2026-12-09", endDate: "2026-12-10" });
  });
});

describe("Rückgängig-Daten", () => {
  it("anlegen ↔ löschen: Wiederherstellen trägt alle Angaben des Termins", () => {
    expect(toRestoreBody(event())).toEqual({
      sourceId: "q1",
      eventId: "abc",
      summary: "Zahnarzt",
      location: "Praxis",
      description: "Kärtchen mitnehmen",
      allDay: false,
      start: "2026-12-09T09:00:00.000Z",
      end: "2026-12-09T10:00:00.000Z",
      timeZone: "Europe/Berlin",
    });
  });

  it("ganztägig: Tage mit exklusivem Ende, ohne Zone; ohne Google-Verweis: nichts", () => {
    const allDay = event({
      allDay: true,
      start: "2026-12-08T23:00:00.000Z",
      end: "2026-12-10T23:00:00.000Z",
      endDate: "2026-12-10",
      location: null,
      description: null,
      google: {
        calendarId: "c",
        eventId: "abc",
        etag: '"1"',
        editable: true,
        recurringEventId: null,
        timeZone: null,
      },
    });
    expect(toRestoreBody(allDay)).toMatchObject({
      allDay: true,
      start: "2026-12-09",
      end: "2026-12-11",
      location: "",
      description: "",
      timeZone: null,
    });
    expect(toRestoreBody(event({ google: null }))).toBeNull();
  });

  it("Änderung: nur geänderte Felder, alte Werte fürs Rückgängig, Titel nie leer", () => {
    expect(textChange(event(), { summary: " Zahnarzt Dr. Weiß ", location: "Praxis" })).toEqual({
      changes: { summary: "Zahnarzt Dr. Weiß" },
      previous: { summary: "Zahnarzt" },
    });
    expect(textChange(event(), { location: "" })).toEqual({
      changes: { location: "" },
      previous: { location: "Praxis" },
    });
    expect(textChange(event(), { summary: "   " })).toBeNull();
    expect(textChange(event(), { summary: "Zahnarzt", location: "Praxis " })).toBeNull();
    expect(textChange(event({ description: null }), { description: "Neu\n" })).toEqual({
      changes: { description: "Neu" },
      previous: { description: "" },
    });
  });

  it("Meldung nennt, was sich änderte", () => {
    expect(textChangeMessage(event(), { summary: "Neu" })).toBe("Titel geändert: „Neu“");
    expect(textChangeMessage(event(), { location: "X", description: "Y" })).toBe(
      "Ort und Beschreibung geändert: „Zahnarzt“",
    );
  });

  it("gekürzt gelesene Texte sind gesperrt (sonst ginge beim Speichern Inhalt verloren)", () => {
    const long = `${"a".repeat(1999)}…`;
    expect(isCut(long, 2000)).toBe(true);
    expect(isCut("kurz…", 2000)).toBe(false);
    expect(isCut(null, 2000)).toBe(false);
    expect(lockedTexts(event({ description: long }))).toEqual(["description"]);
    expect(lockedTexts(event({ title: `${"t".repeat(299)}…` }))).toEqual(["summary"]);
    expect(lockedTexts(event())).toEqual([]);
  });
});

describe("Kalenderwahl", () => {
  const cals = [
    { sourceId: "a", name: "Privat", color: "gruen" as const, primary: false },
    { sourceId: "b", name: "Haupt", color: "blau" as const, primary: true },
    { sourceId: "c", name: "Arbeit", color: "lila" as const, primary: false },
  ];
  it("zuletzt benutzter, sonst primärer, sonst erster", () => {
    expect(defaultCalendar(cals, "c")?.sourceId).toBe("c");
    expect(defaultCalendar(cals, "weg")?.sourceId).toBe("b");
    expect(defaultCalendar(cals, null)?.sourceId).toBe("b");
    expect(
      defaultCalendar(
        cals.map((c) => ({ ...c, primary: false })),
        null,
      )?.sourceId,
    ).toBe("a");
    expect(defaultCalendar([], "a")).toBeNull();
  });

  it("nur Kalender mit Schreibrecht sind wählbar (nur lesbare nicht)", () => {
    const sources = [
      { id: "1", name: "Haupt", color: "blau" as const, writable: true, primary: true },
      { id: "2", name: "Feiertage", color: "gruen" as const },
      { id: "3", name: "iCal", color: "rot" as const, writable: false },
    ];
    expect(writableCalendars(sources)).toEqual([
      { sourceId: "1", name: "Haupt", color: "blau", primary: true },
    ]);
    expect(writableCalendars([])).toEqual([]);
  });
});
