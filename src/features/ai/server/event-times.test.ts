import { describe, expect, it } from "vitest";
import type { EventTimes } from "@/features/calendar/move";
import { resolveTimes, splitBeginn } from "./event-times";

const timed: EventTimes = {
  allDay: false,
  start: "2026-12-09T09:00:00.000Z", // 10:00 Berlin
  end: "2026-12-09T10:30:00.000Z",
};
const allDay: EventTimes = { allDay: true, start: "2026-12-09", end: "2026-12-11" };

const patchOf = (result: ReturnType<typeof resolveTimes>) => {
  expect(result.ok).toBe(true);
  return result.ok ? result.value : null;
};

describe("Zeiten der KI-Termin-Werkzeuge (N1d)", () => {
  it("beginn: Datum mit und ohne Uhrzeit", () => {
    expect(splitBeginn("2026-12-09 10:00")).toEqual({ date: "2026-12-09", time: "10:00" });
    expect(splitBeginn("2026-12-09T10:00")).toEqual({ date: "2026-12-09", time: "10:00" });
    expect(splitBeginn("2026-12-09")).toEqual({ date: "2026-12-09", time: null });
    expect(splitBeginn("2026-12-09 25:00")).toBeNull();
    expect(splitBeginn("morgen")).toBeNull();
  });

  it("anlegen: Berliner Wanduhrzeit, Standarddauer 60 min, Zone Berlin", () => {
    const value = patchOf(resolveTimes({ beginn: "2026-12-09 10:00" }, null, "Europe/Berlin"));
    expect(value?.patch).toEqual({
      start: { dateTime: "2026-12-09T09:00:00.000Z", timeZone: "Europe/Berlin" },
      end: { dateTime: "2026-12-09T10:00:00.000Z", timeZone: "Europe/Berlin" },
    });
    // Sommerzeit: 10:00 Berlin = 08:00 UTC
    const summer = patchOf(
      resolveTimes({ beginn: "2026-07-09 10:00", dauer_min: 30 }, null, "Europe/Berlin"),
    );
    expect(summer?.patch?.start).toMatchObject({ dateTime: "2026-07-09T08:00:00.000Z" });
    expect(summer?.patch?.end).toMatchObject({ dateTime: "2026-07-09T08:30:00.000Z" });
  });

  it("anlegen ganztägig: Ende exklusiv, dauer_tage; ohne beginn oder ohne Uhrzeit ein Fehler", () => {
    const value = patchOf(
      resolveTimes({ beginn: "2026-12-09", ganztaegig: true, dauer_tage: 2 }, null, null),
    );
    expect(value?.patch).toEqual({ start: { date: "2026-12-09" }, end: { date: "2026-12-11" } });
    expect(resolveTimes({ dauer_min: 30 }, null, null).ok).toBe(false);
    expect(resolveTimes({ beginn: "2026-12-09" }, null, null)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Uhrzeit"),
    });
    expect(
      resolveTimes({ beginn: "2026-12-09", ganztaegig: true, dauer_min: 30 }, null, null).ok,
    ).toBe(false);
    expect(resolveTimes({ beginn: "2026-12-09 10:00", dauer_tage: 2 }, null, null).ok).toBe(false);
  });

  it("ändern: ohne Zeiteingabe nichts; Dauer und Beginn bleiben, wo nicht genannt; Zone des Termins", () => {
    expect(patchOf(resolveTimes({}, timed, "Europe/Berlin"))?.patch).toBeNull();
    // nur neuer Beginn: Dauer 90 min bleibt, Zone des Termins bleibt
    const moved = patchOf(resolveTimes({ beginn: "2026-12-10 14:00" }, timed, "America/New_York"));
    expect(moved?.patch?.start).toEqual({
      dateTime: "2026-12-10T13:00:00.000Z",
      timeZone: "America/New_York",
    });
    expect(moved?.patch?.end).toMatchObject({ dateTime: "2026-12-10T14:30:00.000Z" });
    // nur neue Dauer: Beginn bleibt
    const longer = patchOf(resolveTimes({ dauer_min: 120 }, timed, null));
    expect(longer?.patch?.start).toMatchObject({ dateTime: "2026-12-09T09:00:00.000Z" });
    expect(longer?.patch?.end).toMatchObject({ dateTime: "2026-12-09T11:00:00.000Z" });
    // gleiche Werte → nichts zu tun
    expect(
      patchOf(resolveTimes({ beginn: "2026-12-09 10:00", dauer_min: 90 }, timed, null))?.patch,
    ).toBeNull();
  });

  it("ändern: zwischen ganztägig und mit Uhrzeit wechseln", () => {
    const toAllDay = patchOf(resolveTimes({ ganztaegig: true }, timed, null));
    expect(toAllDay?.patch).toEqual({ start: { date: "2026-12-09" }, end: { date: "2026-12-10" } });
    expect(resolveTimes({ ganztaegig: false }, allDay, null).ok).toBe(false);
    const toTimed = patchOf(
      resolveTimes({ ganztaegig: false, beginn: "2026-12-09 09:00" }, allDay, null),
    );
    expect(toTimed?.times).toMatchObject({ allDay: false, start: "2026-12-09T08:00:00.000Z" });
    // ganztägig verschieben: Dauer in Tagen bleibt
    const shifted = patchOf(resolveTimes({ beginn: "2026-12-20" }, allDay, null));
    expect(shifted?.patch).toEqual({ start: { date: "2026-12-20" }, end: { date: "2026-12-22" } });
  });
});
