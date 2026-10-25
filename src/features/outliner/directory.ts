/**
 * Schnittstellen zu Notizen und Tags, die der Editor braucht (Titel auflösen, [[-Autocomplete,
 * neue Notiz anlegen). In der App kommen die Daten aus TanStack Query (Session A2),
 * in der Spielwiese und in Tests aus einem lokalen Verzeichnis.
 */
import { newId } from "@/lib/id";

export interface NoteSummary {
  id: string;
  title: string;
  /** archiviert – nur bei passendem Titel angeboten, unten und gekennzeichnet (O-9) */
  archived?: boolean;
}

export interface NoteDirectory {
  titleOf(id: string): string | undefined;
  search(query: string): NoteSummary[];
  findByTitle(title: string): string | undefined;
  /** legt eine Notiz an und gibt ihre (im Client erzeugte) ID zurück (E4, E7) */
  create(title: string): string;
  subscribe(listener: () => void): () => void;
}

export interface TagDirectory {
  search(query: string): string[];
}

/** Für Vergleiche von Titeln und Tags: ohne Rand, klein (deutsch) */
export const normalize = (value: string) => value.trim().toLocaleLowerCase("de");

/**
 * Treffer für „((“/„[[“: alphabetisch; mit Suchwort erst die Titel, die so beginnen, dann die,
 * die es enthalten. Gilt für App und Spielwiese gleich (O-22).
 */
export function rankByTitle<T extends { title: string }>(list: T[], query: string): T[] {
  const q = normalize(query);
  const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title, "de"));
  if (!q) return sorted;
  const starts = sorted.filter((n) => normalize(n.title).startsWith(q));
  const contains = sorted.filter(
    (n) => !normalize(n.title).startsWith(q) && normalize(n.title).includes(q),
  );
  return [...starts, ...contains];
}

export function createLocalNoteDirectory(
  initial: NoteSummary[] = [],
  options: { generateId?: () => string; onChange?: (notes: NoteSummary[]) => void } = {},
): NoteDirectory & { all(): NoteSummary[]; rename(id: string, title: string): void } {
  const notes = new Map(initial.map((n) => [n.id, { ...n }]));
  const listeners = new Set<() => void>();
  const generateId = options.generateId ?? newId;
  const changed = () => {
    options.onChange?.([...notes.values()]);
    for (const listener of listeners) listener();
  };
  return {
    all: () => [...notes.values()],
    titleOf: (id) => notes.get(id)?.title,
    search: (query) => rankByTitle([...notes.values()], query),
    findByTitle(title) {
      const q = normalize(title);
      return [...notes.values()].find((n) => normalize(n.title) === q)?.id;
    },
    create(title) {
      const id = generateId();
      notes.set(id, { id, title: title.trim() });
      changed();
      return id;
    },
    rename(id, title) {
      const note = notes.get(id);
      if (!note) return;
      note.title = title;
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createLocalTagDirectory(
  initial: string[] = [],
): TagDirectory & { add(tag: string): void } {
  const tags = new Set(initial);
  return {
    add: (tag) => void tags.add(tag),
    search(query) {
      const q = normalize(query);
      return [...tags]
        .filter((t) => normalize(t).startsWith(q))
        .sort((a, b) => a.localeCompare(b, "de"));
    },
  };
}

/**
 * Aufgaben für „Block → Aufgabe“ (B5): Status anzeigen, abhaken, anlegen. In der App aus dem
 * TanStack-Query-Cache der Aufgaben, in Tests aus einem lokalen Verzeichnis.
 */
export interface TaskSummary {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskDirectory {
  get(id: string): TaskSummary | undefined;
  /** legt eine Aufgabe mit dem Blocktext als Titel an und gibt ihre ID zurück */
  create(title: string): string;
  /** erledigt ↔ offen */
  toggle(id: string): void;
  open(id: string): void;
  subscribe(listener: () => void): () => void;
}

export function createLocalTaskDirectory(
  options: { generateId?: () => string } = {},
): TaskDirectory & { all(): TaskSummary[] } {
  const tasks = new Map<string, TaskSummary>();
  const listeners = new Set<() => void>();
  const generateId = options.generateId ?? newId;
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    all: () => [...tasks.values()],
    get: (id) => tasks.get(id),
    create(title) {
      const id = generateId();
      tasks.set(id, { id, title, done: false });
      changed();
      return id;
    },
    toggle(id) {
      const task = tasks.get(id);
      if (!task) return;
      task.done = !task.done;
      changed();
    },
    open() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
