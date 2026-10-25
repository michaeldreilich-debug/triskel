import { afterEach, describe, expect, it, vi } from "vitest";
import { newId, stableId } from "./id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("newId", () => {
  it("nutzt crypto.randomUUID, wenn vorhanden", () => {
    expect(newId()).toMatch(UUID_V4);
  });

  it("ohne randomUUID (http im WLAN): gültige, verschiedene UUIDs v4", () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => original.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});

describe("stableId (D-3)", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("gleiche Eingabe → gleiche gültige UUID, auf jedem Gerät", () => {
    const a = stableId("recap:user-a:woche:2026-10-12");
    expect(a).toMatch(UUID);
    expect(stableId("recap:user-a:woche:2026-10-12")).toBe(a);
  });

  it("andere Eingabe → andere UUID", () => {
    const ids = new Set(Array.from({ length: 500 }, (_, i) => stableId(`recap:user-a:woche:${i}`)));
    expect(ids.size).toBe(500);
    expect(stableId("recap:user-b:woche:2026-10-12")).not.toBe(
      stableId("recap:user-a:woche:2026-10-12"),
    );
  });
});
