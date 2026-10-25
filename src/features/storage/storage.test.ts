import { describe, expect, it } from "vitest";
import { parseListXml } from "./client";
import {
  objectUrl,
  PROD_BUCKET,
  R2GuardError,
  r2ConnectOrigin,
  r2Origin,
  readR2Config,
} from "./config";
import {
  folderPrefix,
  isOwnPath,
  isUuid,
  normalizeContentType,
  objectKey,
  parseKey,
  planUpload,
} from "./paths";
import { presignGet, presignPut } from "./signing";

const USER = "0b1f7a3e-1111-4222-8333-444455556666";
const OTHER = "9c2e8b4f-1111-4222-8333-444455556666";
const NOTE = "5d3f9c5a-1111-4222-8333-444455556666";
const FILE = "7e4a0d6b-1111-4222-8333-444455556666";
const required = <T>(value: T | null): T => {
  if (value === null) throw new Error("Konfiguration erwartet");
  return value;
};
const env = {
  R2_ACCOUNT_ID: "abcdef0123456789abcdef0123456789",
  R2_BUCKET: "triskel-dateien-test",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secretexample",
};

describe("Pfadprüfung und Schlüssel", () => {
  it("isOwnPath: streng", () => {
    expect(isOwnPath(`${USER}/${NOTE}/${FILE}.png`, USER)).toBe(true);
    expect(isOwnPath(`${OTHER}/${NOTE}/${FILE}.png`, USER)).toBe(false);
    for (const bad of [
      `${USER}/../${FILE}.png`,
      `${USER}/${NOTE}/..`,
      `${USER}/${NOTE}/x/${FILE}.png`,
      `/${USER}/${NOTE}/${FILE}.png`,
      `${USER}/${NOTE}/${FILE}.p.ng`,
      `${USER}/${NOTE}/${FILE}`,
      `${USER}/${NOTE}`,
      `${USER}/${NOTE}/${FILE}.png?x=1`,
      "",
    ]) {
      expect(isOwnPath(bad, USER)).toBe(false);
    }
    expect(isOwnPath(`${USER}/${NOTE}/${FILE}.png`, "")).toBe(false);
  });

  it("isUuid: nur die kanonische (kleine) Form", () => {
    expect(isUuid(NOTE)).toBe(true);
    expect(isUuid(NOTE.toUpperCase())).toBe(false);
    expect(isUuid(`${NOTE}x`)).toBe(false);
    expect(isUuid("../x")).toBe(false);
  });

  it("Schlüssel = alter Bucket + Pfad, und zurück", () => {
    const path = `${USER}/${NOTE}/${FILE}.pdf`;
    expect(objectKey("attachments", path)).toBe(`attachments/${path}`);
    expect(parseKey(`attachments/${path}`)).toEqual({ bucket: "attachments", path });
    expect(parseKey(`fremd/${path}`)).toBeNull();
    expect(folderPrefix("note-images", USER, NOTE)).toBe(`note-images/${USER}/${NOTE}/`);
  });

  it("Typ: einfache MIME-Form, Standard octet-stream", () => {
    expect(normalizeContentType(undefined)).toBe("application/octet-stream");
    expect(normalizeContentType("Application/PDF")).toBe("application/pdf");
    expect(normalizeContentType("text/html; charset=utf-8")).toBeNull();
    expect(normalizeContentType("kein typ")).toBeNull();
    expect(normalizeContentType(5)).toBeNull();
  });

  it("Grenzen: Bild 10 MB, Datei 100 MB, Bildtypen nur aus IMAGE_EXT", () => {
    const base = { userId: USER, ownerId: NOTE, uuid: FILE };
    const MB = 1024 * 1024;
    const img = (size: number, contentType = "image/png") =>
      planUpload({ ...base, bucket: "note-images", contentType, size });
    expect(img(10 * MB)).toMatchObject({ ok: true, path: `${USER}/${NOTE}/${FILE}.png` });
    expect(img(10 * MB + 1).ok).toBe(false);
    expect(img(0).ok).toBe(false);
    expect(img(1.5).ok).toBe(false);
    expect(img(10, "application/pdf").ok).toBe(false);
    expect(img(10, "image/jpeg")).toMatchObject({ path: `${USER}/${NOTE}/${FILE}.jpg` });
    const file = (size: number, name = "Bericht.DOCX") =>
      planUpload({ ...base, bucket: "attachments", contentType: undefined, size, name });
    expect(file(100 * MB)).toMatchObject({
      ok: true,
      contentType: "application/octet-stream",
      path: `${USER}/${NOTE}/${FILE}.docx`,
    });
    expect(file(100 * MB + 1).ok).toBe(false);
    expect(file(5, "ohne-endung")).toMatchObject({ path: `${USER}/${NOTE}/${FILE}.bin` });
    expect(
      planUpload({ ...base, ownerId: "../x", bucket: "attachments", contentType: "a/b", size: 1 })
        .ok,
    ).toBe(false);
  });
});

