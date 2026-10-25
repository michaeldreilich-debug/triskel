import { describe, expect, it, vi } from "vitest";
import { LruMap } from "./lru";

describe("LruMap", () => {
  it("verdrängt den am längsten nicht gefragten Eintrag und räumt ihn auf", () => {
    const evicted = vi.fn();
    const cache = new LruMap<string, string>(2, evicted);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");
    cache.set("c", "3");
    expect(evicted).toHaveBeenCalledWith("2", "b");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("1");
    expect(cache.size).toBe(2);
  });

  it("überschreiben räumt den alten Wert auf, delete nicht", () => {
    const evicted = vi.fn();
    const cache = new LruMap<string, string>(5, evicted);
    cache.set("a", "1");
    cache.set("a", "2");
    expect(evicted).toHaveBeenCalledWith("1", "a");
    cache.delete("a");
    expect(evicted).toHaveBeenCalledTimes(1);
    expect(cache.get("a")).toBeUndefined();
  });
});
