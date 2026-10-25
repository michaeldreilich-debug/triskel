import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBucketCache, visitMediaNodes } from "./media-store";

const api = vi.hoisted(() => ({
  putMedia: vi.fn(),
  fetchMedia: vi.fn(),
  mediaExists: vi.fn(),
}));
vi.mock("./media-api", () => api);

const target = { bucket: "note-images", ownerId: "n" } as const;

beforeEach(() => {
  api.putMedia.mockReset().mockResolvedValue(undefined);
  api.mediaExists.mockReset().mockResolvedValue(false);
  api.fetchMedia
    .mockReset()
    .mockImplementation(async (_b: string, path: string) => new Blob([path]));
});

describe("Bucket-Cache für Bilder und Dateien (O-20)", () => {
  it("Hochladen: lokaler Stand sofort da, kein Abruf; scheitert es, fällt er heraus", async () => {
    const cache = createBucketCache<string>({ limit: 5, toValue: (blob) => `wert:${blob.size}` });
    await cache.upload(target, "u/n/a.png", new Blob(["abc"]), "image/png", "a.png");
    expect(api.putMedia).toHaveBeenCalledWith(
      target,
      "u/n/a.png",
      expect.any(Blob),
      "image/png",
      "a.png",
    );
    await expect(cache.load("note-images", "u/n/a.png")).resolves.toBe("wert:3");
    expect(api.fetchMedia).not.toHaveBeenCalled();

    // endgültig abgelehnt (zu groß): fällt heraus, der nächste Abruf fragt den Speicher
    api.putMedia.mockRejectedValueOnce(Object.assign(new Error("voll"), { status: 413 }));
    await expect(
      cache.upload(target, "u/n/b.png", new Blob(["x"]), "image/png", "b.png"),
    ).rejects.toThrow("voll");
    await cache.load("note-images", "u/n/b.png");
    expect(api.fetchMedia).toHaveBeenCalledWith("note-images", "u/n/b.png");
    // keine Antwort (Funkloch): der lokale Stand bleibt, die Datei wartet auf den nächsten Versuch (V-1)
    api.putMedia.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      cache.upload(target, "u/n/d.png", new Blob(["dd"]), "image/png", "d.png"),
    ).rejects.toThrow("Failed to fetch");
    api.fetchMedia.mockClear();
    await expect(cache.load("note-images", "u/n/d.png")).resolves.toBe("wert:2");
    expect(api.fetchMedia).not.toHaveBeenCalled();
  });

  it("Antwort unterwegs verloren, Datei aber im Speicher: gilt als hochgeladen (#72)", async () => {
    const cache = createBucketCache<string>({ limit: 5, toValue: (blob) => `wert:${blob.size}` });
    api.putMedia.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    api.mediaExists.mockResolvedValueOnce(true);
    await cache.upload(target, "u/n/c.xlsx", new Blob(["xy"]), "application/x", "c.xlsx");
    expect(api.mediaExists).toHaveBeenCalledWith("note-images", "u/n/c.xlsx");
    await expect(cache.load("note-images", "u/n/c.xlsx")).resolves.toBe("wert:2");

    api.putMedia.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      cache.upload(target, "u/n/d.xlsx", new Blob(["x"]), "application/x", "d.xlsx"),
    ).rejects.toThrow("Failed to fetch");

    // eine Ablehnung des Speichers bleibt ein Fehler, ohne Nachfrage
    api.mediaExists.mockClear();
    api.putMedia.mockRejectedValueOnce(
      Object.assign(new Error("Payload too large"), { status: 413 }),
    );
    await expect(
      cache.upload(target, "u/n/e.xlsx", new Blob(["x"]), "application/x", "e.xlsx"),
    ).rejects.toThrow("Payload too large");
    expect(api.mediaExists).not.toHaveBeenCalled();
  });

  it("Laden wird gemerkt, ein Fehlschlag nicht; Verdrängtes wird aufgeräumt", async () => {
    const evicted: string[] = [];
    const cache = createBucketCache<string>({
      limit: 2,
      toValue: (blob) => `wert:${blob.size}`,
      onEvict: (value) => evicted.push(value),
    });
    api.fetchMedia.mockRejectedValue(new Error("weg"));
    await expect(cache.load("note-images", "fehlt")).rejects.toThrow("weg");
    await expect(cache.load("note-images", "fehlt")).rejects.toThrow("weg");
    expect(api.fetchMedia).toHaveBeenCalledTimes(2);

    api.fetchMedia.mockImplementation(async (_b: string, path: string) => new Blob([path]));
    await cache.load("note-images", "a");
    await cache.load("note-images", "a");
    expect(api.fetchMedia.mock.calls.filter(([, p]) => p === "a")).toHaveLength(1);
    await cache.load("note-images", "bb");
    await cache.load("note-images", "ccc");
    await vi.waitFor(() => expect(evicted).toEqual(["wert:1"]));
  });

  it("findet Medien-Knoten in verschachtelten Inhalten", () => {
    const found: string[] = [];
    visitMediaNodes(
      [
        {
          type: "doc",
          content: [
            { type: "noteImage", attrs: { path: "a" } },
            { type: "block", content: [{ type: "noteImage", attrs: { path: "b" } }] },
            { type: "noteFile", attrs: { path: "c" } },
            { type: "noteImage", attrs: { path: null } },
          ],
        },
        null,
      ],
      "noteImage",
      (path) => found.push(path),
    );
    expect(found).toEqual(["a", "b"]);
  });
});