describe("Konfiguration", () => {
  it("braucht alle vier Werte, sonst null", () => {
    expect(readR2Config(env)).toMatchObject({ bucket: "triskel-dateien-test" });
    expect(readR2Config({ ...env, R2_SECRET_ACCESS_KEY: "" })).toBeNull();
    expect(readR2Config({})).toBeNull();
    expect(readR2Config({ ...env, R2_ACCOUNT_ID: "evil.example/x" })).toBeNull();
  });

  it("Schutz: Prod-Bucket bei NODE_ENV=test bricht ab", () => {
    expect(() => readR2Config({ ...env, R2_BUCKET: PROD_BUCKET, NODE_ENV: "test" })).toThrow(
      R2GuardError,
    );
    expect(readR2Config({ ...env, R2_BUCKET: PROD_BUCKET, NODE_ENV: "production" })).not.toBeNull();
  });

  it("Ursprung fest auf den EU-Endpunkt", () => {
    expect(r2Origin("abc")).toBe("https://abc.eu.r2.cloudflarestorage.com");
    expect(r2ConnectOrigin(env)).toBe(`https://${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`);
    expect(r2ConnectOrigin({})).toBeNull();
    const config = required(readR2Config(env));
    expect(objectUrl(config, "attachments/a b/c.pdf")).toBe(
      `https://${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com/triskel-dateien-test/attachments/a%20b/c.pdf`,
    );
  });
});

describe("Signatur", () => {
  const config = required(readR2Config(env));
  const key = `attachments/${USER}/${NOTE}/${FILE}.pdf`;

  it("PUT-Link signiert content-length und content-type, Ablauf 5 min", async () => {
    const link = await presignPut(config, key, { contentType: "application/pdf", size: 1234 });
    const url = new URL(link.url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.host).toBe(`${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/triskel-dateien-test/${key}`);
    expect(link.headers).toEqual({ "content-type": "application/pdf" });
  });

  it("andere Größe oder anderer Typ → andere Signatur; Ablauf als Parameter", async () => {
    const sig = async (size: number, contentType: string) =>
      new URL((await presignPut(config, key, { contentType, size })).url).searchParams.get(
        "X-Amz-Signature",
      );
    const base = await sig(1234, "application/pdf");
    expect(await sig(1235, "application/pdf")).not.toBe(base);
    expect(await sig(1234, "text/plain")).not.toBe(base);
    const hour = await presignPut(config, key, { contentType: "a/b", size: 1, seconds: 3600 });
    expect(new URL(hour.url).searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("exclusive (KI): if-none-match mit signiert und als Kopf zurückgegeben – ein PUT je Link", async () => {
    const link = await presignPut(config, key, {
      contentType: "application/pdf",
      size: 1234,
      seconds: 3600,
      exclusive: true,
    });
    expect(new URL(link.url).searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host;if-none-match",
    );
    expect(link.headers).toEqual({ "content-type": "application/pdf", "if-none-match": "*" });
  });

  it("GET-Link: nur host signiert, 5 min", async () => {
    const url = new URL(await presignGet(config, key));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });
});

describe("Liste", () => {
  it("liest Schlüssel und Fortsetzung", () => {
    const xml =
      "<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a/b&amp;c.pdf</Key></Contents>" +
      "<Contents><Key>a/d.pdf</Key></Contents><NextContinuationToken>tok</NextContinuationToken></ListBucketResult>";
    expect(parseListXml(xml)).toEqual({ keys: ["a/b&c.pdf", "a/d.pdf"], nextToken: "tok" });
    expect(
      parseListXml("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"),
    ).toEqual({
      keys: [],
      nextToken: null,
    });
  });
});
