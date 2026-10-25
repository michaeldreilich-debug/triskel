/**
 * Bild zuschneiden und skalieren (Rückmeldung #28) – reine Rechnungen, ohne Browser.
 * Zuschnitt als Anteile des Bildes (0–1), Breite im Text als Prozent der Zeile.
 */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropHandle = "nw" | "ne" | "sw" | "se" | "move";

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
/** kleinster Zuschnitt (Anteil je Seite) */
export const MIN_CROP = 0.05;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Rahmen um (dx, dy) verschieben bzw. an einer Ecke ziehen; bleibt im Bild und ≥ MIN_CROP. */
export function moveCrop(start: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle === "nw" || handle === "sw") left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle === "ne" || handle === "se") right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle === "nw" || handle === "ne") top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle === "sw" || handle === "se") bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Ganz oder fast ganz (Rundung): kein Zuschnitt nötig. */
export const isFullCrop = (rect: CropRect) =>
  rect.x < 0.002 && rect.y < 0.002 && rect.w > 0.996 && rect.h > 0.996;

/** Pixelbereich im Originalbild (ganzzahlig, mindestens 1 px). */
export function cropPixels(rect: CropRect, width: number, height: number) {
  const sx = Math.round(rect.x * width);
  const sy = Math.round(rect.y * height);
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(width - sx, Math.round(rect.w * width))),
    sh: Math.max(1, Math.min(height - sy, Math.round(rect.h * height))),
  };
}

/** Bildbreite im Text: 10–100 % der Zeile, ganze Prozent. */
export const MIN_WIDTH = 10;
export const clampWidth = (percent: number) => Math.round(clamp(percent, MIN_WIDTH, 100));

/** Stufen für „Kleiner“/„Größer“ (Tastatur und Handy, ohne Ziehen). */
export const WIDTH_STEPS = [25, 33, 50, 66, 75, 100];

export function stepWidth(current: number | null, direction: 1 | -1): number {
  const now = current ?? 100;
  if (direction > 0) return WIDTH_STEPS.find((s) => s > now) ?? 100;
  return [...WIDTH_STEPS].reverse().find((s) => s < now) ?? WIDTH_STEPS[0];
}
