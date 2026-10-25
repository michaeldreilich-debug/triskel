import type { NoteSort } from "@/lib/ui-prefs";
import type { NoteRow } from "./types";

const time = (iso: string) => Date.parse(iso) || 0;

/** Ohne Titel ans Ende, sonst deutsche Sortierreihenfolge. */
const byTitle = (a: NoteRow, b: NoteRow) =>
  (a.title.trim() || "\uffff").localeCompare(b.title.trim() || "\uffff", "de");

/** Notizliste sortieren: zuletzt bearbeitet zuerst (bei Gleichstand nach Titel) oder A–Z. */
export function sortNotes(rows: NoteRow[], sort: NoteSort): NoteRow[] {
  const sorted = [...rows];
  if (sort === "az") return sorted.sort(byTitle);
  return sorted.sort((a, b) => time(b.edited_at) - time(a.edited_at) || byTitle(a, b));
}
