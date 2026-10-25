import { describe, expect, it } from "vitest";
import { isKnowledgeNote, needsSorting, splitKnowledge } from "./knowledge";
import { knowledgeTypeKeys } from "./types";

const keys = new Set(["wissen", "anleitung"]);
const n = (id: string, type: string, project_id: string | null = null) => ({
  id,
  type,
  project_id,
});

describe("Wissen: der Typ entscheidet (#56)", () => {
  it("Wissen und Anleitung zählen, auch mit Projekt; Idee nicht", () => {
    expect(isKnowledgeNote(n("a", "wissen"), keys)).toBe(true);
    expect(isKnowledgeNote(n("b", "anleitung", "p1"), keys)).toBe(true);
    expect(isKnowledgeNote(n("c", "idee"), keys)).toBe(false);
  });

  it("noch einordnen: anderer Typ ohne Projekt – Projektnotizen und Wissen nicht", () => {
    expect(needsSorting(n("a", "idee"), keys)).toBe(true);
    expect(needsSorting(n("b", "idee", "p1"), keys)).toBe(false);
    expect(needsSorting(n("c", "protokoll", "p1"), keys)).toBe(false);
    expect(needsSorting(n("d", "wissen"), keys)).toBe(false);
  });

  it("teilt in Wissen, Noch einordnen und Zahl der Nicht-Wissen-Notizen", () => {
    const split = splitKnowledge(
      [
        n("1", "wissen"),
        n("2", "anleitung", "p"),
        n("3", "idee"),
        n("4", "idee", "p"),
        n("5", "protokoll", "p"),
        n("6", "journal"),
      ],
      keys,
    );
    expect(split.knowledge.map((x) => x.id)).toEqual(["1", "2"]);
    expect(split.unsorted.map((x) => x.id)).toEqual(["3", "6"]);
    expect(split.notKnowledge).toBe(4);
  });

  it("ein umgestellter Typ rutscht ins Wissen; ein eigener Typ zählt erst mit Schalter", () => {
    const types = [
      { key: "idee", counts_as_knowledge: false, deleted_at: null },
      { key: "fahrzeuge", counts_as_knowledge: false, deleted_at: null },
      { key: "wissen", counts_as_knowledge: true, deleted_at: "2026-10-18T00:00:00Z" },
    ];
    expect([...knowledgeTypeKeys(types)]).toEqual([]);
    types[1] = { ...types[1], counts_as_knowledge: true } as (typeof types)[number];
    const set = knowledgeTypeKeys(types);
    expect(splitKnowledge([n("1", "fahrzeuge"), n("2", "idee")], set).knowledge).toHaveLength(1);
  });
});
