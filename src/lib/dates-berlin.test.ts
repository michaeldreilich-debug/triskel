import { describe, expect, it } from "vitest";
import {
  addDays,
  berlinDate,
  berlinDateTime,
  berlinMinutes,
  berlinTime,
  daysBetween,
  dueTone,
  formatDayShort,
  formatDue,
  isoWeekday,
  isoWeekRange,
  timeToMinutes,
} from "./dates";

describe("Europe/Berlin", () => {
  it("heute ist der Berliner Kalendertag, auch kurz nach Mitternacht", () => {
    // 22:30 UTC = 00:30 Sommerzeit am nächsten Tag
    expect(berlinDate(new Date("2026-10-11T22:30:00Z"))).toBe("2026-10-12");
    expect(berlinDate(new Date("2026-10-11T21:59:00Z"))).toBe("2026-10-11");
    // nach der Zeitumstellung (25.10., 03:00 → 02:00) ist der Versatz eine Stunde
    expect(berlinDate(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
    expect(berlinDate(new Date("2026-10-25T22:59:00Z"))).toBe("2026-10-25");
  });

  it("Minuten und Uhrzeit um die Zeitumstellung", () => {
    expect(berlinMinutes(new Date("2026-10-24T17:00:00Z"))).toBe(19 * 60); // 19:00 CEST
    expect(berlinMinutes(new Date("2026-10-25T18:00:00Z"))).toBe(19 * 60); // 19:00 CET
    expect(berlinTime("2026-10-25T08:00:00Z")).toBe("09:00");
    expect(berlinTime("2026-10-24T07:00:00Z")).toBe("09:00");
    expect(timeToMinutes("20:00:00")).toBe(1200);
    expect(timeToMinutes("7:05")).toBe(425);
    expect(timeToMinutes("x")).toBeNull();
  });

  it("Wanduhrzeit → Zeitpunkt, auch am 25.10.2026", () => {
    expect(berlinDateTime("2026-10-24", "09:00")).toBe("2026-10-24T07:00:00.000Z");
    expect(berlinDateTime("2026-10-25", "09:00")).toBe("2026-10-25T08:00:00.000Z");
    expect(berlinDateTime("2026-10-26", "00:15")).toBe("2026-10-25T23:15:00.000Z");
    // doppelte Stunde: erste (Sommerzeit)
    expect(berlinDateTime("2026-10-25", "02:30")).toBe("2026-10-25T00:30:00.000Z");
    expect(berlinDateTime("2027-03-28", "09:00")).toBe("2027-03-28T07:00:00.000Z");
  });

  it("Kalenderrechnung ohne Zeitzonen-Fehler", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(isoWeekday("2026-10-11")).toBe(6); // Sonntag
    expect(isoWeekday("2026-10-12")).toBe(0); // Montag
    expect(isoWeekRange("2026-10-11")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });

  it("Fälligkeit relativ zu heute", () => {
    const today = "2026-10-11";
    expect(formatDue("2026-10-11", today)).toBe("heute");
    expect(formatDue("2026-10-12", today)).toBe("morgen");
    expect(formatDue("2026-10-10", today)).toBe("gestern");
    expect(formatDue("2026-10-14", today)).toBe("Mi 14.10.");
    expect(formatDue("2026-10-07", today)).toBe("Mi 07.10.");
    expect(formatDue("2026-10-30", today)).toBe("Fr 30.10.");
    expect(formatDue("2027-01-05", today)).toBe("Di 05.01.27");
    expect(formatDue(null, today)).toBe("");
    expect(formatDayShort("2026-10-12")).toBe("Mo, 12.10.");
  });

  it("Dringlichkeit der Fälligkeit (Muster 4)", () => {
    const today = "2026-10-11";
    expect(dueTone("2026-10-09", today)).toBe("over");
    expect(dueTone("2026-10-11", today)).toBe("today");
    expect(dueTone("2026-10-12", today)).toBe("soon");
    expect(dueTone("2026-10-20", today)).toBe("later");
    expect(dueTone(null, today)).toBeNull();
  });
});

describe("berlinDateTime: nicht existierende Zeit", () => {
  it("29.03.2027, 02:30 gibt es nicht → die spätere (03:30 Sommerzeit)", () => {
    expect(berlinDateTime("2027-03-28", "02:30")).toBe("2027-03-28T01:30:00.000Z");
  });
});
