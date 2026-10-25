import { describe, expect, it } from "vitest";
import { parseDateWord } from "./date-word";

// 2026-10-23 ist ein Freitag
const TODAY = "2026-10-23";
const date = (text: string, today = TODAY) => parseDateWord(text, today)?.date ?? null;

describe("parseDateWord", () => {
  it("erkennt heute, morgen, übermorgen", () => {
    expect(date("Bericht heute abgeben")).toBe("2026-10-23");
    expect(date("Anruf morgen")).toBe("2026-10-24");
    expect(date("Übermorgen Arzt")).toBe("2026-10-25");
    expect(date("uebermorgen Arzt")).toBe("2026-10-25");
  });

  it("egal ob groß oder klein, behält das Wort wie getippt", () => {
    expect(parseDateWord("MORGEN anrufen", TODAY)).toEqual({ word: "MORGEN", date: "2026-10-24" });
  });

  it("Wochentag = nächster solcher Tag, heute zählt nicht", () => {
    expect(date("Montag Team")).toBe("2026-10-26");
    expect(date("am Sonntag")).toBe("2026-10-25");
    expect(date("Samstag")).toBe("2026-10-24");
    // heute ist Freitag → nächster Freitag in einer Woche
    expect(date("Freitag Bericht")).toBe("2026-10-30");
  });

  it("Monats- und Jahreswechsel", () => {
    expect(date("morgen", "2026-10-31")).toBe("2026-11-01");
    expect(date("übermorgen", "2026-12-31")).toBe("2027-01-02");
    expect(date("morgen", "2028-02-28")).toBe("2028-02-29");
    expect(date("Mittwoch", "2026-12-30")).toBe("2027-01-06");
  });

  it("nur ganze Wörter", () => {
    expect(date("Vormorgen")).toBeNull();
    expect(date("morgens früh")).toBeNull();
    expect(date("heutezutage")).toBeNull();
    expect(date("Montagsmeeting")).toBeNull();
  });

  it("nimmt das erste Datumswort", () => {
    expect(parseDateWord("morgen oder Montag", TODAY)?.word).toBe("morgen");
  });

  it("ohne Datumswort null", () => {
    expect(parseDateWord("Milch kaufen", TODAY)).toBeNull();
    expect(parseDateWord("", TODAY)).toBeNull();
  });
});
