import { describe, expect, it } from "vitest";
import { placeSuggestions } from "./suggestion-popup";

describe("Vorschlagsliste platzieren (O-8)", () => {
  // iPhone 390 × 844, Tastatur offen: sichtbar nur die oberen 450 px
  const keyboard = { top: 0, height: 450, layoutHeight: 844 };

  it("unter dem Cursor, wenn dort Platz ist", () => {
    expect(placeSuggestions({ top: 100, bottom: 120 }, keyboard, 200)).toEqual({
      top: 124,
      maxHeight: 322,
    });
  });

  it("über dem Cursor, wenn die Tastatur den Platz darunter verdeckt", () => {
    const placed = placeSuggestions({ top: 380, bottom: 400 }, keyboard, 9 * 44 + 10);
    expect(placed).toEqual({ bottom: 844 - 380 + 4, maxHeight: 372 });
  });

  it("gescrollter sichtbarer Bereich (visualViewport.offsetTop) zählt mit", () => {
    const scrolled = { top: 300, height: 450, layoutHeight: 844 };
    expect(placeSuggestions({ top: 700, bottom: 720 }, scrolled, 300)).toMatchObject({
      bottom: 844 - 700 + 4,
    });
  });
});
