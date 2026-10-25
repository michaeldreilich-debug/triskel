/**
 * Wochenrückblick (B12) als reine Funktionen: Leitfragen und Antworten, Zahlen aus week_stats,
 * Wochen mit Lücken, Tagesverlauf und „An diesem Tag“.
 */
import type { MilestoneRow, ProjectRow } from "@/features/projects/types";
import type { TaskRow } from "@/features/tasks/types";
import { recapPeriodSlug } from "@/lib/app-links";
import {
  addDays,
  addMonths,
  berlinDate,
  berlinTime,
  formatMonth,
  formatRange,
  type IsoDate,
  isoWeekNumber,
  isoWeekRange,
  isoWeekYear,
  monthRange,
  startOfMonth,
} from "@/lib/dates";
import { stableId } from "@/lib/id";
import {
  type ActivityDay,
  type ActivityEntry,
  QUESTION_TYPES,
  type QuestionType,
  type RecapQuestion,
  type RecapRow,
  type RecapWrite,
  type ReviewState,
  type WeekStats,
} from "./types";

/** Abschnitt der Gesprächsfelder (#66). */
export const CONVERSATION_SECTION = "Gespräch";

/**
 * Gesprächsfelder (#66): feste Schlüssel, Art Text, eigener Abschnitt unter den Leitfragen. Die KI
 * nimmt die deutschen Namen als Eingabe-Schlüssel (`update_recap`). Migration 41 trägt sie in
 * die eigene Vorlage und offene Rückblicke nach.
 */
export const CONVERSATION_QUESTIONS: RecapQuestion[] = [
  { key: "conversation", label: "Gespräch", type: "text", section: CONVERSATION_SECTION },
  { key: "hypothesis", label: "Hypothese", type: "text", section: CONVERSATION_SECTION },
  {
    key: "counter_hypothesis",
    label: "Gegenhypothese",
    type: "text",
    section: CONVERSATION_SECTION,
  },
  { key: "plain_talk", label: "Klartext", type: "text", section: CONVERSATION_SECTION },
  { key: "last_week", label: "Bezug zur Vorwoche", type: "text", section: CONVERSATION_SECTION },
];

/** Eingebaute Leitfragen (wie die Vorlage „Wochenrückblick“ aus Migration 09, plus Gespräch). */
export const DEFAULT_QUESTIONS: RecapQuestion[] = [
  { key: "mood", label: "Wie ging es mir (1–5)?", type: "scale" },
  { key: "good", label: "Was lief gut?", type: "text" },
  { key: "hard", label: "Was war schwer?", type: "text" },
  { key: "takeaway", label: "Was nehme ich mit?", type: "text" },
  { key: "energy", label: "Energie", type: "scale" },
  { key: "sport", label: "Sport", type: "number" },
  { key: "relations", label: "Beziehungen", type: "scale" },
  { key: "learning", label: "Lernen", type: "scale" },
  { key: "focus_next", label: "Fokus nächste Woche (3 Punkte)", type: "list", count: 3 },
  ...CONVERSATION_QUESTIONS,
];

/**
 * Hängt fehlende Gesprächsfelder an (nur Schlüssel, die es noch nicht gibt – nichts wird
 * überschrieben). Dasselbe tut Migration 41 in der Datenbank; hier für Tests und Gegenprobe.
 */
export function withConversationFields(questions: RecapQuestion[]): RecapQuestion[] {
  const have = new Set(questions.map((q) => q.key));
  const missing = CONVERSATION_QUESTIONS.filter((q) => !have.has(q.key));
  return missing.length ? [...questions, ...missing] : questions;
}

/** Aufeinanderfolgende Fragen mit gleichem Abschnitt zusammenfassen (ohne Abschnitt: `null`). */
export function groupBySection(
  questions: RecapQuestion[],
): { section: string | null; questions: RecapQuestion[] }[] {
  const groups: { section: string | null; questions: RecapQuestion[] }[] = [];
  for (const question of questions) {
    const section = question.section?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.questions.push(question);
    else groups.push({ section, questions: [question] });
  }
  return groups;
}

/** Antworten mit eigener Spalte in `recaps` (vergleichbar über die Wochen); der Rest in `answers`. */
export const SCALE_COLUMNS = ["mood", "energy", "relations", "learning"] as const;
type ScaleColumn = (typeof SCALE_COLUMNS)[number];
const isScaleColumn = (key: string): key is ScaleColumn =>
  (SCALE_COLUMNS as readonly string[]).includes(key);

