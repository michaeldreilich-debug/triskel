/**
 * Gesetzliche Feiertage in Baden-Württemberg (S2b) – berechnet, nicht gepflegt. Ohne "use client":
 * das Modell und später die Server-Seite (S2c) nutzen es ebenso.
 */
import { addDays, type IsoDate } from "@/lib/dates";

export interface Holiday {
  date: IsoDate;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Ostersonntag (Gauß/Anonymous-Algorithmus, gregorianisch). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Alle Feiertage eines Jahres in Baden-Württemberg, nach Datum. */
export function holidaysBW(year: number): Holiday[] {
  const easter = easterSunday(year);
  const fixed: Array<[string, string]> = [
    ["01-01", "Neujahr"],
    ["01-06", "Heilige Drei Könige"],
    ["05-01", "Tag der Arbeit"],
    ["10-03", "Tag der Deutschen Einheit"],
    ["11-01", "Allerheiligen"],
    ["12-25", "1. Weihnachtstag"],
    ["12-26", "2. Weihnachtstag"],
  ];
  const moving: Array<[number, string]> = [
    [-2, "Karfreitag"],
    [1, "Ostermontag"],
    [39, "Christi Himmelfahrt"],
    [50, "Pfingstmontag"],
    [60, "Fronleichnam"],
  ];
  return [
    ...fixed.map(([md, name]) => ({ date: `${year}-${md}`, name })),
    ...moving.map(([offset, name]) => ({ date: addDays(easter, offset), name })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

const cache = new Map<number, Map<IsoDate, string>>();

/** Name des Feiertags an einem Tag (BW), sonst null. */
export function holidayOn(date: IsoDate): string | null {
  const year = Number(date.slice(0, 4));
  let byDate = cache.get(year);
  if (!byDate) {
    byDate = new Map(holidaysBW(year).map((h) => [h.date, h.name]));
    cache.set(year, byDate);
  }
  return byDate.get(date) ?? null;
}
