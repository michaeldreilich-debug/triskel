import { describe, expect, it } from "vitest";
import type { R2Config } from "./config";
import { isMediaPath } from "./paths";
import {
  contentDisposition,
  downloadName,
  handleSharedFile,
  type SharedFileLookup,
  sharedFileOverrides,
} from "./shared";
import { presignGet } from "./signing";

const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
const USER = "0b1f7a3e-1111-4222-8333-444455556666";
const NOTE = "5d3f9c5a-1111-4222-8333-444455556666";
const IMAGE = `${USER}/${NOTE}/7e4a0d6b-1111-4222-8333-444455556666.png`;
const FILE = `${USER}/${NOTE}/8f5b1e7c-1111-4222-8333-444455556666.html`;
const config: R2Config = {
  accountId: "abcdef0123456789abcdef0123456789",
  bucket: "triskel-dateien-test",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secretexample",
};

function lookupOf(known: Record<string, "note-images" | "attachments">) {
  const calls: Array<[string, string]> = [];
  const lookup: SharedFileLookup = async (token, path) => {
    calls.push([token, path]);
    return token === TOKEN ? (known[path] ?? null) : null;
  };
  return { lookup, calls };
}

describe("Pfade der Freigabe (#94)", () => {
  it("isMediaPath: Nutzer-UUID / Eintrag / Datei.ext – sonst nichts", () => {
    expect(isMediaPath(IMAGE)).toBe(true);
    for (const bad of [
      `x/${NOTE}/a.png`,
      `${USER}/${NOTE}`,
      `${USER}/${NOTE}/a.png/b`,
      `${USER}/../a.png`,
      `/${USER}/${NOTE}/a.png`,
      `${USER.toUpperCase()}/${NOTE}/a.png`,
      `${USER}/${NOTE}/a..png`,
      `https://x/${USER}/${NOTE}/a.png`,
      `${USER}/${NOTE}/${"a".repeat(300)}.png`,
      null,
      42,
    ]) {
      expect(isMediaPath(bad), String(bad)).toBe(false);
    }
  });
});

describe("Datei-Route der Freigabe (#94)", () => {
  it("Format falsch → 404 ohne Datenbank; R2 fehlt → 503", async () => {
    const { lookup, calls } = lookupOf({ [IMAGE]: "note-images" });
    for (const [token, path] of [
      ["kurz", IMAGE],
      [TOKEN, null],
      [TOKEN, "../x"],
      [TOKEN, `${USER}/${NOTE}`],
    ] as const) {
      const res = await handleSharedFile({ token, path, name: null }, { config, lookup });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(calls).toEqual([]);
    const off = await handleSharedFile(
      { token: TOKEN, path: IMAGE, name: null },
      { config: null, lookup },
    );
    expect(off.status).toBe(503);
  });

  it("nicht in der Notiz → 404; Datenbank nicht erreichbar → 502", async () => {
    const { lookup } = lookupOf({});
    const res = await handleSharedFile(
      { token: TOKEN, path: IMAGE, name: null },
      { config, lookup },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    const broken = await handleSharedFile(
      { token: TOKEN, path: IMAGE, name: null },
      {
        config,
        lookup: async () => {
          throw new Error("weg");
        },
      },
    );
    expect(broken.status).toBe(502);
  });

  it("Bild der Notiz → 302 auf signierten Link mit festem Bildtyp, ohne Zwischenspeichern und Referer", async () => {
    const { lookup } = lookupOf({ [IMAGE]: "note-images" });
    const res = await handleSharedFile(
      { token: TOKEN, path: IMAGE, name: null },
      { config, lookup },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.origin).toBe(`https://${config.accountId}.eu.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/${config.bucket}/note-images/${IMAGE}`);
    // F-2: kurz gültig, R2 antwortet mit no-store – „Freigabe beenden“ greift binnen einer Minute
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-cache-control")).toBe("no-store");
    expect(url.searchParams.get("response-content-type")).toBe("image/png");
    expect(url.searchParams.get("response-content-disposition")).toBe("inline");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Datei: zum Herunterladen (auch HTML), Name aus der Notiz mit der Endung des Pfads", async () => {
    const { lookup } = lookupOf({ [FILE]: "attachments" });
    const res = await handleSharedFile(
      { token: TOKEN, path: FILE, name: "Seite.exe" },
      { config, lookup },
    );
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="Seite.html"; filename*=UTF-8''Seite.html`,
    );
    expect(url.searchParams.get("response-content-type")).toBeNull();
  });

  it("Typ und Art: Bilder inline als Bild, PDF inline als PDF, sonst Herunterladen", () => {
    expect(sharedFileOverrides("note-images", "u/n/a.jpg")).toEqual({
      contentType: "image/jpeg",
      contentDisposition: "inline",
      cacheControl: "no-store",
    });
    expect(sharedFileOverrides("note-images", "u/n/a.svg").contentDisposition).toMatch(
      /^attachment; /,
    );
    expect(sharedFileOverrides("attachments", "u/n/a.pdf", "Plan.pdf")).toEqual({
      contentType: "application/pdf",
      contentDisposition: `inline; filename="Plan.pdf"; filename*=UTF-8''Plan.pdf`,
      cacheControl: "no-store",
    });
    expect(sharedFileOverrides("attachments", "u/n/a.png").contentDisposition).toMatch(
      /^attachment; filename="Datei.png"/,
    );
  });

  it("Dateiname: keine Steuerzeichen, Anführungszeichen oder Pfade; Umlaute als UTF-8", () => {
    expect(downloadName('a"b\\c/d\r\ne.txt', "u/n/x.pdf")).toBe("a b c d e.pdf");
    expect(downloadName("", "u/n/x.docx")).toBe("Datei.docx");
    expect(downloadName("x".repeat(300), "u/n/x.txt")).toHaveLength(124);
    expect(contentDisposition("attachment", "Prüfung (1)'s.pdf")).toBe(
      `attachment; filename="Pr_fung (1)'s.pdf"; filename*=UTF-8''Pr%C3%BCfung%20%281%29%27s.pdf`,
    );
  });

  it("presignGet ohne Vorgaben bleibt wie bisher (keine response-Parameter)", async () => {
    const url = new URL(await presignGet(config, "note-images/a/b/c.png"));
    expect([...url.searchParams.keys()].filter((k) => k.startsWith("response-"))).toEqual([]);
  });
});