/** Feste Schlüssel und ihre Art – in der Vorlage nicht umzudeuten (B11). */
export const FIXED_KEYS: Readonly<Record<string, QuestionType>> = {
  mood: "scale",
  energy: "scale",
  relations: "scale",
  learning: "scale",
  sport: "number",
  focus_next: "list",
};

const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Leitfragen aus Vorlage oder Rückblick lesen; Ungültiges fällt weg, feste Schlüssel behalten ihre
 * Art. `keepEmpty`: Fragen ohne Text behalten (beim Bearbeiten der Vorlage, B11).
 */
export function parseQuestions(raw: unknown, { keepEmpty = false } = {}): RecapQuestion[] {
  const list = Array.isArray(raw) ? raw : isObject(raw) ? raw.questions : null;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: RecapQuestion[] = [];
  for (const item of list) {
    if (!isObject(item)) continue;
    const key = str(item.key)?.trim();
    const label = str(item.label)?.trim();
    const type = str(item.type) as QuestionType | null;
    if (!key || (!label && !keepEmpty) || !type) continue;
    if (!(QUESTION_TYPES as readonly string[]).includes(type)) continue;
    if (seen.has(key)) continue;
    const fixed = FIXED_KEYS[key];
    if (fixed && fixed !== type) continue;
    seen.add(key);
    const question: RecapQuestion = { key, label: label ?? "", type };
    const section = str(item.section)?.trim();
    if (section) question.section = section;
    if (type === "list") question.count = Math.min(Math.max(num(item.count) ?? 3, 1), 10);
    result.push(question);
  }
  return result;
}

/**
 * Leitfragen eines Monatsrückblicks (S1a): dieselbe Vorlage wie die Woche – der Fokus gilt dem
 * nächsten Monat („Fokus nächste Woche“ → „Fokus nächster Monat“, eigene Texte bleiben).
 */
export function monthQuestions(questions: RecapQuestion[]): RecapQuestion[] {
  return questions.map((q) =>
    q.key === "focus_next"
      ? {
          ...q,
          label: /nächste Woche/i.test(q.label)
            ? q.label.replace(/nächste Woche/i, "nächster Monat")
            : q.label,
        }
      : q.key === "last_week" && /Vorwoche/i.test(q.label)
        ? {
            ...q,
            label: q.label.replace(/Vorwoche/i, "Vormonat").replace("zur Vormonat", "zum Vormonat"),
          }
        : q,
  );
}

/** Fragen eines Rückblicks: der Schnappschuss beim Anlegen, sonst die eingebauten. */
export const questionsOf = (
  recap: Pick<RecapRow, "questions"> & Partial<Pick<RecapRow, "kind">>,
): RecapQuestion[] =>
  recap.questions.length > 0
    ? recap.questions
    : recap.kind === "monat"
      ? monthQuestions(DEFAULT_QUESTIONS)
      : DEFAULT_QUESTIONS;

/**
 * Feste ID je Nutzer, Art und Zeitraum (D-3): Legen zwei Geräte (oder Tabs mit veraltetem Cache,
 * oder die KI) denselben Rückblick an, treffen sie sich auf derselben Zeile – sonst scheiterte das
 * zweite am Eindeutigkeits-Index und alle Antworten danach. Gilt auch für den Monatsrückblick.
 */
export function recapId(userId: string, kind: RecapRow["kind"], start: IsoDate): string {
  return stableId(`recap:${userId}:${kind}:${start}`);
}

/** Zeitraum eines Rückblicks zu einem beliebigen Tag: ISO-Woche (Mo–So) bzw. Kalendermonat. */
export const periodOf = (kind: RecapRow["kind"], date: IsoDate) =>
  kind === "monat" ? monthRange(date) : isoWeekRange(date);

export type AnswerValue = number | string | string[] | null;

export function answerOf(recap: RecapRow, question: RecapQuestion): AnswerValue {
  const { key, type } = question;
  if (isScaleColumn(key)) return recap[key];
  if (key === "sport") return recap.sport;
  if (key === "focus_next") return recap.focus_next;
  const value = recap.answers[key];
  if (type === "list") return Array.isArray(value) ? value.map((v) => String(v ?? "")) : [];
  if (type === "text") return str(value) ?? "";
  return num(value);
}

