import { describe, expect, it } from "vitest";
import { INTRO_TEXT, introDue, REVEAL_AT, revealedCount } from "./model";

const base = {
  enabled: true,
  lastShown: null,
  today: "2026-10-25",
  automated: false,
  testEnabled: false,
};

describe("introDue", () => {
  it("einmal am Tag: fällig, solange es heute noch nicht lief", () => {
    expect(introDue(base)).toBe(true);
    expect(introDue({ ...base, lastShown: "2026-10-24" })).toBe(true);
    expect(introDue({ ...base, lastShown: "2026-10-25" })).toBe(false);
  });

  it("ausgeschaltet nie", () => {
    expect(introDue({ ...base, enabled: false })).toBe(false);
  });

  it("in automatisierten Browsern nur mit Test-Freigabe", () => {
    expect(introDue({ ...base, automated: true })).toBe(false);
    expect(introDue({ ...base, automated: true, testEnabled: true })).toBe(true);
  });
});

describe("revealedCount", () => {
  it("vor dem ersten Satz nichts, danach Zeile für Zeile, am Ende alles", () => {
    expect(revealedCount(0)).toBe(0);
    expect(revealedCount(3.4)).toBe(1);
    expect(revealedCount(5.6)).toBe(4);
    expect(revealedCount(20)).toBe(REVEAL_AT.length);
  });

  it("je sichtbarem Element genau ein Zeitpunkt (Satz, Zeilen, Ziele, Glück, Säulen, Los)", () => {
    const elements =
      1 + INTRO_TEXT.lines.length + INTRO_TEXT.goals.length + 1 + INTRO_TEXT.pillars.length + 1;
    expect(REVEAL_AT).toHaveLength(elements);
    expect([...REVEAL_AT].sort((a, b) => a - b)).toEqual([...REVEAL_AT]);
  });
});
