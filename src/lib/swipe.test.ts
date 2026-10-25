import { describe, expect, it } from "vitest";
import { decideAxis, isArmed, SWIPE, swipeOffset, swipeOutcome } from "./swipe";

const both = { left: true, right: true };
const leftOnly = { left: true, right: false };

describe("Wischgesten (Rückmeldung #22)", () => {
  it("entscheidet die Richtung erst nach ein paar Pixeln, senkrecht hat Vorrang", () => {
    expect(decideAxis(4, 3)).toBe("pending");
    expect(decideAxis(-30, 6)).toBe("horizontal");
    expect(decideAxis(8, 24)).toBe("vertical");
    // Gleichstand: scrollen
    expect(decideAxis(12, 12)).toBe("vertical");
  });

  it("die Zeile folgt dem Finger nur in Richtungen mit Aktion", () => {
    expect(swipeOffset(-80, leftOnly)).toBe(-80);
    expect(swipeOffset(80, leftOnly)).toBe(0);
    expect(swipeOffset(80, both)).toBe(80);
  });

  it("löst ab 40 % der Breite aus, sonst federt sie zurück", () => {
    expect(swipeOutcome(-160, 390, 0, both)).toBe("left");
    expect(swipeOutcome(156, 390, 0, both)).toBe("right");
    expect(swipeOutcome(-100, 390, 0, both)).toBeNull();
    expect(isArmed(-156, 390)).toBe(true);
    expect(isArmed(-150, 390)).toBe(false);
  });

  it("schnelles Wischen löst schon früher aus – aber nicht gegen die Bewegung", () => {
    expect(swipeOutcome(-60, 390, -0.8, both)).toBe("left");
    expect(swipeOutcome(-60, 390, 0.8, both)).toBeNull();
    expect(swipeOutcome(-30, 390, -2, both)).toBeNull(); // zu kurz
    expect(swipeOutcome(-60, 390, -(SWIPE.flickVelocity / 2), both)).toBeNull();
  });

  it("ohne Aktion in dieser Richtung passiert nichts", () => {
    expect(swipeOutcome(300, 390, 1, leftOnly)).toBeNull();
    expect(swipeOutcome(0, 390, 0, both)).toBeNull();
  });
});
