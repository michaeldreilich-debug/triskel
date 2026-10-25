import { describe, expect, it } from "vitest";
import { noteTypeKey, noteTypeName, parseNoteType } from "./types";

describe("Notiz-Typen (#34)", () => {
  it("Schlüssel aus dem Namen: Umlaute, Leerzeichen, eindeutig auch gegenüber gelöschten", () => {
    expect(noteTypeKey("Besprechung", [])).toBe("besprechung");
    expect(noteTypeKey("Über uns – Ärger & Spaß", [])).toBe("ueber-uns-aerger-spass");
    expect(noteTypeKey("Idee", ["idee"])).toBe("idee-2");
    expect(noteTypeKey("Idee", ["idee", "idee-2"])).toBe("idee-3");
    expect(noteTypeKey("!!!", [])).toBe("typ");
    expect(noteTypeKey("x".repeat(80), []).length).toBeLessThanOrEqual(32);
  });

  it("Name: eigener vor mitgeliefertem, unbekannt = Schlüssel; ungültige Schlüssel = Idee (Standard)", () => {
    const types = [{ key: "protokoll", name: "Besprechungsprotokoll" }];
    expect(noteTypeName(types, "protokoll")).toBe("Besprechungsprotokoll");
    expect(noteTypeName(types, "idee")).toBe("Idee");
    expect(noteTypeName(types, "eigen")).toBe("eigen");
    expect(parseNoteType("Kaputt Typ")).toBe("idee");
    expect(parseNoteType("besprechung")).toBe("besprechung");
  });
});

describe("Wunsch-Typ für neue Notizen (#34)", () => {
  it("nimmt den Wunsch, solange es ihn gibt, sonst den Standard Idee", async () => {
    const { preferredNoteType } = await import("./types");
    expect(preferredNoteType("protokoll", [{ key: "protokoll", deleted_at: null }])).toBe(
      "protokoll",
    );
    expect(preferredNoteType("protokoll", [{ key: "protokoll", deleted_at: "2026-10-17" }])).toBe(
      "idee",
    );
    expect(preferredNoteType("protokoll", [])).toBe("idee");
  });
});
