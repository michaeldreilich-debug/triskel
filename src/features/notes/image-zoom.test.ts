import { describe, expect, it } from "vitest";
import { clampView, MAX_SCALE, zoomAt } from "./image-zoom";

const sizes = { stage: { w: 1000, h: 800 }, image: { w: 800, h: 600 } };

describe("Großansicht: Zoom und Verschieben (#59)", () => {
  it("Zoom um die Mitte verschiebt nicht", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 0, y: 0 })).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it("Zoom um einen Punkt hält ihn unter dem Zeiger", () => {
    const view = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: -50 });
    expect(view).toEqual({ scale: 2, x: -100, y: 50 });
    // Bildpunkt unter dem Zeiger: (at - t) / s bleibt gleich
    expect((100 - view.x) / view.scale).toBe(100);
  });

  it("Zoom bleibt zwischen 1 und 8", () => {
    expect(zoomAt({ scale: 4, x: 0, y: 0 }, 50, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 2, x: 0, y: 0 }, 0.1, { x: 0, y: 0 }).scale).toBe(1);
  });

  it("eingepasst steht das Bild immer mittig", () => {
    expect(clampView({ scale: 1, x: 300, y: -200 }, sizes)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("vergrößert nur bis zum Bildrand verschiebbar", () => {
    // 2×: Bild 1600×1200 auf 1000×800 → höchstens 300 bzw. 200 px
    expect(clampView({ scale: 2, x: 900, y: -900 }, sizes)).toEqual({ scale: 2, x: 300, y: -200 });
    // 1,2×: 960 breit passt in 1000 → waagrecht mittig, senkrecht 720 < 800 → mittig
    expect(clampView({ scale: 1.2, x: 50, y: 50 }, sizes)).toEqual({ scale: 1.2, x: 0, y: 0 });
  });
});