/** Änderung einer Antwort als Werte zum Speichern (Spalte oder ganzes `answers`-Objekt). */
export function answerPatch(
  recap: RecapRow,
  question: RecapQuestion,
  value: AnswerValue,
): Partial<RecapWrite> {
  const { key } = question;
  if (isScaleColumn(key)) return { [key]: num(value) } as Partial<RecapWrite>;
  if (key === "sport") return { sport: num(value) };
  if (key === "focus_next") return { focus_next: Array.isArray(value) ? value : [] };
  return { answers: { ...recap.answers, [key]: value } };
}

/**
 * Rückblick davor (Woche: die Woche davor, Monat: der Monat davor), ohne Papierkorb – für
 * „Bezug zur Vorwoche“ (#66).
 */
export function previousRecap(recaps: RecapRow[], recap: RecapRow): RecapRow | null {
  const start =
    recap.kind === "monat"
      ? startOfMonth(addMonths(recap.period_start, -1))
      : addDays(recap.period_start, -7);
  return findRecap(recaps, recap.kind, start);
}

/** Zum Nachlesen aus dem Rückblick davor: Fokus (Liste) und Mitnehmen (Text); `null`, wenn beides leer ist. */
export function previousHints(
  previous: RecapRow | null,
): { focus: string[]; takeaway: string } | null {
  if (!previous) return null;
  const focus = previous.focus_next.map((f) => f.trim()).filter(Boolean);
  const takeaway = (str(previous.answers.takeaway) ?? "").trim();
  return focus.length || takeaway ? { focus, takeaway } : null;
}

export function isAnswered(recap: RecapRow, question: RecapQuestion): boolean {
  const value = answerOf(recap, question);
  if (Array.isArray(value)) return value.some((v) => v.trim() !== "");
  if (typeof value === "string") return value.trim() !== "";
  return value !== null;
}

/* ------------------------------------------------------------------ */
/* Zahlen (week_stats bzw. Snapshot)                                  */
/* ------------------------------------------------------------------ */

const entries = (raw: unknown): ActivityEntry[] =>
  Array.isArray(raw)
    ? raw.filter(isObject).map((e) => ({
        id: String(e.id ?? ""),
        title: str(e.title) ?? "",
        at: str(e.at) ?? "",
        area_id: str(e.area_id),
        project_id: str(e.project_id),
      }))
    : [];

const titled = (raw: unknown) =>
  Array.isArray(raw)
    ? raw.filter(isObject).map((p) => ({ id: String(p.id ?? ""), title: str(p.title) ?? "" }))
    : [];

export function parseStats(raw: unknown): WeekStats | null {
  if (!isObject(raw)) return null;
  const period = isObject(raw.period) ? raw.period : {};
  const tasks = isObject(raw.tasks_done) ? raw.tasks_done : {};
  const focus = isObject(raw.focus_days) ? raw.focus_days : {};
  return {
    period: { start: str(period.start) ?? "", end: str(period.end) ?? "" },
    tasksDone: num(tasks.total) ?? 0,
    byArea: Array.isArray(tasks.by_area)
      ? tasks.by_area.filter(isObject).map((a) => ({
          area_id: str(a.area_id),
          name: str(a.name),
          count: num(a.count) ?? 0,
        }))
      : [],
    milestonesDone: num(raw.milestones_done) ?? 0,
    notesCreated: num(raw.notes_created),
    focusDays: { achieved: num(focus.achieved) ?? 0, planned: num(focus.planned) ?? 0 },
    stuckProjects: titled(raw.stuck_projects),
    staleProjects: titled(raw.stale_projects),
    activity: Array.isArray(raw.activity)
      ? raw.activity.filter(isObject).map((d) => ({
          date: str(d.date) ?? "",
          done: entries(d.done),
          milestones: entries(d.milestones),
          notes_created: entries(d.notes_created),
          notes_edited: entries(d.notes_edited),
        }))
      : null,
  };
}

/** Stand des Wochenreviews lesen (S1c); Unbekanntes fällt weg, nie gestartet = leer. */
export function parseReview(raw: unknown): ReviewState {
  const value = isObject(raw) ? raw : {};
  const step = num(value.step);
  return {
    step: step === null ? 0 : Math.min(Math.max(Math.trunc(step), 0), REVIEW_STEP_COUNT - 1),
    projects: Array.isArray(value.projects)
      ? [...new Set(value.projects.filter((p): p is string => typeof p === "string"))]
      : [],
    started_at: str(value.started_at),
    finished_at: str(value.finished_at),
  };
}

/** Anzahl der Schritte im Wochenreview (Inbox, Projekte, Fälliges, Rückblick, Fokus). */
export const REVIEW_STEP_COUNT = 5;

