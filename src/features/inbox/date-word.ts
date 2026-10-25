/**
 * Datumswort im Text (nur Sheet „Festhalten“, E44 H3): „heute“, „morgen“, „übermorgen“ und
 * Wochentage („Montag“ … „Sonntag“ → nächster solcher Tag, heute zählt nicht) als ganzes Wort,
 * Groß-/Kleinschreibung egal. Der Text bleibt unverändert – es wird nichts herausgeschnitten.
 * Reine Funktion: „heute“ kommt von außen (`src/lib/dates.ts` liefert den Tag).
 */
import { addDays, type IsoDate, isoWeekday } from "@/lib/dates";

export interface DateWord {
  /** das Wort, wie getippt */
  word: string;
  date: IsoDate;
}

const WEEKDAYS = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];

function resolve(word: string, today: IsoDate): IsoDate | null {
  const w = word.toLocaleLowerCase("de");
  if (w === "heute") return today;
  if (w === "morgen") return addDays(today, 1);
  if (w === "übermorgen" || w === "uebermorgen") return addDays(today, 2);
  const index = WEEKDAYS.indexOf(w);
  if (index === -1) return null;
  const ahead = (index - isoWeekday(today) + 7) % 7;
  return addDays(today, ahead === 0 ? 7 : ahead);
}

/** Erstes erkanntes Datumswort (ganzes Wort) oder null. */
export function parseDateWord(text: string, today: IsoDate): DateWord | null {
  for (const match of text.matchAll(/[\p{L}]+/gu)) {
    const date = resolve(match[0], today);
    if (date) return { word: match[0], date };
  }
  return null;
}
