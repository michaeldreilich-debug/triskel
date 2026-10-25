import { describe, expect, it } from "vitest";
import { colorFromHex, googleCalendarColor } from "./colors";

// Farben ohne Raute geschrieben: Farbwerte stehen sonst nur in tokens.css (Token-Regel)
describe("Google-Farben → Token-Schlüssel", () => {
  it.each([
    ["d50000", "rot"], // Tomate
    ["e67c73", "rot"], // Flamingo
    ["f4511e", "orange"], // Mandarine
    ["ac725e", "orange"], // Kakao
    ["f6bf26", "gelb"], // Banane
    ["fbe983", "gelb"],
    ["33b679", "gruen"], // Salbei
    ["0b8043", "gruen"], // Basilikum
    ["92e1c0", "gruen"],
    ["039be5", "blau"], // Pfau
    ["3f51b5", "blau"], // Heidelbeere
    ["4986e7", "blau"],
    ["9a9cff", "lila"],
    ["8e24aa", "lila"], // Traube
    ["616161", "grau"], // Graphit
    ["cabdbf", "grau"],
    ["f691b2", "rot"],
  ])("%s → %s", (hex, color) => {
    expect(colorFromHex(hex)).toBe(color);
  });

  it("nimmt die Farbe mit Raute und kurz (3 Stellen); Unsinn → null", () => {
    expect(colorFromHex(`#${"039be5"}`)).toBe("blau");
    expect(colorFromHex("0a0")).toBe("gruen");
    expect(colorFromHex("blau")).toBeNull();
    expect(colorFromHex("")).toBeNull();
  });

  it("Eintrag der Kalenderliste: Farbe vor colorId, sonst Palette, sonst Blau", () => {
    expect(googleCalendarColor({ backgroundColor: `#${"0b8043"}`, colorId: "16" })).toBe("gruen");
    expect(googleCalendarColor({ colorId: "11" })).toBe("gelb");
    expect(googleCalendarColor({ colorId: "19" })).toBe("grau");
    expect(googleCalendarColor({ backgroundColor: "nix", colorId: "99" })).toBe("blau");
    expect(googleCalendarColor({})).toBe("blau");
  });
});