/** Datensatz aus Server oder Warteschlange in eine vollständige Zeile bringen. */
export function toRecap(row: Record<string, unknown> & { id: string }): RecapRow {
  const now = new Date().toISOString();
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : String(v ?? ""))) : [];
  return {
    id: row.id,
    kind: row.kind === "monat" ? "monat" : "woche",
    period_start: str(row.period_start) ?? "",
    period_end: str(row.period_end) ?? "",
    mood: num(row.mood),
    energy: num(row.energy),
    sport: num(row.sport),
    relations: num(row.relations),
    learning: num(row.learning),
    answers: isObject(row.answers) ? row.answers : {},
    focus_next: strings(row.focus_next),
    themes: strings(row.themes),
    questions: parseQuestions(row.questions),
    stats: parseStats(row.stats),
    review: parseReview(row.review),
    closed_at: str(row.closed_at),
    created_at: str(row.created_at) ?? now,
    updated_at: str(row.updated_at) ?? now,
    deleted_at: str(row.deleted_at),
  };
}

export const weekLabel = (start: IsoDate) => `KW ${isoWeekNumber(start)}`;

/** „Wochenrückblick KW 42“ bzw. „Monatsrückblick 10/2026“ */
export function recapTitle(recap: Pick<RecapRow, "kind" | "period_start">): string {
  if (recap.kind === "monat") {
    const [y, m] = recap.period_start.split("-");
    return `Monatsrückblick ${m}/${y}`;
  }
  return `Wochenrückblick ${weekLabel(recap.period_start)}`;
}

export const recapRange = (recap: Pick<RecapRow, "period_start" | "period_end">) =>
  formatRange(recap.period_start, recap.period_end);

/** Kurz für Kopf und Listen: „KW 42“ bzw. „Oktober 2026“. */
export const recapLabel = (recap: Pick<RecapRow, "kind" | "period_start">) =>
  recap.kind === "monat" ? formatMonth(recap.period_start) : weekLabel(recap.period_start);

/**
 * Adresse eines Zeitraums, auch ohne Rückblick (Kalender, Heute): „woche-2026-10-12“ bzw.
 * „monat-2026-10“. Die Rückblick-Seite öffnet den vorhandenen oder bietet „schreiben“ an.
 */
export const periodSlug = recapPeriodSlug;

export function parsePeriodSlug(
  slug: string,
): { kind: RecapRow["kind"]; start: IsoDate; end: IsoDate } | null {
  const month = /^monat-(\d{4})-(\d{2})$/.exec(slug);
  if (month) {
    const m = Number(month[2]);
    if (m < 1 || m > 12) return null;
    return { kind: "monat", ...monthRange(`${month[1]}-${month[2]}-01`) };
  }
  const week = /^woche-(\d{4}-\d{2}-\d{2})$/.exec(slug);
  if (week && !Number.isNaN(Date.parse(`${week[1]}T00:00:00Z`))) {
    return { kind: "woche", ...isoWeekRange(week[1] as IsoDate) };
  }
  return null;
}

