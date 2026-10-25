import { describe, expect, it } from "vitest";
import { isValidKey, keyAfter, keyBetween } from "./sort-key";

describe("Sortierschlüssel", () => {
  it("hängt hinter den größten gültigen Schlüssel an und übergeht ungültige", () => {
    expect(keyAfter([])).toBe("a0");
    expect(keyAfter(["a0", "a1"])).toBe("a2");
    expect(keyAfter(["a0", "amv4dgqzx000"])).toBe("a1");
    expect(keyAfter(["a1", "a1V"])).toBe("a2");
    expect(isValidKey("a0")).toBe(true);
    expect(isValidKey("amv4dgqzx000")).toBe(false);
  });

  it("keyBetween liegt zwischen den Nachbarn, auch am Anfang und Ende", () => {
    const middle = keyBetween("a0", "a1");
    expect(middle > "a0" && middle < "a1").toBe(true);
    expect(keyBetween(null, "a0") < "a0").toBe(true);
    expect(keyBetween("a1", null) > "a1").toBe(true);
    // vertauschte oder kaputte Nachbarn: trotzdem ein gültiger Schlüssel
    expect(keyBetween("a2", "a1") > "a2").toBe(true);
    expect(isValidKey(keyBetween("kaputt!", "a1"))).toBe(true);
  });
});
