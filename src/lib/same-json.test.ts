import { describe, expect, it } from "vitest";
import { sameJson } from "./same-json";

describe("sameJson", () => {
  it("ignoriert die Reihenfolge der Schlüssel, nicht die der Listen", () => {
    expect(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameJson({ c: [1, 2] }, { c: [2, 1] })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson(null, undefined)).toBe(true);
    expect(sameJson({ a: undefined }, {})).toBe(true);
    expect(sameJson("x", "y")).toBe(false);
  });
});
