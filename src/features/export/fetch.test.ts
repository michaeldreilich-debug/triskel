import { describe, expect, it } from "vitest";
import { inBatches } from "./fetch";

describe("Export lädt Anhänge in kleinen Gruppen (T-10)", () => {
  it("höchstens `limit` gleichzeitig, Ergebnisse in der Reihenfolge der Aufgaben", async () => {
    let running = 0;
    let most = 0;
    const tasks = Array.from({ length: 10 }, (_, index) => async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return index;
    });
    expect(await inBatches(tasks, 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(most).toBe(4);
    expect(await inBatches([], 4)).toEqual([]);
  });
});
