/**
 * Wissen (#56, Variante A, Migration 39): der **Typ** entscheidet, nicht Thema oder Projekt.
 * Notizen von Typen mit „zählt als Wissen“ stehen im Wissen – mit und ohne Projekt. „Noch
 * einordnen“ sind Notizen anderer Typen **ohne Projekt** (vor allem Ideen). Reines Modell ohne
 * „use client“ (Tests, Server).
 */
import type { NoteRow, NoteType } from "./types";

type Classified = Pick<NoteRow, "type" | "project_id">;

export const isKnowledgeNote = (note: Classified, knowledge: ReadonlySet<NoteType>): boolean =>
  knowledge.has(note.type);

/** Noch einordnen: zählt nicht als Wissen und hängt an keinem Projekt (Projektnotizen sind eingeordnet). */
export const needsSorting = (note: Classified, knowledge: ReadonlySet<NoteType>): boolean =>
  !knowledge.has(note.type) && !note.project_id;

export interface KnowledgeSplit<T extends Classified> {
  /** zählt als Wissen (Typ) */
  knowledge: T[];
  /** noch einordnen (anderer Typ, ohne Projekt) */
  unsorted: T[];
  /** alles, was nicht als Wissen zählt (für den leisen Hinweis unter der Liste) */
  notKnowledge: number;
}

export function splitKnowledge<T extends Classified>(
  notes: readonly T[],
  knowledge: ReadonlySet<NoteType>,
): KnowledgeSplit<T> {
  const result: KnowledgeSplit<T> = { knowledge: [], unsorted: [], notKnowledge: 0 };
  for (const note of notes) {
    if (isKnowledgeNote(note, knowledge)) result.knowledge.push(note);
    else {
      result.notKnowledge += 1;
      if (!note.project_id) result.unsorted.push(note);
    }
  }
  return result;
}
