import { describe, expect, it } from "vitest";
import { fetchAll } from "./fetch-all";

describe("fetchAll", () => {
  it("lädt seitenweise, bis eine Seite kürzer ist", async () => {
    const all = Array.from({ length: 7 }, (_, i) => i);
    const ranges: Array<[number, number]> = [];
    const rows = await fetchAll((from, to) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    }, 3);
    expect(rows).toEqual(all);
    expect(ranges).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it("volle letzte Seite: eine leere Seite beendet", async () => {
    const all = [1, 2, 3, 4];
    const rows = await fetchAll(
      (from, to) => Promise.resolve({ data: all.slice(from, to + 1), error: null }),
      2,
    );
    expect(rows).toEqual(all);
  });

  it("wirft Fehler weiter", async () => {
    const error = { code: "42501", message: "nein" };
    await expect(fetchAll(() => Promise.resolve({ data: null, error }))).rejects.toBe(error);
  });
});
