/**
 * Eingaben der KI auflösen (#33): Bereiche, Themen, Projekte, Meilensteine, Notizen und Aufgaben
 * gehen per ID oder per Name. Unklare Namen ergeben einen Fehler mit Vorschlägen, damit die KI
 * nachfragen oder genauer werden kann – geraten wird nie. Dazu die deutschen Werte der Werkzeuge
 * (Status, Priorität, Wiederholung) auf die Werte der Datenbank.
 */
import { normalize, scoreProject } from "@/features/inbox/parse";
import {
  DEFAULT_NOTE_TYPE,
  DEFAULT_NOTE_TYPES,
  type NoteType,
  type NoteTypeRow,
  noteTypeKey,
} from "@/features/notes/types";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "@/features/projects/types";
import { nextDueDate, presetToRule, type RecurrencePreset } from "@/features/tasks/recurrence";
import {
  type Priority,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskStatus,
} from "@/features/tasks/types";
import type { IsoDate } from "@/lib/dates";

/** Fehler in der Eingabe: Text geht so an die KI zurück. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value.trim());

/**
 * Hängt ein Eintrag an einem Projekt bzw. Thema, folgt sein Bereich diesem (Trigger der
 * Migrationen 04/05 setzen ihn zurück). Ein abweichender `bereich` würde still verworfen und
 * trotzdem als „geändert“ gemeldet (S-9) – deshalb ablehnen.
 */
export function assertAreaFollows(
  area: { id: string; name: string },
  owner: { kind: "Projekt" | "Thema"; name: string; area_id: string } | null,
): void {
  if (!owner || owner.area_id === area.id) return;
  const field = owner.kind === "Projekt" ? "projekt" : "thema";
  throw new ToolInputError(
    `Bereich folgt ${owner.kind === "Projekt" ? "dem Projekt" : "dem Thema"} „${owner.name}“ – für „${area.name}“ erst die Zuordnung lösen (${field}: "").`,
  );
}

const list = (names: string[], max = 15) =>
  names.length > max
    ? `${names.slice(0, max).join(", ")} … (${names.length} insgesamt)`
    : names.join(", ");

/** Treffergüte: ganzer Text wie bei @Projekt, sonst jedes Wort für sich (schwächer). */
function score(input: string, name: string): number {
  const whole = scoreProject(input, name);
  if (whole > 0) return whole;
  const words = normalize(input).split(" ").filter(Boolean);
  if (words.length < 2) return 0;
  const each = words.map((word) => scoreProject(word, name));
  return each.every((s) => s > 0) ? Math.min(...each) / 2 : 0;
}

/** Treffergüte: ganzer Name (100), Namensanfang (80); darunter Wortanfang, enthalten, Tippfehler */
const EXACT = 100;
const PREFIX = 80;

export interface ResolveOptions {
  /**
   * Lesen (Filter in list_… und search): auch ein eindeutiger schwächerer Treffer gilt (Wortanfang,
   * enthalten, Tippfehler). Schreiben (Standard) nimmt nur ID, genauen Namen oder eindeutigen
   * Namensanfang – ein Teiltreffer landete sonst im falschen Eintrag (K-1: „8“ traf Meilenstein
   * „7 Oberfläche Teil 2 (#34 … #48)“).
   */
  loose?: boolean;
}

/**
 * Eintrag per ID oder Name. Name: genau gleich (ohne Groß/Klein, Umlaute) gewinnt, sonst ein
 * eindeutiger Namensanfang. Alles Schwächere ergibt beim Schreiben eine Rückfrage mit den
 * Kandidaten (die KI fragt den Nutzer oder nimmt die ID), beim Lesen (`loose`) den eindeutigen
 * besten Treffer – geraten wird nie.
 */
