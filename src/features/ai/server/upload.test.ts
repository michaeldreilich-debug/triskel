import { describe, expect, it } from "vitest";
import { parseUploadRef, uploadRef, uploadTarget } from "./upload";

const USER = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444.pdf";

describe("Datei vom Rechner hochladen (#51)", () => {
  it("Bilder in den Bilder-Bucket, alles andere als Datei; Content-Type aus der Endung", () => {
    expect(uploadTarget("Bilanz.PDF", { asFile: false })).toEqual({
      bucket: "attachments",
      ext: "pdf",
      mime: "application/pdf",
    });
    expect(uploadTarget("Foto.jpeg", { asFile: false })).toEqual({
      bucket: "note-images",
      ext: "jpg",
      mime: "image/jpeg",
    });
    expect(uploadTarget("Foto.png", { asFile: true }).bucket).toBe("attachments");
    expect(uploadTarget("Tabelle.xlsx", { asFile: false })).toMatchObject({
      bucket: "attachments",
      mime: "application/octet-stream",
    });
    expect(uploadTarget("ohne-endung", { asFile: false }).ext).toBe("bin");
  });

  it("nimmt nur Verweise auf den eigenen Ordner genau dieser Notiz", () => {
    const ok = uploadRef("attachments", `${USER}/${NOTE}/${FILE}`);
    expect(parseUploadRef(ok, USER, NOTE)).toEqual({
      bucket: "attachments",
      path: `${USER}/${NOTE}/${FILE}`,
      fileName: FILE,
    });
    expect(() => parseUploadRef(ok, USER, OTHER)).toThrow(/gehört nicht/);
    expect(() => parseUploadRef(ok, OTHER, NOTE)).toThrow(/gehört nicht/);
    expect(() => parseUploadRef(`avatars:${USER}/${NOTE}/${FILE}`, USER, NOTE)).toThrow(
      /Unbekannter Verweis/,
    );
    expect(() =>
      parseUploadRef(`attachments:${USER}/${NOTE}/../${OTHER}/${FILE}`, USER, NOTE),
    ).toThrow(/gehört nicht/);
    expect(() => parseUploadRef(`attachments:${USER}/${NOTE}/beliebig.pdf`, USER, NOTE)).toThrow(
      /gehört nicht/,
    );
    expect(() => parseUploadRef(`attachments:${USER}/${NOTE}/${FILE}/mehr`, USER, NOTE)).toThrow(
      /gehört nicht/,
    );
  });
});