/** Der (älteste) Rückblick einer Art für einen Zeitraum, ohne Papierkorb. */
export function findRecap(
  recaps: RecapRow[],
  kind: RecapRow["kind"],
  start: IsoDate,
): RecapRow | null {
  let found: RecapRow | null = null;
  for (const r of recaps) {
    if (r.deleted_at || r.kind !== kind || r.period_start !== start) continue;
    if (!found || found.created_at > r.created_at) found = r;
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Verlauf: Wochen mit Lücken                                         */
/* ------------------------------------------------------------------ */

export interface WeekSlot {
  start: IsoDate;
  end: IsoDate;
  week: number;
  year: number;
  recap: RecapRow | null;
  /** die laufende Woche */
  current: boolean;
}

/**
 * Alle Wochen von der ältesten mit Rückblick bis zur laufenden, neueste zuerst. Wochen ohne
 * Rückblick bleiben als Lücke sichtbar (E24), die laufende Woche steht immer oben.
 */
export function recapWeeks(recaps: RecapRow[], today: IsoDate): WeekSlot[] {
  const current = isoWeekRange(today);
  const byWeek = new Map<IsoDate, RecapRow>();
  for (const recap of recaps) {
    if (recap.kind !== "woche" || recap.deleted_at || !recap.period_start) continue;
    const start = isoWeekRange(recap.period_start).start;
    const known = byWeek.get(start);
    if (!known || known.created_at > recap.created_at) byWeek.set(start, recap);
  }
  const earliest = [...byWeek.keys()].reduce(
    (min, start) => (start < min ? start : min),
    current.start,
  );
  const slots: WeekSlot[] = [];
  // auch Rückblicke für spätere Wochen (vorgeschrieben) zeigen
  const latest = [...byWeek.keys()].reduce((max, s) => (s > max ? s : max), current.start);
  for (let start = latest; start >= earliest; start = addDays(start, -7)) {
    slots.push({
      start,
      end: addDays(start, 6),
      week: isoWeekNumber(start),
      year: isoWeekYear(start),
      recap: byWeek.get(start) ?? null,
      current: start === current.start,
    });
  }
  return slots;
}

/** Lücken: vergangene Wochen (bzw. Monate) ohne Rückblick. */
export const gapCount = (slots: Array<{ recap: RecapRow | null; end: IsoDate }>, today: IsoDate) =>
  slots.filter((s) => !s.recap && s.end < today).length;

/* ------------------------------------------------------------------ */
/* Monatsrückblick (S1a): Monate mit Lücken, Wochen des Monats         */
/* ------------------------------------------------------------------ */

export interface MonthSlot {
  start: IsoDate;
  end: IsoDate;
  /** „Oktober 2026“ */
  label: string;
  recap: RecapRow | null;
  /** der laufende Monat */
  current: boolean;
}

/** Monat, zu dem eine Woche zählt: der ihres Donnerstags (wie die ISO-Woche zum Jahr). */
export const monthOfWeek = (weekStart: IsoDate): IsoDate =>
  startOfMonth(addDays(isoWeekRange(weekStart).start, 3));

/**
 * Alle Monate vom ältesten Rückblick (Woche oder Monat) bis zum laufenden, neueste zuerst. Monate
 * ohne Monatsrückblick bleiben als Lücke sichtbar – auch, wenn es dort nur Wochenrückblicke gibt.
 */
export function recapMonths(recaps: RecapRow[], today: IsoDate): MonthSlot[] {
  const current = startOfMonth(today);
  let earliest = current;
  let latest = current;
  for (const recap of recaps) {
    if (recap.deleted_at || !recap.period_start) continue;
    const start =
      recap.kind === "monat" ? startOfMonth(recap.period_start) : monthOfWeek(recap.period_start);
    if (start < earliest) earliest = start;
    if (recap.kind === "monat" && start > latest) latest = start;
  }
  const slots: MonthSlot[] = [];
  for (let start = latest; start >= earliest; start = addMonths(start, -1)) {
    slots.push({
      ...monthRange(start),
      label: formatMonth(start),
      recap: findRecap(recaps, "monat", start),
      current: start === current,
    });
  }
  return slots;
}

/**
 * Welcher Monat jetzt dran ist: in der ersten Woche eines Monats noch der vorige, solange sein
 * Rückblick fehlt oder offen ist – sonst der laufende.
 */
export function dueMonth(slots: MonthSlot[], today: IsoDate): MonthSlot | null {
  const current = slots.find((s) => s.current) ?? null;
  if (Number(today.slice(8, 10)) > 7) return current;
  const previous = slots.find((s) => s.end === addDays(startOfMonth(today), -1));
  return previous && !previous.recap?.closed_at ? previous : current;
}

export interface MonthWeek {
  start: IsoDate;
  end: IsoDate;
  week: number;
  recap: RecapRow | null;
}

/** Die Wochen eines Monats (Donnerstag im Monat) mit ihren Wochenrückblicken. */
export function monthWeeks(month: IsoDate, recaps: RecapRow[]): MonthWeek[] {
  const { start, end } = monthRange(month);
  let monday = isoWeekRange(start).start;
  if (addDays(monday, 3) < start) monday = addDays(monday, 7);
  const weeks: MonthWeek[] = [];
  for (; addDays(monday, 3) <= end; monday = addDays(monday, 7)) {
    weeks.push({
      start: monday,
      end: addDays(monday, 6),
      week: isoWeekNumber(monday),
      recap: findRecap(recaps, "woche", monday),
    });
  }
  return weeks;
}

/** Werte, die über die Wochen vergleichbar sind (eigene Spalten). */
export const VALUE_KEYS = ["mood", "energy", "sport", "relations", "learning"] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];

export const VALUE_LABELS: Record<ValueKey, string> = {
  mood: "Stimmung",
  energy: "Energie",
  sport: "Sport",
  relations: "Beziehungen",
  learning: "Lernen",
};

/** Skalen 1–5; Sport ist eine Zahl (Einheiten oder Stunden). */
export const isScaleValue = (key: ValueKey) => key !== "sport";

/** Durchschnitt (Skalen) bzw. Summe (Sport) über Rückblicke; null, wenn nichts eingetragen ist. */
export function aggregateValue(recaps: RecapRow[], key: ValueKey): number | null {
  const values = recaps.map((r) => r[key]).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return isScaleValue(key) ? sum / values.length : sum;
}

/** „3,5“ – eine Nachkommastelle nur, wenn nötig. */
export const formatValue = (value: number) =>
  value.toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Themen und Muster, die in mehreren Rückblicken vorkommen: häufigste zuerst. */
export function themeCounts(recaps: RecapRow[]): Array<{ theme: string; count: number }> {
  const counts = new Map<string, number>();
  for (const recap of recaps) {
    if (recap.deleted_at) continue;
    for (const theme of new Set(recap.themes)) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme, "de"));
}

