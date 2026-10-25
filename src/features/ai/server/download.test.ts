import { describe, expect, it } from "vitest";
import { allowedUrl, download, fileNameOf, mimeOf } from "./download";

const NOTION = "https://file.notion.so/f/f/space/file/Beleg%20Arzt.pdf?signature=x";

const response = (body: string | null, init: ResponseInit & { headers?: Record<string, string> }) =>
  new Response(body, init);

describe("Datei laden nur von Notion (#33)", () => {
  it("lässt nur https auf Notion-Hosts zu", () => {
    expect(allowedUrl(NOTION).hostname).toBe("file.notion.so");
    expect(() => allowedUrl("http://file.notion.so/x")).toThrow(/https/);
    expect(() => allowedUrl("https://evil.example/x.pdf")).toThrow(/nur von Notion/);
    expect(() => allowedUrl("https://169.254.169.254/latest")).toThrow(/nur von Notion/);
    expect(() => allowedUrl("https://user:pw@file.notion.so/x")).toThrow(/ohne Zugangsdaten/);
    expect(() => allowedUrl("kein link")).toThrow(/gültige/);
  });

  it("lädt, nimmt Namen und Typ; Weiterleitung zu fremdem Host wird abgelehnt", async () => {
    const ok = await download(NOTION, {
      fetch: async () =>
        response("%PDF-1.7", { status: 200, headers: { "content-type": "application/pdf" } }),
    });
    expect(ok).toMatchObject({ name: "Beleg Arzt.pdf", mime: "application/pdf" });
    expect(ok.bytes.byteLength).toBe(8);

    await expect(
      download(NOTION, {
        fetch: async () =>
          response(null, { status: 302, headers: { location: "http://10.0.0.1/geheim" } }),
      }),
    ).rejects.toThrow(/https/);

    const hops: string[] = [];
    const followed = await download(NOTION, {
      fetch: async (url) => {
        hops.push(String(url));
        return hops.length === 1
          ? response(null, {
              status: 302,
              headers: { location: "https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b.png" },
            })
          : response("png", { status: 200, headers: { "content-type": "image/png" } });
      },
    });
    expect(followed).toMatchObject({ name: "b.png", mime: "image/png" });
  });

  it("bricht über der Größengrenze ab, auch ohne Content-Length", async () => {
    await expect(
      download(NOTION, {
        maxBytes: 4,
        fetch: async () => response("123456", { status: 200 }),
      }),
    ).rejects.toThrow(/größer als/);
    await expect(
      download(NOTION, {
        fetch: async () =>
          response("x", { status: 200, headers: { "content-length": "999999999" } }),
      }),
    ).rejects.toThrow(/größer/);
    await expect(
      download(NOTION, { fetch: async () => response("abgelaufen", { status: 403 }) }),
    ).rejects.toThrow(/neu holen/);
  });

  it("Name aus Content-Disposition, Typ aus der Endung, wenn der Server ihn nicht nennt", () => {
    const url = new URL(NOTION);
    expect(fileNameOf(url, "attachment; filename*=UTF-8''Rechnung%20M%C3%A4rz.pdf")).toBe(
      "Rechnung März.pdf",
    );
    expect(fileNameOf(url, 'inline; filename="../../etc/passwd"')).toBe("passwd");
    expect(mimeOf("binary/octet-stream", "scan.JPG")).toBe("image/jpeg");
    expect(mimeOf(null, "notiz.xyz")).toBe("application/octet-stream");
  });
});