export function resolveNamed<T extends { id: string }>(
  value: string,
  items: T[],
  nameOf: (item: T) => string,
  what: string,
  options: ResolveOptions = {},
): T {
  const input = value.trim();
  if (!input) throw new ToolInputError(`${what}: leer.`);
  if (isUuid(input)) {
    const found = items.find((item) => item.id.toLowerCase() === input.toLowerCase());
    if (!found) throw new ToolInputError(`${what} mit der ID ${input} gibt es nicht.`);
    return found;
  }
  const scored = items
    .map((item) => ({ item, value: score(input, nameOf(item)) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  const best = scored[0]?.value ?? 0;
  const hits = scored.filter((entry) => entry.value === best).map((entry) => entry.item);
  const sure = options.loose || best >= PREFIX;
  if (hits.length === 1 && sure) return hits[0] as T;
  if (hits.length > 1 && (sure || best === EXACT)) {
    throw new ToolInputError(
      `${what} „${input}“ ist nicht eindeutig: ${list(hits.map((h) => `${nameOf(h)} (${h.id})`))}. Bitte die ID angeben.`,
    );
  }
  if (scored.length > 0) {
    // nur Teiltreffer: nicht raten, sondern die Kandidaten nennen
    throw new ToolInputError(
      `${what} „${input}“ passt auf keinen Namen genau. Gemeint sein könnte: ${list(
        scored.map((entry) => `${nameOf(entry.item)} (${entry.item.id})`),
      )}. Zum Schreiben die ID, den genauen Namen oder einen eindeutigen Namensanfang angeben – im Zweifel den Nutzer fragen.`,
    );
  }
  throw new ToolInputError(
    `${what} „${input}“ nicht gefunden.${
      items.length ? ` Vorhanden: ${list(items.map(nameOf))}.` : ""
    }`,
  );
}

/** Lesen (Filter): auch ein eindeutiger schwächerer Treffer gilt. */
export function resolveNamedLoose<T extends { id: string }>(
  value: string,
  items: T[],
  nameOf: (item: T) => string,
  what: string,
): T {
  return resolveNamed(value, items, nameOf, what, { loose: true });
}

/* ------------------------------------------------------------------ */
/* Werte                                                              */
/* ------------------------------------------------------------------ */

export const TASK_STATUS_INPUT = TASK_STATUSES;
export const PROJECT_STATUS_INPUT = PROJECT_STATUSES;
export const PRIORITY_INPUT = ["hoch", "mittel", "niedrig"] as const;
export const RECURRENCE_INPUT = [
  "keine",
  "täglich",
  "werktags",
  "wöchentlich",
  "zweiwöchentlich",
  "monatlich",
  "jährlich",
] as const;

const PRIORITY_VALUE: Record<(typeof PRIORITY_INPUT)[number], Priority> = {
  hoch: 1,
  mittel: 2,
  niedrig: 3,
};

export function priorityOf(value: (typeof PRIORITY_INPUT)[number] | null): Priority | null {
  return value === null ? null : PRIORITY_VALUE[value];
}

const PRESET: Record<(typeof RECURRENCE_INPUT)[number], RecurrencePreset> = {
  keine: "none",
  täglich: "daily",
  werktags: "weekdays",
  wöchentlich: "weekly",
  zweiwöchentlich: "biweekly",
  monatlich: "monthly",
  jährlich: "yearly",
};

/**
 * Wiederholung als Vorgabe („wöchentlich“) oder eigene RRULE („FREQ=…“); Bezugstag ist die
 * Fälligkeit, sonst heute. null = keine Wiederholung.
 */
export function recurrenceOf(value: string, due: IsoDate | null, today: IsoDate): string | null {
  const input = value.trim();
  const preset = PRESET[input.toLocaleLowerCase("de") as keyof typeof PRESET];
  if (preset) return presetToRule(preset, due ?? today);
  const rule = input.replace(/^RRULE:/i, "").toUpperCase();
  if (!rule.startsWith("FREQ=") || nextDueDate(rule, due, today) === null) {
    throw new ToolInputError(
      `Wiederholung „${input}“ nicht verstanden. Erlaubt: ${RECURRENCE_INPUT.join(", ")} oder eine RRULE wie FREQ=WEEKLY;BYDAY=MO.`,
    );
  }
  return rule;
}

type TypeOption = Pick<NoteTypeRow, "key" | "name"> & { counts_as_knowledge?: boolean };

/**
 * Notiz-Typ aus der Eingabe (#34: eigene Typen): Schlüssel („protokoll“) oder Name
 * („Besprechung“), Groß/klein egal. Unbekannt: Fehler mit den vorhandenen Typen.
 */
export function resolveNoteType(value: string, types: TypeOption[]): NoteType {
  const input = value.trim();
  const lower = input.toLocaleLowerCase("de");
  const found =
    types.find((t) => t.key === input) ??
    types.find((t) => t.name.toLocaleLowerCase("de") === lower) ??
    types.find((t) => t.key === noteTypeKey(input, []));
  if (found) return found.key;
  throw new ToolInputError(
    `Notiz-Typ „${input}“ gibt es nicht. Vorhanden: ${list(types.map((t) => `${t.key} (${t.name})`))}. Neue Typen legt der Nutzer in der App an.`,
  );
}

/** Werteliste für den Überblick (Notiz-Typen des Nutzers, sonst die mitgelieferten). */
export function valueHelp(
  noteTypes: TypeOption[] = DEFAULT_NOTE_TYPES.map((t) => ({
    key: t.key,
    name: t.name,
    counts_as_knowledge: t.countsAsKnowledge,
  })),
): string {
  const knowledge = noteTypes.filter((t) => t.counts_as_knowledge);
  const pairs = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
    keys.map((key) => `${key} (${labels[key]})`).join(", ");
  return [
    `Notiz-Typen: ${noteTypes.map((t) => `${t.key} (${t.name})`).join(", ")}`,
    `Zählen als Wissen (nur diese stehen in der App unter „Wissen“): ${
      knowledge.length ? knowledge.map((t) => `${t.key} (${t.name})`).join(", ") : "keiner"
    }. Schnelle Notizen bleiben „${DEFAULT_NOTE_TYPE}“ (Standard) und ordnet der Nutzer später ein.`,
    `Aufgaben-Status: ${pairs<TaskStatus>(TASK_STATUSES, TASK_STATUS_LABELS)}`,
    `Projekt-Status: ${pairs<ProjectStatus>(PROJECT_STATUSES, PROJECT_STATUS_LABELS)}`,
    `Priorität: ${PRIORITY_INPUT.join(", ")}`,
    "Zuständig (Aufgaben): ich (Nutzer, Standard), ki (eigener Arbeitsschritt der KI, nur im Projekt sichtbar)",
    `Wiederholung: ${RECURRENCE_INPUT.join(", ")} oder RRULE`,
  ].join("\n");
}
