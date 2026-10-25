import { describe, expect, it } from "vitest";
import {
  clampWidth,
  cropPixels,
  FULL_CROP,
  isFullCrop,
  MIN_CROP,
  moveCrop,
  stepWidth,
} from "./crop";

describe("Zuschnitt (#28)", () => {
  it("Ecke ziehen verkleinert, bleibt im Bild", () => {
    expect(moveCrop(FULL_CROP, "se", -0.5, -0.25)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.75 });
    expect(moveCrop(FULL_CROP, "nw", 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: 0.8, h: 0.9 });
    // über den Rand hinaus: bleibt bei 0 bzw. 1
    expect(moveCrop(FULL_CROP, "ne", 0.3, -0.3)).toEqual(FULL_CROP);
  });

  it("nie kleiner als MIN_CROP, Ecken kreuzen sich nicht", () => {
    const tiny = moveCrop(FULL_CROP, "se", -2, -2);
    expect(tiny.w).toBeCloseTo(MIN_CROP);
    expect(tiny.h).toBeCloseTo(MIN_CROP);
  });

  it("Verschieben behält die Größe und bleibt im Bild", () => {
    const box = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(moveCrop(box, "move", 0.2, 0.1)).toEqual({
      x: 0.30000000000000004,
      y: 0.2,
      w: 0.5,
      h: 0.5,
    });
    expect(moveCrop(box, "move", 1, 1)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("ganz = kein Zuschnitt; Pixel ganzzahlig im Bild", () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
    expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 2000, 1000)).toEqual({
      sx: 500,
      sy: 500,
      sw: 1000,
      sh: 500,
    });
  });

  it("Breite: 10–100 %, Stufen für Kleiner/Größer", () => {
    expect(clampWidth(3)).toBe(10);
    expect(clampWidth(140)).toBe(100);
    expect(clampWidth(42.4)).toBe(42);
    expect(stepWidth(null, -1)).toBe(75);
    expect(stepWidth(75, -1)).toBe(66);
    expect(stepWidth(40, 1)).toBe(50);
    expect(stepWidth(25, -1)).toBe(25);
    expect(stepWidth(100, 1)).toBe(100);
  });
});
