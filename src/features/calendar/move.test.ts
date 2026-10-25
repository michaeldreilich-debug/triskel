import { describe, expect, it } from "vitest";
import { normalizeGoogleEvent } from "./google/events";
import {
  applyEventTimes,
  eventDurationMin,
  eventTimes,
  isMovable,
  moveEventToDay,
  moveEventToSlot,
  moveMessage,
  sameTimes,
  setEventDuration,
  setEventEnd,
  setEventSchedule,
  setEventStartTime,
} from "./move";
import type { CalendarEvent } from "./types";

const SOURCE = {
  id: "src",
  name: "K",
  color: "blau" as const,
  calendarId: "m@example.com",
  accessRole: "owner" as const,
};
const ev = (extra: object): CalendarEvent => {
  const e = normalizeGoogleEvent({ id: "e1", etag: "t1", summary: "Termin", ...extra }, SOURCE);
  if (!e) throw new Error("kein Termin");
  return e;
};
// Mi 21.10.2026 09:00–10:30 Berlin (Sommerzeit bis 25.10.)
const timed = ev({
  start: { dateTime: "2026-10-21T09:00:00+02:00", timeZone: "Europe/Berlin" },
  end: { dateTime: "2026-10-21T10:30:00+02:00", timeZone: "Europe/Berlin" },
});
const allDay = ev({
  id: "e2",
  start: { date: "2026-10-22" },
  end: { date: "2026-10-24" },
});

describe("Zeiten in der Form der Schnittstelle", () => {
  it("Termin mit Uhrzeit: Zeitpunkte, ganztägig: Tage mit exklusivem Ende", () => {
    expect(eventTimes(timed)).toEqual({
      allDay: false,
      start: "2026-10-21T07:00:00.000Z",
      end: "2026-10-21T08:30:00.000Z",
    });
    expect(eventTimes(allDay)).toEqual({ allDay: true, start: "2026-10-22", end: "2026-10-24" });
    expect(eventDurationMin(timed)).toBe(90);
    expect(eventDurationMin(allDay)).toBeNull();
  });
});

describe("Ziehen auf eine Uhrzeit", () => {
  it("andere Uhrzeit, Dauer bleibt", () => {
    expect(moveEventToSlot(timed, "2026-10-21", 14 * 60 + 15)).toEqual({
      allDay: false,
      start: "2026-10-21T12:15:00.000Z",
      end: "2026-10-21T13:45:00.000Z",
    });
  });

  it("anderer Tag und Uhrzeit; über die Zeitumstellung bleibt die Wanduhrzeit", () => {
    const t = moveEventToSlot(timed, "2026-10-26", 9 * 60);
    // 26.10. gilt Winterzeit (UTC+1)
    expect(t).toEqual({
      allDay: false,
      start: "2026-10-26T08:00:00.000Z",
      end: "2026-10-26T09:30:00.000Z",
    });
  });

  it("ganztägig lässt sich nicht auf eine Uhrzeit ziehen", () => {
    expect(moveEventToSlot(allDay, "2026-10-22", 600)).toBeNull();
    expect(setEventEnd(allDay, "2026-10-22", 600)).toBeNull();
    expect(setEventDuration(allDay, 60)).toBeNull();
    expect(setEventStartTime(allDay, "10:00")).toBeNull();
  });
});

describe("Ziehen auf einen Tag", () => {
  it("mit Uhrzeit: gleiche Uhrzeit und Dauer am neuen Tag", () => {
    expect(moveEventToDay(timed, "2026-10-23")).toEqual({
      allDay: false,
      start: "2026-10-23T07:00:00.000Z",
      end: "2026-10-23T08:30:00.000Z",
    });
  });

  it("ganztägig: um die Tage verschoben, Länge bleibt", () => {
    expect(moveEventToDay(allDay, "2026-10-26")).toEqual({
      allDay: true,
      start: "2026-10-26",
      end: "2026-10-28",
    });
    expect(moveEventToDay(allDay, "2026-10-20")).toEqual({
      allDay: true,
      start: "2026-10-20",
      end: "2026-10-22",
    });
  });

  it("mehrtägig ganztägig: am zweiten Tag gegriffen, um die Differenz zum gegriffenen Tag", () => {
    // gegriffen am 23.10. (zweiter Tag) und auf den 26.10. gezogen → +3 Tage
    expect(moveEventToDay(allDay, "2026-10-26", "2026-10-23")).toEqual({
      allDay: true,
      start: "2026-10-25",
      end: "2026-10-27",
    });
  });
});

