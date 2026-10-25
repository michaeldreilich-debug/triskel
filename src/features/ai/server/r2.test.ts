import { afterEach, describe, expect, it, vi } from "vitest";
import type { R2Config } from "@/features/storage/config";
import type { AiContext } from "./context";
import { loadStored, MAX_READ_BYTES, TooLargeError } from "./media";
import { storeFile } from "./r2";

const USER = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";
const PATH = `${USER}/${NOTE}/44444444-4444-4444-8444-444444444444.pdf`;
const CONFIG: R2Config = {
  accountId: "0123456789abcdef0123456789abcdef",
  bucket: "triskel-dateien-test",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

/** KI-Kontext mit gespielter Freigabe und Besitzerabfrage; der Speicher ist gespielt (fetch). */
const context = (over: { allowed?: boolean; r2?: R2Config | null; owner?: boolean } = {}) =>
  ({
    db: {
      rpc: async () => ({ data: over.allowed ?? true, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: over.owner === false ? null : { id: NOTE } }),
          }),
        }),
      }),
    },
    userId: USER,
    clientId: "test",
    origin: "https://app.test",
    now: () => new Date(),
    r2: over.r2 === undefined ? CONFIG : over.r2,
  }) as unknown as AiContext;

afterEach(() => vi.restoreAllMocks());

describe("Dateien der KI in R2 (R3)", () => {
  it("fremder Pfad: abgelehnt, bevor der Speicher gefragt wird", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const foreign = `22222222-0000-4222-8222-222222222222/${NOTE}/44444444-4444-4444-8444-444444444444.pdf`;
    await expect(
      loadStored(context(), { bucket: "attachments", path: foreign, size: 0 }),
    ).rejects.toThrow(/nicht im eigenen Ordner/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("ohne KI-Freigabe oder ohne R2-Werte: kein Zugriff", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const media = { bucket: "attachments" as const, path: PATH, size: 0 };
    await expect(loadStored(context({ allowed: false }), media)).rejects.toThrow(
      /nicht freigegeben/,
    );
    await expect(loadStored(context({ r2: null }), media)).rejects.toThrow(/nicht verfügbar/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("über 25 MB: TooLargeError nach dem HEAD, die Datei wird nicht geladen", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-length": String(MAX_READ_BYTES + 1) },
      }),
    );
    const error = await loadStored(context(), { bucket: "attachments", path: PATH, size: 0 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TooLargeError);
    expect((error as TooLargeError).size).toBe(MAX_READ_BYTES + 1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Ablegen: nur in einen Eintrag, der dem Nutzer gehört; Größe nach Bucket", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const base = {
      bucket: "attachments" as const,
      ownerId: NOTE,
      ext: "pdf",
      mime: "application/pdf",
    };
    await expect(
      storeFile(context({ owner: false }), { ...base, bytes: new Uint8Array(4) }),
    ).rejects.toThrow(/nicht gefunden/);
    await expect(storeFile(context(), { ...base, bytes: new Uint8Array(0) })).rejects.toThrow(
      /leer/,
    );
    await expect(
      storeFile(context(), {
        ...base,
        bucket: "note-images",
        ext: "png",
        mime: "image/png",
        bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/größer/);
    expect(spy).not.toHaveBeenCalled();
    const stored = await storeFile(context(), { ...base, bytes: new Uint8Array(4) });
    expect(stored.path).toMatch(new RegExp(`^${USER}/${NOTE}/[0-9a-f-]{36}\\.pdf$`));
    expect(stored.mime).toBe("application/pdf");
    expect(spy).toHaveBeenCalledTimes(1);
    const request = spy.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe("PUT");
    expect(request.url).toContain(`/triskel-dateien-test/attachments/${USER}/${NOTE}/`);
    // nie überschreiben (P): R2 lehnt einen vorhandenen Schlüssel ab
    expect(request.headers.get("if-none-match")).toBe("*");
  });

  it("Ablegen: aktive Inhalte (HTML, SVG) landen als text/plain, am Inhalt erkannte Typen gewinnen (R-1)", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const html = new TextEncoder().encode("<html><script>1</script></html>");
    const stored = await storeFile(context(), {
      bucket: "attachments",
      ownerId: NOTE,
      ext: "html",
      bytes: html,
      mime: "text/html",
    });
    expect(stored.mime).toBe("text/plain");
    const sent = spy.mock.calls[0]?.[0] as Request;
    expect(sent.headers.get("content-type")).toBe("text/plain");
    // Notion meldet „PDF“, der Inhalt ist ein PNG → gespeichert wird image/png
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const sniffed = await storeFile(context(), {
      bucket: "attachments",
      ownerId: NOTE,
      ext: "pdf",
      bytes: png,
      mime: "application/pdf",
    });
    expect(sniffed.mime).toBe("image/png");
    // unbekannte Angabe („binary/octet-stream“ von Notion) → Endung entscheidet
    const byExt = await storeFile(context(), {
      bucket: "attachments",
      ownerId: NOTE,
      ext: "pdf",
      bytes: new Uint8Array(4),
      mime: "binary/octet-stream",
    });
    expect(byExt.mime).toBe("application/pdf");
  });

  it("Ablegen: in den Bilder-Bucket nur Bildtypen; vorhandene Datei → verständlicher Fehler", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 412 }));
    const image = {
      bucket: "note-images" as const,
      ownerId: NOTE,
      ext: "png",
      bytes: new Uint8Array(4),
    };
    await expect(storeFile(context(), { ...image, mime: "image/svg+xml" })).rejects.toThrow(
      /nur PNG, JPEG, WebP und GIF/,
    );
    await expect(storeFile(context(), { ...image, mime: "text/html" })).rejects.toThrow(/nur PNG/);
    expect(spy).not.toHaveBeenCalled();
    await expect(storeFile(context(), { ...image, mime: "image/png" })).rejects.toThrow(
      /schon eine Datei – nichts überschrieben/,
    );
  });
});
