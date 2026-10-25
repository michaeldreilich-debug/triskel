import { describe, expect, it } from "vitest";
import { currentPdfPage, needsRedraw, pdfWindowSize } from "./pdf-view";

const A4 = 297 / 210;

describe("PDF-Fenster in Seitenhöhe (#36)", () => {
  it("füllt am Handy die Breite, eine A4-Seite passt ganz hinein", () => {
    const size = pdfWindowSize(358, 844, A4);
    expect(size.height).toBeCloseTo(358 * A4);
    const page = size.page(A4);
    expect(page.width).toBeCloseTo(358);
    expect(page.height).toBeCloseTo(size.height);
  });

  it("am breiten Bildschirm höchstens 80 % hoch, die Seite schrumpft auf diese Höhe", () => {
    const size = pdfWindowSize(900, 900, A4);
    expect(size.height).toBeCloseTo(900 * 0.8 - 16);
    const page = size.page(A4);
    expect(page.height).toBeCloseTo(size.height);
    expect(page.width).toBeCloseTo(size.height / A4);
  });

  it("Querformat-Seite füllt die Breite und bleibt niedriger als das Fenster", () => {
    const size = pdfWindowSize(600, 900, A4);
    const landscape = size.page(210 / 297);
    expect(landscape.width).toBeCloseTo(600);
    expect(landscape.height).toBeLessThan(size.height);
  });

  it("aktuelle Seite ist die, deren Oberkante die Mitte des Fensters überschritten hat", () => {
    const tops = [8, 516, 1024, 1532];
    expect(currentPdfPage(tops, 0, 516)).toBe(1);
    expect(currentPdfPage(tops, 300, 516)).toBe(2);
    expect(currentPdfPage(tops, 1024, 516)).toBe(3);
    expect(currentPdfPage(tops, 99_999, 516)).toBe(4);
  });
});

describe("neu zeichnen nach Größenänderung (O-16)", () => {
  it("erst ab deutlich anderer Breite (Drehen 390 → 844 px), nicht bei kleinen Schwankungen", () => {
    expect(needsRedraw(358, 812)).toBe(true);
    expect(needsRedraw(812, 358)).toBe(true);
    expect(needsRedraw(358, 370)).toBe(false);
    expect(needsRedraw(0, 812)).toBe(false);
  });
});
