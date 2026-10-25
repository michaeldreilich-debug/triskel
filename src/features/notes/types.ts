/**
 * Notiz-Typen (#34, Migration 25): eigene Liste je Nutzer (Tabelle note_types). Notizen und
 * Vorlagen speichern den festen Schlüssel (`notes.type`), angezeigt wird der Name.
 */
export const DEFAULT_NOTE_TYPES = [
  { key: "idee", name: "Idee", countsAsKnowledge: false },
  { key: "wissen", name: "Wissen", countsAsKnowledge: true },
  { key: "protokoll", name: "Protokoll", countsAsKnowledge: false },
  { key: "anleitung", name: "Anleitung", countsAsKnowledge: true },
  { key: "journal", name: "Journal", countsAsKnowledge: false },
  { key: "rueckblick", name: "Rückblick", countsAsKnowledge: false },
] as const;

/**
 * Standardtyp (Rückmeldung 17.10.2026: „damit ich kurz was aufschreiben kann – Wissen ist es ja
 * explizit“, Migration 26): neue Notizen, unbekannte Schlüssel; lässt sich umbenennen, nicht löschen.
 */
export const DEFAULT_NOTE_TYPE = "idee";

/** Schlüssel eines Notiz-Typs, z. B. „protokoll“ oder ein eigener wie „besprechung“. */
export type NoteType = string;

const TYPE_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const parseNoteType = (value: string | null | undefined): NoteType =>
  typeof value === "string" && TYPE_KEY.test(value) ? value : DEFAULT_NOTE_TYPE;

export interface NoteTypeRow {
  id: string;
  key: NoteType;
  name: string;
  sort: string;
  /** Notizen dieses Typs stehen in „Wissen“ (Migration 39, #56) */
  counts_as_knowledge: boolean;
  deleted_at: string | null;
}

/** Schlüssel der aktiven Typen, die als Wissen zählen (Migration 39). */
export function knowledgeTypeKeys(
  types: ReadonlyArray<Pick<NoteTypeRow, "key" | "counts_as_knowledge" | "deleted_at">>,
): Set<NoteType> {
  return new Set(types.filter((t) => t.counts_as_knowledge && !t.deleted_at).map((t) => t.key));
}

/** Anzeigename eines Typs: eigener Name, sonst der mitgelieferte, sonst der Schlüssel. */
export function noteTypeName(
  types: ReadonlyArray<Pick<NoteTypeRow, "key" | "name">>,
  key: NoteType,
): string {
  return (
    types.find((t) => t.key === key)?.name ??
    DEFAULT_NOTE_TYPES.find((t) => t.key === key)?.name ??
    key
  );
}

/**
 * Typ für neue Notizen mit festem Wunsch (Schnellerfassung: „idee“, Projekt: „protokoll“) – hat
 * Der Nutzer ihn gelöscht, gilt der Standard.
 */
export function preferredNoteType(
  key: NoteType,
  types: ReadonlyArray<{ key: NoteType; deleted_at?: string | null }>,
): NoteType {
  return types.some((t) => t.key === key && !t.deleted_at) ? key : DEFAULT_NOTE_TYPE;
}

/**
 * Schlüssel für einen neuen Typ aus dem Namen („Besprechung“ → „besprechung“, „Über uns“ →
 * „ueber-uns“), eindeutig gegenüber allen bisherigen – auch gelöschten (die halten ihren).
 */
export function noteTypeKey(name: string, taken: Iterable<string>): NoteType {
  const base =
    name
      .toLocaleLowerCase("de")
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "typ";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export interface NoteRow {
  id: string;
  title: string;
  type: NoteType;
  area_id: string;
  topic_id: string | null;
  project_id: string | null;
  task_id: string | null;
  tags: string[];
  reviewed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /**
   * Zuletzt bearbeitet: jüngster Zeitpunkt aus der Notiz selbst und ihren Blöcken
   * (updated_at der Notiz ändert sich beim Schreiben im Text nicht). Nur gelesen, nie geschrieben.
   */
  edited_at: string;
  /** Text des ersten Blocks (Vorschau in der Liste) */
  snippet: string;
}

/** Spalten, die die App schreibt (Upsert beim Anlegen, sonst Update einzelner Felder). */
export type NoteWrite = Pick<
  NoteRow,
  | "title"
  | "type"
  | "area_id"
  | "topic_id"
  | "project_id"
  | "task_id"
  | "tags"
  | "reviewed_at"
  | "archived_at"
  | "deleted_at"
>;

export interface TopicRow {
  id: string;
  area_id: string;
  name: string;
  sort: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export const noteTitle = (note: Pick<NoteRow, "title"> | undefined) =>
  note?.title.trim() ? note.title : "Ohne Titel";

/** Tags normalisieren: ohne #, getrimmt, ohne Leerzeichen, eindeutig, sortiert. */
export function normalizeTags(tags: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const raw of tags) {
    const tag = raw.replace(/^#+/, "").trim().replace(/\s+/g, "-");
    if (tag && tag.length <= 50) set.add(tag);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "de"));
}
