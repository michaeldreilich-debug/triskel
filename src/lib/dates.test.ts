import { describe, expect, it } from "vitest";
import {
  addMonths,
  formatDateShort,
  formatEdited,
  formatListDate,
  formatRange,
  isoWeekNumber,
  isoWeekYear,
  parseIsoDate,
  toIsoDate,
} from "./dates";

describe("Datumshelfer", () => {
  it("ISO-Tag hin und zurück ohne Zeitzonen-Verschiebung", () => {
    const date = parseIsoDate("2026-10-25");
    expect(date && toIsoDate(date)).toBe("2026-10-25");
    expect(formatDateShort("2026-10-25")).toBe("25.10.2026");
    expect(parseIsoDate("25.10.2026")).toBeNull();
  });

  it("Listendatum: im laufenden Jahr ohne Jahr, sonst zweistellig, in Europe/Berlin", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(formatListDate("2026-10-02T09:00:00Z", now)).toBe("02.10.");
    // 31.12.2025 23:30 UTC ist in Berlin schon der 01.01.2026
    expect(formatListDate("2025-12-31T23:30:00Z", now)).toBe("01.01.");
    expect(formatListDate("2025-06-01T10:00:00Z", now)).toBe("01.06.25");
    expect(formatListDate(null, now)).toBe("");
  });

  it("Zuletzt geändert (#41): heute, gestern, mit Wochentag, frühere Jahre mit Jahr", () => {
    const now = new Date("2026-10-17T12:00:00Z"); // Sa, 14:00 in Berlin
    expect(formatEdited("2026-10-17T12:32:00Z", now)).toBe("heute um 14:32");
    expect(formatEdited("2026-10-16T07:10:00Z", now)).toBe("gestern um 09:10");
    expect(formatEdited("2026-10-14T15:05:00Z", now)).toBe("am Mi, 14.10. um 17:05");
    // 31.12.2025 23:30 UTC ist in Berlin schon der 01.01.2026
    expect(formatEdited("2025-12-31T23:30:00Z", now)).toBe("am Do, 01.01. um 00:30");
    expect(formatEdited("2025-06-01T10:00:00Z", now)).toBe("am 01.06.2025");
    expect(formatEdited(null, now)).toBe("");
  });
});

describe("Wochen und Monate (B12)", () => {
  it("ISO-Kalenderwoche samt Jahreswechsel", () => {
    expect(isoWeekNumber("2026-10-16")).toBe(42);
    expect(isoWeekNumber("2026-10-12")).toBe(42);
    expect(isoWeekNumber("2026-10-18")).toBe(42);
    expect(isoWeekNumber("2025-12-29")).toBe(1);
    expect(isoWeekYear("2025-12-29")).toBe(2026);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
    expect(isoWeekYear("2027-01-01")).toBe(2026);
    expect(isoWeekNumber("2026-01-01")).toBe(1);
  });

  it("Monate zurück, Monatsende wird begrenzt", () => {
    expect(addMonths("2026-10-16", -1)).toBe("2026-09-16");
    expect(addMonths("2026-10-16", -12)).toBe("2025-10-16");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -3)).toBe("2025-10-15");
  });

  it("Zeitraum kurz", () => {
    expect(formatRange("2026-10-12", "2026-10-18")).toBe("12.–18.10.2026");
    expect(formatRange("2026-09-28", "2026-10-04")).toBe("28.09.–04.10.2026");
    expect(formatRange("2025-12-29", "2026-01-04")).toBe("29.12.2025–04.01.2026");
  });
});
