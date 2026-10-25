import { describe, expect, it } from "vitest";
import {
  isFinalRejection,
  memoryPendingStore,
  type PendingUpload,
  retryPendingUploads,
} from "./pending-uploads";

const entry = (path: string, at = 1): PendingUpload => ({
  path,
  bucket: "note-images",
  ownerId: "n1",
  contentType: "image/png",
  name: `${path}.png`,
  blob: new Blob(["x"], { type: "image/png" }),
  at,
});

const status = (code: number) => Object.assign(new Error(`R2 ${code}`), { status: code });

describe("Offene Uploads (Review Teil B, V-1/V-10)", () => {
  it("endgültig abgelehnt sind nur 4xx außer 404/408/429 – kein Netz und 5xx bleiben offen", () => {
    expect(isFinalRejection(status(413))).toBe(true);
    expect(isFinalRejection(status(403))).toBe(true);
    expect(isFinalRejection(status(404))).toBe(false);
    expect(isFinalRejection(status(429))).toBe(false);
    expect(isFinalRejection(status(503))).toBe(false);
    expect(isFinalRejection(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("wiederholt nacheinander: Bestätigtes und 409 verlassen die Liste, Abgelehntes fliegt raus, der Rest bleibt", async () => {
    const store = memoryPendingStore();
    await store.put(entry("u/n1/a", 3));
    await store.put(entry("u/n1/b", 1));
    await store.put(entry("u/n1/c", 2));
    await store.put(entry("u/n1/d", 4));
    const attempts: string[] = [];
    const result = await retryPendingUploads(store, async (_target, path) => {
      attempts.push(path);
      if (path.endsWith("b")) return;
      if (path.endsWith("c")) throw status(409);
      if (path.endsWith("a")) throw new TypeError("Failed to fetch");
      throw status(413);
    });
    // Reihenfolge nach dem ersten Versuch (at)
    expect(attempts).toEqual(["u/n1/b", "u/n1/c", "u/n1/a", "u/n1/d"]);
    expect(result.done.map((e) => e.path)).toEqual(["u/n1/b", "u/n1/c"]);
    expect(result.rejected.map((e) => e.path)).toEqual(["u/n1/d"]);
    expect(result.open.map((e) => e.path)).toEqual(["u/n1/a"]);
    expect((await store.list()).map((e) => e.path)).toEqual(["u/n1/a"]);
    expect(await store.get("u/n1/a")).toMatchObject({ name: "u/n1/a.png" });
    expect(await store.get("u/n1/b")).toBeNull();
  });
});
