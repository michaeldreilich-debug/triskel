import type { IsoDate } from "@/lib/dates";

/**
 * Startbild (E45): einmal am Tag beim ersten Aufruf von Heute ein kurzes Video (Supernova der
 * ESA) mit Leitsätzen (Beispiele – eigene hier eintragen), danach geht es in die Heute-Seite
 * über. Rein, ohne „use client“.
 */
export const INTRO_TEXT = {
  hero: "Ein neuer Tag beginnt.",
  lines: ["Schritt für Schritt zum Ziel.", "Heute zählt, was ich tue."],
  goals: [
    { label: "Kurzfristig", value: "Klarheit" },
    { label: "Langfristig", value: "Gelassenheit" },
  ],
  happy: "Und jeden Tag: etwas, das Freude macht.",
  pillars: ["Fokus", "Ruhe", "Mut", "Neugier"],
} as const;

/**
 * Sekunde im Video, ab der die Zeilen nacheinander erscheinen – in der Reihenfolge Leitsatz,
 * zwei Zeilen, zwei Ziele, Glück, vier Säulen, zuletzt „Los geht’s“. Die Explosion endet bei
 * etwa 3 s im weißen Blitz; der erste Satz kommt aus dem Licht.
 */
export const REVEAL_AT = [3.4, 4.1, 4.7, 5.5, 5.9, 6.7, 7.4, 7.65, 7.9, 8.15, 8.7] as const;

/** Sprungziel beim Antippen: Stelle im Video nach dem weißen Blitz. */
export const AFTER_FLASH = 4;

/** So lange steht alles, bevor es von selbst in die Heute-Seite übergeht. */
export const FUSE_MS = 5000;

/** Dauer des Ausklangs ins Helle, danach ist das Startbild weg. */
export const LEAVE_MS = 1350;

export const INTRO_VIDEO = {
  src: "/startbild/supernova.mp4",
  poster: "/startbild/supernova-start.jpg",
  /** ruhiges Standbild (Hülle und Neutronenstern) bei „Bewegung reduzieren“ */
  still: "/startbild/supernova-ruhe.jpg",
  credit: "Video: ESA/Hubble (L. Calçada)",
} as const;

/** Schlüssel je Gerät: an/aus (useLocalFlag), zuletzt gezeigt (Datum), Test-Freigabe (E2E). */
export const INTRO_KEYS = {
  enabled: "sz:startbild",
  lastShown: "sz:startbild-zuletzt",
  test: "sz:startbild-test",
} as const;

/** Ereignis, mit dem Einstellungen › Startbild es sofort abspielt. */
export const INTRO_PLAY_EVENT = "sz:startbild-abspielen";

/** Wie viele Zeilen (inkl. „Los geht’s“) zur Sekunde `t` sichtbar sind. */
export function revealedCount(t: number): number {
  return REVEAL_AT.filter((at) => t >= at).length;
}

/**
 * Ist das Startbild heute fällig? Nur an, nicht heute schon gezeigt – und nicht in automatisierten
 * Browsern (E2E), außer ein Test schaltet es ausdrücklich frei.
 */
export function introDue({
  enabled,
  lastShown,
  today,
  automated,
  testEnabled,
}: {
  enabled: boolean;
  lastShown: IsoDate | null;
  today: IsoDate;
  automated: boolean;
  testEnabled: boolean;
}): boolean {
  if (!enabled) return false;
  if (automated && !testEnabled) return false;
  return lastShown !== today;
}
