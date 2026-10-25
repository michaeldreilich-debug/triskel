import { describe, expect, it } from "vitest";
import {
  CAPTURE_DRAFT_KEY,
  isEmptyCaptureDraft,
  readCaptureDraft,
  writeCaptureDraft,
} from "./capture-draft";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("Entwurf „Festhalten“ in sessionStorage (Review Teil B, U-6)", () => {
  it("schreibt und liest Text, Art, Bereich, Projekt und Datum; null löscht", () => {
    const storage = memory();
    const draft = {
      text: "Zelt bestellen",
      art: "note" as const,
      areaChoice: "a1",
      projectChoice: "p1",
      manualDue: "2026-10-30" as const,
    };
    writeCaptureDraft(storage, draft);
    expect(readCaptureDraft(storage)).toEqual(draft);
    writeCaptureDraft(storage, { ...draft, manualDue: null });
    expect(readCaptureDraft(storage)?.manualDue).toBeNull();
    writeCaptureDraft(storage, null);
    expect(storage.data.has(CAPTURE_DRAFT_KEY)).toBe(false);
    expect(readCaptureDraft(storage)).toBeNull();
  });

  it("verwirft Kaputtes und Unplausibles, ohne zu werfen; ohne Speicher passiert nichts", () => {
    const storage = memory();
    storage.data.set(CAPTURE_DRAFT_KEY, "{kaputt");
    expect(readCaptureDraft(storage)).toBeNull();
    storage.data.set(CAPTURE_DRAFT_KEY, JSON.stringify({ text: 5 }));
    expect(readCaptureDraft(storage)).toBeNull();
    storage.data.set(
      CAPTURE_DRAFT_KEY,
      JSON.stringify({
        text: "x",
        art: "egal",
        areaChoice: null,
        projectChoice: null,
        manualDue: "morgen",
      }),
    );
    // unbekannte Art → Aufgabe, ungültiges Datum → nicht selbst gewählt
    expect(readCaptureDraft(storage)).toEqual({
      text: "x",
      art: "task",
      areaChoice: null,
      projectChoice: null,
    });
    expect(readCaptureDraft(null)).toBeNull();
    expect(() => writeCaptureDraft(null, null)).not.toThrow();
    const broken = {
      ...memory(),
      setItem: () => {
        throw new Error("voll");
      },
    };
    expect(() =>
      writeCaptureDraft(broken, { text: "a", art: "task", areaChoice: null, projectChoice: null }),
    ).not.toThrow();
  });

  it("leer heißt: kein Text, Aufgabe, Vorgabe-Bereich, kein Projekt, kein Datum", () => {
    const empty = { text: "  ", art: "task" as const, areaChoice: "a1", projectChoice: null };
    expect(isEmptyCaptureDraft(empty, "a1")).toBe(true);
    expect(isEmptyCaptureDraft(empty, null)).toBe(false);
    expect(isEmptyCaptureDraft({ ...empty, art: "note" }, "a1")).toBe(false);
    expect(isEmptyCaptureDraft({ ...empty, manualDue: null }, "a1")).toBe(false);
  });
});