describe("Dauer", () => {
  it("am unteren Rand: neues Ende auf dem Raster, mindestens 15 min", () => {
    expect(setEventEnd(timed, "2026-10-21", 12 * 60)).toEqual({
      allDay: false,
      start: "2026-10-21T07:00:00.000Z",
      end: "2026-10-21T10:00:00.000Z",
    });
    expect(setEventEnd(timed, "2026-10-21", 8 * 60)?.end).toBe("2026-10-21T07:15:00.000Z");
  });

  it("Ende um Mitternacht (24:00) ist der nächste Tag 00:00", () => {
    expect(setEventEnd(timed, "2026-10-21", 24 * 60)?.end).toBe("2026-10-21T22:00:00.000Z");
  });

  it("Dauer in Minuten, Beginn bleibt; auf 15 min gerundet", () => {
    expect(setEventDuration(timed, 45)).toMatchObject({
      start: "2026-10-21T07:00:00.000Z",
      end: "2026-10-21T07:45:00.000Z",
    });
    expect(setEventDuration(timed, 5)?.end).toBe("2026-10-21T07:15:00.000Z");
    expect(setEventDuration(timed, 52)?.end).toBe("2026-10-21T07:45:00.000Z");
  });

  it("neue Uhrzeit am selben Tag, Dauer bleibt", () => {
    expect(setEventStartTime(timed, "16:30")).toEqual({
      allDay: false,
      start: "2026-10-21T14:30:00.000Z",
      end: "2026-10-21T16:00:00.000Z",
    });
  });
});

describe("Rückgängig und Anzeige", () => {
  it("die alten Zeiten stellen den Termin wieder her", () => {
    const before = eventTimes(timed);
    const moved = applyEventTimes(timed, moveEventToSlot(timed, "2026-10-22", 15 * 60) ?? before);
    expect(moved).toMatchObject({ date: "2026-10-22", startMinutes: 900, endMinutes: 990 });
    expect(moved.id).not.toBe(timed.id);
    expect(moved.google).toEqual(timed.google);
    const back = applyEventTimes(moved, before);
    expect(back).toEqual(timed);
    expect(sameTimes(eventTimes(back), before)).toBe(true);
  });

  it("ganztägig: Anzeige am neuen Tag mit gleicher Länge", () => {
    const moved = applyEventTimes(allDay, moveEventToDay(allDay, "2026-10-26"));
    expect(moved).toMatchObject({ allDay: true, date: "2026-10-26", endDate: "2026-10-27" });
    expect(applyEventTimes(moved, eventTimes(allDay))).toEqual(allDay);
  });

  it("Meldung nennt Titel, Tag und Zeit", () => {
    expect(moveMessage(timed, eventTimes(timed), "2026-10-20")).toBe(
      "„Termin“ → morgen, 09:00–10:30",
    );
    expect(moveMessage(allDay, eventTimes(allDay), "2026-10-22")).toBe("„Termin“ → heute");
  });

  it("ziehbar: nur editierbare Google-Termine, mit Uhrzeit nur an einem Tag", () => {
    expect(isMovable(timed)).toBe(true);
    expect(isMovable(allDay)).toBe(true);
    expect(isMovable({ ...timed, google: null })).toBe(false);
    expect(
      isMovable({ ...timed, google: timed.google && { ...timed.google, editable: false } }),
    ).toBe(false);
    expect(isMovable({ ...timed, endDate: "2026-10-22" })).toBe(false);
  });
});

describe("Uhrzeit und Dauer zusammen (Termin-Fenster)", () => {
  it("ein Aufruf: neuer Beginn, neue Dauer, gleicher Tag", () => {
    expect(setEventSchedule(timed, "13:00", 45)).toEqual({
      allDay: false,
      start: "2026-10-21T11:00:00.000Z",
      end: "2026-10-21T11:45:00.000Z",
    });
    expect(setEventSchedule(allDay, "13:00", 45)).toBeNull();
  });
});
