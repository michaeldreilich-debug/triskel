/**
 * Wischgesten für Listenzeilen am Handy (Rückmeldung #22, B13) als reine Logik:
 * Richtung erst nach ein paar Pixeln entscheiden (senkrecht = scrollen hat Vorrang), auslösen ab
 * 40 % der Zeilenbreite oder bei schnellem Wischen.
 */

export const SWIPE = {
  /** so weit (px) darf der Finger wandern, bevor die Richtung feststeht */
  slop: 10,
  /** Auslösen ab diesem Anteil der Zeilenbreite */
  ratio: 0.4,
  /** schnelles Wischen: mindestens so schnell (px/ms) … */
  flickVelocity: 0.5,
  /** … und mindestens so weit (px) */
  flickDistance: 48,
  /** Hinausgleiten bzw. Zurückfedern (ms, Design: 120–180) */
  duration: 160,
} as const;

export type SwipeAxis = "pending" | "horizontal" | "vertical";
export type SwipeSide = "left" | "right";

/** Richtung der Geste; bei Gleichstand gewinnt senkrecht (Scrollen). */
export function decideAxis(dx: number, dy: number, slop: number = SWIPE.slop): SwipeAxis {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "pending";
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

/** Nach links gewischt = Zeile wandert nach links (dx < 0). */
export const sideOf = (dx: number): SwipeSide | null => (dx < 0 ? "left" : dx > 0 ? "right" : null);

/** Versatz der Zeile: folgt dem Finger, aber nur in Richtungen mit Aktion. */
export function swipeOffset(dx: number, allowed: Record<SwipeSide, boolean>): number {
  const side = sideOf(dx);
  return side && allowed[side] ? dx : 0;
}

/** Weit genug, dass Loslassen auslöst (für die stärkere Farbe unter der Zeile). */
export const isArmed = (offset: number, width: number) =>
  width > 0 && Math.abs(offset) >= width * SWIPE.ratio;

/**
 * Was beim Loslassen passiert: Aktion links/rechts oder zurückfedern (null).
 * velocity in px/ms, mit Vorzeichen (negativ = nach links).
 */
export function swipeOutcome(
  offset: number,
  width: number,
  velocity: number,
  allowed: Record<SwipeSide, boolean>,
): SwipeSide | null {
  const side = sideOf(offset);
  if (!side || !allowed[side]) return null;
  if (isArmed(offset, width)) return side;
  const flick =
    Math.abs(offset) >= SWIPE.flickDistance &&
    Math.sign(velocity) === Math.sign(offset) &&
    Math.abs(velocity) >= SWIPE.flickVelocity;
  return flick ? side : null;
}
