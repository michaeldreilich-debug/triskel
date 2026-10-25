import { describe, expect, it } from "vitest";
import {
  docToLines,
  hasProjectContent,
  isEmptyDoc,
  linesToDoc,
  noteTemplateDoc,
  parseProjectTemplate,
  templateRows,
  withFreshIds,
} from "./model";

const protokoll = {
  type: "doc",
  content: ["Anlass/Datum", "Teilnehmende"].map((text) => ({
    type: "block",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  })),
};

describe("Projekt-Vorlage", () => {
  it("liest Texte (auch {text, done} aus der alten Vorlage), leere fallen weg", () => {
    const t = parseProjectTemplate({
      why: "Übung sauber planen",
      outcome: [{ text: "Plan steht", done: false }, { text: "" }, "Alle informiert"],
      milestones: ["Planen", "Durchführen"],
      tasks: ["Raum buchen"],
    });
    expect(t).toEqual({
      why: "Übung sauber planen",
      outcome: ["Plan steht", "Alle informiert"],
      milestones: ["Planen", "Durchführen"],
      tasks: ["Raum buchen"],
    });
    expect(hasProjectContent(t)).toBe(true);
    expect(hasProjectContent(parseProjectTemplate({ why: "", outcome: [] }))).toBe(false);
  });
});

describe("Notiz-Vorlage als Gliederung", () => {
  it("Dokument → Zeilen → Dokument (mit Unterpunkten)", () => {
    const doc = linesToDoc("Themen\n  Punkt A\n    Detail\n  - Punkt B\nBeschlüsse\n\n");
    expect(docToLines(doc)).toBe("Themen\n  Punkt A\n    Detail\n  Punkt B\nBeschlüsse");
  });

  it("zu tiefe Einrückung rückt nur eine Ebene ein, Tabs zählen als Ebene", () => {
    expect(docToLines(linesToDoc("A\n      B\n\tC"))).toBe("A\n  B\n  C");
  });

  it("liest die mitgelieferte Protokoll-Vorlage", () => {
    expect(docToLines(noteTemplateDoc(protokoll))).toBe("Anlass/Datum\nTeilnehmende");
  });

  it("Zeilen für note_blocks mit frischen, eindeutigen IDs und Reihenfolge", () => {
    const body = linesToDoc("Themen\n  Punkt A\nBeschlüsse") as Record<string, unknown>;
    const first = templateRows(body);
    const second = templateRows(body);
    expect(first.map((r) => r.content_text)).toEqual(["Themen", "Punkt A", "Beschlüsse"]);
    expect(first[1]?.parent_id).toBe(first[0]?.id);
    expect(first[0]?.sort < (first[2]?.sort ?? "")).toBe(true);
    expect(new Set([...first, ...second].map((r) => r.id)).size).toBe(6);
  });

  it("leere Notiz erkennen", () => {
    expect(isEmptyDoc({ type: "doc", content: [] })).toBe(true);
    expect(
      isEmptyDoc({ type: "doc", content: [{ type: "block", content: [{ type: "paragraph" }] }] }),
    ).toBe(true);
    expect(isEmptyDoc(withFreshIds(protokoll))).toBe(false);
  });
});
