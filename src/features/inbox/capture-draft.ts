/**
 * Entwurf des Sheets „Festhalten“ (Review Teil B, U-6): Räumt iOS die App im Hintergrund ab, war
 * der Entwurf nur im Speicher weg – Text blieb, aber Art, Bereich, Projekt und Datum sprangen
 * zurück (aus einer Projekt-Notiz wurde eine Inbox-Aufgabe). Jetzt liegt der ganze Entwurf in
 * `sessionStorage` (je Tab, verschwindet mit dem Tab) – „Anlegen“ und „Abbrechen“ leeren ihn.
 * Reine Funktionen; der Speicher wird übergeben (Tests, Safari ohne Storage).
 */
import type { IsoDate } from "@/lib/dates";

export const CAPTURE_DRAFT_KEY = "sz:festhalten-entwurf";

export interface CaptureDraft {
  text: string;
  art: "task" | "note";
  areaChoice: string | null;
  projectChoice: string | null;
  /** undefined = „Wann“ nicht selbst gewählt */
  manualDue?: IsoDate | null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isId = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length > 0 && value.length <= 80);

/** Gespeicherter Entwurf, nur wenn er vollständig und plausibel ist; sonst null. */
export function readCaptureDraft(storage: StorageLike | null): CaptureDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CAPTURE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CaptureDraft> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.text !== "string" || parsed.text.length > 2000) return null;
    const art = parsed.art === "note" ? "note" : "task";
    if (!isId(parsed.areaChoice) || !isId(parsed.projectChoice)) return null;
    const due = parsed.manualDue;
    const manualDue =
      due === null
        ? null
        : typeof due === "string" && ISO_DATE.test(due)
          ? (due as IsoDate)
          : undefined;
    return {
      text: parsed.text,
      art,
      areaChoice: parsed.areaChoice,
      projectChoice: parsed.projectChoice,
      ...(manualDue !== undefined ? { manualDue } : {}),
    };
  } catch {
    return null;
  }
}

/** Ist am Entwurf etwas, das sich zu merken lohnt? (sonst wird der Eintrag gelöscht) */
export const isEmptyCaptureDraft = (draft: CaptureDraft, defaultArea: string | null) =>
  draft.text.trim() === "" &&
  draft.art === "task" &&
  draft.areaChoice === defaultArea &&
  draft.projectChoice === null &&
  draft.manualDue === undefined;

export function writeCaptureDraft(storage: StorageLike | null, draft: CaptureDraft | null): void {
  if (!storage) return;
  try {
    if (draft) storage.setItem(CAPTURE_DRAFT_KEY, JSON.stringify(draft));
    else storage.removeItem(CAPTURE_DRAFT_KEY);
  } catch {
    // voller oder gesperrter Speicher (privates Fenster): der Entwurf lebt dann nur im Sheet
  }
}

/** `sessionStorage` des Browsers oder null (Server, blockierter Speicher). */
export function captureDraftStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
