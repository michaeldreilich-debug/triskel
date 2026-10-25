/**
 * Globales Rückgängig (E8, B13): Jede Aktion mit „Rückgängig“-Toast legt ihre Umkehrung hier ab.
 * ⌘Z bzw. Strg+Z außerhalb von Textfeldern nimmt die jüngste zurück, mehrmals drücken die davor.
 * Jede Umkehrung läuft höchstens einmal – egal ob über den Toast-Knopf oder die Tastatur.
 * Textfelder und Editoren behalten ihr eigenes ⌘Z (ProseMirror-Historie, Browser).
 */

export interface UndoEntry {
  id: number;
  /** Meldung der ursprünglichen Aktion, z. B. „„Einkaufen“ liegt im Papierkorb“ */
  message: string;
  undo: () => void;
  /** Toast der Aktion (wird beim Rückgängigmachen per Tastatur geschlossen) */
  toastId?: string | number;
}

/** Ältere Einträge fallen heraus – ⌘Z soll nicht Aktionen von vor Stunden zurückholen. */
export const UNDO_LIMIT = 20;

export function createUndoStack(limit = UNDO_LIMIT) {
  let entries: UndoEntry[] = [];
  let nextId = 1;
  return {
    push(message: string, undo: () => void): UndoEntry {
      const entry: UndoEntry = { id: nextId++, message, undo };
      entries = [...entries, entry].slice(-limit);
      return entry;
    },
    /** Eintrag herausnehmen (danach nicht mehr per ⌘Z erreichbar); undefined = schon benutzt */
    take(id: number): UndoEntry | undefined {
      const entry = entries.find((e) => e.id === id);
      entries = entries.filter((e) => e.id !== id);
      return entry;
    },
    /** jüngsten Eintrag herausnehmen */
    pop(): UndoEntry | undefined {
      const entry = entries.at(-1);
      if (entry) entries = entries.slice(0, -1);
      return entry;
    },
    size: () => entries.length,
    clear() {
      entries = [];
    },
  };
}

export type UndoStack = ReturnType<typeof createUndoStack>;

/** Eine Liste je Browser-Tab (die Umkehrungen schreiben über die Speicher-Warteschlange). */
export const undoStack = createUndoStack();

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Hat das Ziel ein eigenes ⌘Z (Eingabefeld, Textbereich, Editor)? */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  if (
    element.isContentEditable ||
    element.closest("[contenteditable]:not([contenteditable='false'])")
  ) {
    return true;
  }
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((element as HTMLInputElement).type);
  return false;
}

/**
 * Soll ein Seiten-Kürzel für ←/→ (Kalender, Zeitstrahl) hier nicht greifen? Fokussierbare
 * Scroll-Bereiche (`data-tab-scroll`) scrollen selbst, Umschalter (Radio, Reiter, Listen) und
 * Knöpfe wechseln ihre Auswahl – `preventDefault` nähme ihnen die Tastatur (U-2).
 */
export function isArrowKeyTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean(
    (target as Element).closest(
      "[data-tab-scroll], [role=radiogroup], [role=radio], [role=tablist], [role=tab], [role=listbox], [role=option], [role=slider], [role=menu], button, select, input",
    ),
  );
}

const KEYBOARD_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

/**
 * Geht am Handy die Tastatur auf? Bei Editor, Textbereich und Textfeldern ja – nicht bei
 * Uhrzeit, Datum und Auswahl (eigene Picker) oder Häkchen (Leiste unten, E44).
 */
export function opensKeyboard(target: EventTarget | null): boolean {
  if (!isEditableTarget(target)) return false;
  const element = target as HTMLElement;
  if (element.tagName === "SELECT") return false;
  if (element.tagName === "INPUT") return KEYBOARD_INPUTS.has((element as HTMLInputElement).type);
  return true;
}

/** ⌘Z bzw. Strg+Z ohne Umschalt/Alt (⌘⇧Z wäre „Wiederholen“). */
export function isUndoShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "z"
  );
}
