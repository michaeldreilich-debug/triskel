/**
 * Google-Kalenderfarben → Token-Schlüssel der App (#64, N1a). Gespeichert wird immer nur der
 * Schlüssel (`blau`, `gruen` …), nie ein Farbwert. Google meldet je Kalender `backgroundColor`
 * (tatsächliche Farbe, auch eigene Farben) und `colorId` (Palette 1–24); die Farbe hat Vorrang.
 */
import type { CalendarColor } from "../types";

/** Googles Kalender-Palette (colors.get › calendar, 1–24) nach Farbton zugeordnet. */
const COLOR_IDS: Record<string, CalendarColor> = {
  "1": "orange", // Kakao (braun)
  "2": "rot",
  "3": "rot",
  "4": "rot",
  "5": "orange",
  "6": "orange",
  "7": "gruen",
  "8": "gruen",
  "9": "gruen",
  "10": "gruen",
  "11": "gelb",
  "12": "gelb",
  "13": "gruen",
  "14": "blau",
  "15": "blau",
  "16": "blau",
  "17": "lila",
  "18": "lila",
  "19": "grau",
  "20": "grau",
  "21": "rot",
  "22": "rot",
  "23": "lila",
  "24": "lila",
};

/** Farbton einer Hex-Farbe (mit oder ohne Raute) als Token-Schlüssel; Ungültiges → null. */
export function colorFromHex(value: string): CalendarColor | null {
  const hex = value.trim().replace(/^#/, "");
  const full = /^[0-9a-f]{3}$/i.test(hex)
    ? [...hex].map((c) => c + c).join("")
    : /^[0-9a-f]{6}$/i.test(hex)
      ? hex
      : null;
  if (!full) return null;
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.15 || delta < 0.06) return "grau";
  let hue =
    max === r
      ? ((g - b) / delta) * 60
      : max === g
        ? ((b - r) / delta + 2) * 60
        : ((r - g) / delta + 4) * 60;
  if (hue < 0) hue += 360;
  if (hue < 12 || hue >= 330) return "rot";
  if (hue < 40) return "orange";
  if (hue < 70) return "gelb";
  if (hue < 165) return "gruen";
  if (hue < 235) return "blau";
  return "lila";
}

/** Farbe eines Eintrags der Kalenderliste; ohne brauchbare Angabe Blau. */
export function googleCalendarColor(entry: {
  backgroundColor?: unknown;
  colorId?: unknown;
}): CalendarColor {
  if (typeof entry.backgroundColor === "string") {
    const fromHex = colorFromHex(entry.backgroundColor);
    if (fromHex) return fromHex;
  }
  if (typeof entry.colorId === "string" && COLOR_IDS[entry.colorId]) {
    return COLOR_IDS[entry.colorId] as CalendarColor;
  }
  return "blau";
}