/* ------------------------------------------------------------------ */
/* Verlauf (S1b): Werte über Wochen bzw. Monate                        */
/* ------------------------------------------------------------------ */

export interface HistoryPeriod {
  start: IsoDate;
  end: IsoDate;
  /** kurz für die Achse: „KW 42“ bzw. „Okt“ */
  short: string;
  /** voll: „KW 42 · 12.–18.10.2026“ bzw. „Oktober 2026“ */
  title: string;
  recap: RecapRow | null;
  /** der laufende Zeitraum (noch keine Lücke) */
  current: boolean;
  /** vor dem ersten Rückblick dieser Art – keine Lücke, nur leer */
  beforeFirst: boolean;
}

export interface HistoryFilter {
  kind: RecapRow["kind"];
  /** null = die letzten `last` Zeiträume bis heute */
  year: number | null;
  last?: number;
}

/** Jahr eines Rückblicks: Wochen nach ihrem ISO-Wochenjahr (KW 01/2026 beginnt 2025). */
export const recapYear = (recap: Pick<RecapRow, "kind" | "period_start">) =>
  recap.kind === "woche" ? isoWeekYear(recap.period_start) : Number(recap.period_start.slice(0, 4));

/** Jahre mit Rückblicken dieser Art – und das laufende –, neueste zuerst. */
export function historyYears(recaps: RecapRow[], kind: RecapRow["kind"], today: IsoDate) {
  const years = new Set<number>([
    kind === "woche" ? isoWeekYear(today) : Number(today.slice(0, 4)),
  ]);
  for (const r of recaps) if (!r.deleted_at && r.kind === kind) years.add(recapYear(r));
  return [...years].sort((a, b) => b - a);
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

/**
 * Zeiträume für den Verlauf, älteste zuerst (links → rechts): die letzten zwölf bis heute oder
 * ein ganzes Jahr (im laufenden Jahr bis heute). Ohne Rückblick bleibt der Zeitraum als Lücke.
 */
export function historyPeriods(
  recaps: RecapRow[],
  filter: HistoryFilter,
  today: IsoDate,
): HistoryPeriod[] {
  const last = filter.last ?? 12;
  const periods: HistoryPeriod[] = [];
  // Lücken zählen erst ab dem ersten Rückblick dieser Art (wie im Reiter Wochen, E24)
  const first = recaps
    .filter((r) => !r.deleted_at && r.kind === filter.kind && r.period_start)
    .reduce<IsoDate | null>(
      (min, r) => (!min || r.period_start < min ? r.period_start : min),
      null,
    );
  const beforeFirst = (start: IsoDate) => !first || start < first;
  if (filter.kind === "woche") {
    const current = isoWeekRange(today).start;
    let starts: IsoDate[];
    if (filter.year === null) {
      starts = Array.from({ length: last }, (_, i) => addDays(current, -7 * (last - 1 - i)));
    } else {
      // erster Montag des ISO-Jahres: die Woche mit dem 4. Januar
      let monday = isoWeekRange(`${filter.year}-01-04`).start;
      starts = [];
      for (; isoWeekYear(monday) === filter.year && monday <= current; monday = addDays(monday, 7))
        starts.push(monday);
    }
    for (const start of starts) {
      const end = addDays(start, 6);
      periods.push({
        start,
        end,
        short: String(isoWeekNumber(start)),
        title: `KW ${isoWeekNumber(start)} · ${formatRange(start, end)}`,
        recap: findRecap(recaps, "woche", start),
        current: start === current,
        beforeFirst: beforeFirst(isoWeekRange(start).start),
      });
    }
    return periods;
  }
  const current = startOfMonth(today);
  const starts =
    filter.year === null
      ? Array.from({ length: last }, (_, i) => addMonths(current, -(last - 1 - i)))
      : Array.from(
          { length: 12 },
          (_, i) => `${filter.year}-${String(i + 1).padStart(2, "0")}-01`,
        ).filter((start) => start <= current);
  for (const start of starts) {
    periods.push({
      ...monthRange(start),
      short: MONTH_SHORT[Number(start.slice(5, 7)) - 1] ?? "",
      title: formatMonth(start),
      recap: findRecap(recaps, "monat", start),
      current: start === current,
      beforeFirst: beforeFirst(start),
    });
  }
  return periods;
}

/** Lücken im Verlauf: abgelaufene Zeiträume ohne Rückblick. */
export const historyGaps = (periods: HistoryPeriod[], today: IsoDate) =>
  periods.filter((p) => !p.recap && !p.beforeFirst && p.end < today).length;

/** Aktivität eines Monats je Woche (aus week_stats.activity, nur Tage im Monat). */
export function weekActivity(days: ActivityDay[] | null, week: Pick<MonthWeek, "start" | "end">) {
  const within = (days ?? []).filter((d) => d.date >= week.start && d.date <= week.end);
  return {
    done: within.reduce((n, d) => n + d.done.length, 0),
    milestones: within.reduce((n, d) => n + d.milestones.length, 0),
    notes: within.reduce((n, d) => n + d.notes_created.length, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Tagesverlauf (E24): auf Heute live, im Rückblick aus week_stats    */
/* ------------------------------------------------------------------ */

export type DayEntryKind = "done" | "milestone" | "note_new" | "note_edit";

export interface DayEntry {
  kind: DayEntryKind;
  id: string;
  title: string;
  at: string;
  /** „HH:mm“ in Europe/Berlin */
  time: string;
  /** nur Meilensteine: Projekt (für den Link) */
  projectId?: string | null;
}

const byTime = (a: DayEntry, b: DayEntry) => Date.parse(a.at) - Date.parse(b.at);

/** Einträge eines Tages aus week_stats.activity (chronologisch). */
export function activityEntries(day: ActivityDay): DayEntry[] {
  const map = (kind: DayEntryKind, list: ActivityEntry[]) =>
    list.map((e) => ({
      kind,
      id: e.id,
      title: e.title,
      at: e.at,
      time: berlinTime(e.at),
      projectId: e.project_id ?? null,
    }));
  return [
    ...map("done", day.done),
    ...map("milestone", day.milestones),
    ...map("note_new", day.notes_created),
    ...map("note_edit", day.notes_edited),
  ].sort(byTime);
}

/** Kurzfassung eines Tages: „4 erledigt · 1 Meilenstein · 2 Notizen“. */
export function daySummary(day: ActivityDay): string {
  const parts: string[] = [];
  if (day.done.length) parts.push(`${day.done.length} erledigt`);
  if (day.milestones.length) {
    parts.push(
      day.milestones.length === 1 ? "1 Meilenstein" : `${day.milestones.length} Meilensteine`,
    );
  }
  const notes = day.notes_created.length + day.notes_edited.length;
  if (notes) parts.push(notes === 1 ? "1 Notiz" : `${notes} Notizen`);
  return parts.join(" · ");
}

export interface DayActivityInput {
  day: IsoDate;
  tasks: TaskRow[];
  milestones: MilestoneRow[];
  projects: ProjectRow[];
  notes: Array<{
    id: string;
    title: string;
    area_id: string;
    created_at: string;
    edited_at: string;
    deleted_at?: string | null;
  }>;
  /** gewählter Bereich (null = alle) */
  area: string | null;
}

/** Was an einem Tag erledigt, erreicht, angelegt oder bearbeitet wurde (live aus dem Cache). */
export function dayActivity(input: DayActivityInput): ActivityDay {
  const { day, area } = input;
  const on = (at: string | null | undefined) => !!at && berlinDate(at) === day;
  const inArea = (areaId: string | null | undefined) => !area || areaId === area;
  const projectArea = new Map(input.projects.map((p) => [p.id, p.area_id]));
  const sorted = <T extends { at: string }>(list: T[]) =>
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return {
    date: day,
    done: sorted(
      input.tasks
        .filter((t) => !t.deleted_at && t.status === "erledigt" && on(t.completed_at))
        .filter((t) => inArea(t.area_id))
        .map((t) => ({ id: t.id, title: t.title, at: t.completed_at as string })),
    ),
    milestones: sorted(
      input.milestones
        .filter((m) => !m.deleted_at && on(m.done_at))
        .filter((m) => inArea(projectArea.get(m.project_id)))
        .map((m) => ({
          id: m.id,
          title: m.title,
          at: m.done_at as string,
          project_id: m.project_id,
        })),
    ),
    notes_created: sorted(
      input.notes
        .filter((n) => !n.deleted_at && on(n.created_at) && inArea(n.area_id))
        .map((n) => ({ id: n.id, title: n.title, at: n.created_at })),
    ),
    notes_edited: sorted(
      input.notes
        .filter(
          (n) =>
            !n.deleted_at && on(n.edited_at) && berlinDate(n.created_at) < day && inArea(n.area_id),
        )
        .map((n) => ({ id: n.id, title: n.title, at: n.edited_at })),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* „An diesem Tag“ (E24): was vor 1, 3, 12 Monaten entstand           */
/* ------------------------------------------------------------------ */

export const ON_THIS_DAY_MONTHS = [1, 3, 12] as const;

export const monthsAgoLabel = (months: number) =>
  months === 12 ? "Vor einem Jahr" : months === 1 ? "Vor einem Monat" : `Vor ${months} Monaten`;

export interface OnThisDayGroup {
  months: number;
  start: IsoDate;
  end: IsoDate;
  notes: { id: string; title: string }[];
  projects: { id: string; title: string }[];
  recaps: RecapRow[];
  tasksDone: number;
}

export interface OnThisDaySource {
  notes?: Array<{ id: string; title: string; created_at: string; deleted_at?: string | null }>;
  projects?: Array<{ id: string; title: string; created_at: string; deleted_at?: string | null }>;
  recaps?: RecapRow[];
  tasks?: TaskRow[];
}

/**
 * Für einen Tag (Notiz) oder eine Woche (Rückblick): was im selben Zeitraum vor 1, 3 und 12
 * Monaten entstand. Nur Zeiträume mit Inhalt; `excludeId` blendet den eigenen Eintrag aus.
 */
export function onThisDay(
  range: { start: IsoDate; end: IsoDate },
  source: OnThisDaySource,
  excludeId?: string,
): OnThisDayGroup[] {
  const groups: OnThisDayGroup[] = [];
  for (const months of ON_THIS_DAY_MONTHS) {
    const start = addMonths(range.start, -months);
    const end = addMonths(range.end, -months);
    const within = (at: string | null | undefined) => {
      if (!at) return false;
      const day = berlinDate(at);
      return day >= start && day <= end;
    };
    const created = <T extends { id: string; created_at: string; deleted_at?: string | null }>(
      list: T[] | undefined,
    ) => (list ?? []).filter((x) => !x.deleted_at && x.id !== excludeId && within(x.created_at));
    const group: OnThisDayGroup = {
      months,
      start,
      end,
      notes: created(source.notes).map(({ id, title }) => ({ id, title })),
      projects: created(source.projects).map(({ id, title }) => ({ id, title })),
      recaps: (source.recaps ?? []).filter(
        (r) =>
          !r.deleted_at && r.id !== excludeId && r.period_start <= end && r.period_end >= start,
      ),
      tasksDone: (source.tasks ?? []).filter(
        (t) => !t.deleted_at && t.status === "erledigt" && within(t.completed_at),
      ).length,
    };
    if (group.notes.length || group.projects.length || group.recaps.length || group.tasksDone) {
      groups.push(group);
    }
  }
  return groups;
}

export type HistoryRow<T extends { recap: RecapRow | null } = WeekSlot> =
  | { kind: "week"; slot: T }
  | { kind: "gaps"; slots: T[] };

/** Ab so vielen Lücken hintereinander steht eine zusammenfassende Zeile statt einzelner Wochen. */
export const GAP_RUN = 3;

/**
 * Verlauf als Zeilen: Rückblicke einzeln, längere Lücken zusammengefasst (wenig Rauschen),
 * einzelne Lücken bleiben mit „Nachholen“ sichtbar.
 */
export function historyRows<T extends { recap: RecapRow | null }>(slots: T[]): HistoryRow<T>[] {
  const rows: HistoryRow<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.length >= GAP_RUN) rows.push({ kind: "gaps", slots: run });
    else for (const slot of run) rows.push({ kind: "week", slot });
    run = [];
  };
  for (const slot of slots) {
    if (slot.recap) {
      flush();
      rows.push({ kind: "week", slot });
    } else run.push(slot);
  }
  flush();
  return rows;
}
