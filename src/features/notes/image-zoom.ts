/**
 * Rechnung der Großansicht (#59): Zoom um einen Punkt und Begrenzen des Verschiebens, damit das
 * Bild nie aus dem Fenster wandert. Punkte relativ zur Mitte der Bühne, Bild mittig eingepasst.
 */
export interface ImageView {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

interface Size {
  w: number;
  h: number;
}

/** Auf `scale` zoomen, so dass der Punkt `at` unter dem Zeiger stehen bleibt. */
export function zoomAt(view: ImageView, scale: number, at: { x: number; y: number }): ImageView {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  const ratio = next / view.scale;
  return { scale: next, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/** Verschieben begrenzen: ragt das Bild über die Bühne, höchstens bis zu seinem Rand; sonst mittig. */
export function clampView(view: ImageView, sizes: { stage: Size; image: Size }): ImageView {
  if (view.scale <= MIN_SCALE) return { scale: MIN_SCALE, x: 0, y: 0 };
  const limit = (image: number, stage: number) => Math.max(0, (image * view.scale - stage) / 2);
  const lx = limit(sizes.image.w, sizes.stage.w);
  const ly = limit(sizes.image.h, sizes.stage.h);
  return {
    scale: view.scale,
    x: Math.min(lx, Math.max(-lx, view.x)),
    y: Math.min(ly, Math.max(-ly, view.y)),
  };
}
