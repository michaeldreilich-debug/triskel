import type { IsoDate } from "@/lib/dates";

/** Art einer Leitfrage im Rückblick (Vorlage `rueckblick`, Migration 09). */
export const QUESTION_TYPES = ["scale", "text", "number", "list"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  scale: "Skala 1–5",
  text: "Text",
  number: "Zahl",
  list: "Liste",
};

export interface RecapQuestion {
  /** Schlüssel der Antwort: eigene Spalte (mood, energy, …) oder Eintrag in `answers` */
  key: string;
  label: string;
  type: QuestionType;
  /** nur Listen: Anzahl der Punkte */
  count?: number;
  /** Abschnittsüberschrift (#66): aufeinanderfolgende Fragen mit gleichem Abschnitt stehen zusammen */
  section?: string;
}

/** Erledigte Aufgabe, Meilenstein oder Notiz im Tagesverlauf (week_stats.activity, Migration 14). */
export interface ActivityEntry {
  id: string;
  title: string;
  at: string;
  area_id?: string | null;
  project_id?: string | null;
}

export interface ActivityDay {
  date: IsoDate;
  done: ActivityEntry[];
  milestones: ActivityEntry[];
  notes_created: ActivityEntry[];
  notes_edited: ActivityEntry[];
}

/** Automatische Zahlen (week_stats); bei abgeschlossenen Rückblicken der Snapshot. */
export interface WeekStats {
  period: { start: IsoDate; end: IsoDate };
  tasksDone: number;
  byArea: { area_id: string | null; name: string | null; count: number }[];
  milestonesDone: number;
  notesCreated: number | null;
  focusDays: { achieved: number; planned: number };
  stuckProjects: { id: string; title: string }[];
  staleProjects: { id: string; title: string }[];
  /** fehlt in Snapshots vor Migration 14 */
  activity: ActivityDay[] | null;
}

export type RecapKind = "woche" | "monat";

/** Stand des geführten Wochenreviews (S1c, Migration 33) – am Wochenrückblick derselben Woche. */
export interface ReviewState {
  /** aktueller Schritt (0 = Inbox … 4 = Fokus) */
  step: number;
  /** Projekte, die im Schritt „Projekte durchgehen“ als durchgesehen markiert sind */
  projects: string[];
  started_at: string | null;
  finished_at: string | null;
}

export interface RecapRow {
  id: string;
  kind: RecapKind;
  period_start: IsoDate;
  period_end: IsoDate;
  mood: number | null;
  energy: number | null;
  sport: number | null;
  relations: number | null;
  learning: number | null;
  answers: Record<string, unknown>;
  focus_next: string[];
  themes: string[];
  questions: RecapQuestion[];
  stats: WeekStats | null;
  /** Wochenreview (S1c); leer = nie gestartet */
  review: ReviewState;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Spalten, die die App schreibt (stats und closed_at setzt close_recap). */
export type RecapWrite = Pick<
  RecapRow,
  | "kind"
  | "period_start"
  | "period_end"
  | "mood"
  | "energy"
  | "sport"
  | "relations"
  | "learning"
  | "answers"
  | "focus_next"
  | "themes"
  | "questions"
  | "review"
  | "deleted_at"
>;
