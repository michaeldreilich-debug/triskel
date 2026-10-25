/**
 * Dateien in R2 (E41, R1) gegen den Test-Bucket `triskel-dateien-test` und das Testprojekt:
 * signierter PUT nimmt nur genau Größe und Typ, GET-Link, fremde Pfade, aal1, fremder Besitzer.
 * Aufgeräumt wird in `finally`/`afterAll` (nur eigene Objekte).
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { FileContext } from "@/features/storage/access";
import {
  deleteObjects,
  getObject,
  headObject,
  listKeys,
  putObject,
  R2Error,
} from "@/features/storage/client";
import { readR2Config } from "@/features/storage/config";
import {
  handleDelete,
  handleExists,
  handleLinks,
  handleList,
  handleUpload,
} from "@/features/storage/handlers";
import { objectKey } from "@/features/storage/paths";
import { presignGet, presignPut } from "@/features/storage/signing";
import { assertR2TestBucket } from "../guard";
import { readEnvFile } from "../support/env-file";
import { aal1Client, userClient } from "../support/supabase-node";

assertR2TestBucket();
const config = readR2Config(readEnvFile(".env.test.local"));
const sessionA = inject("sessionA");
const sessionB = inject("sessionB");
const db = userClient(sessionA);
const noteA = crypto.randomUUID();
const noteB = crypto.randomUUID();
const created: string[] = [];
const ctx = (over: Partial<FileContext> = {}): FileContext => ({
  userId: sessionA.userId,
  supabase: db,
  config: config as NonNullable<typeof config>,
  actor: "app",
  ...over,
});
interface Json {
  links: { url: string }[];
  path: string;
  url: string;
  paths: string[];
  exists?: boolean;
  size?: number;
}
const json = async (response: Response) => (await response.json()) as Json;

beforeAll(async () => {
  expect(config, "R2-Werte fehlen in .env.test.local").not.toBeNull();
  const { data } = await db.from("areas").select("id").order("sort").limit(1).single();
  const areaId = data?.id ?? "";
  expect(areaId).not.toBe("");
  const own = await db.from("notes").insert({ id: noteA, title: "R2-Test A", area_id: areaId });
  expect(own.error).toBeNull();
  const other = userClient(sessionB);
  const { data: areaB } = await other.from("areas").select("id").order("sort").limit(1).single();
  const foreign = await other
    .from("notes")
    .insert({ id: noteB, title: "R2-Test B", area_id: areaB?.id ?? "" });
  expect(foreign.error).toBeNull();
});

afterAll(async () => {
  if (config && created.length > 0) await deleteObjects(config, created);
  await db.from("notes").delete().eq("id", noteA);
  await userClient(sessionB).from("notes").delete().eq("id", noteB);
});

const put = (url: string, body: Uint8Array, contentType: string) =>
  fetch(url, { method: "PUT", headers: { "content-type": contentType }, body: body as BodyInit });

describe("signierter PUT", () => {
  it("nimmt genau Größe und Typ an, lehnt andere Größe und anderen Typ ab", async () => {
    const key = objectKey("attachments", `${sessionA.userId}/${noteA}/${crypto.randomUUID()}.txt`);
    created.push(key);
    const data = new TextEncoder().encode("hallo r2");
    const link = await presignPut(ctx().config, key, {
      contentType: "text/plain",
      size: data.length,
    });

    const tooBig = await put(link.url, new TextEncoder().encode("hallo r2 und mehr"), "text/plain");
    expect(tooBig.ok, "R2 setzt die Größe nicht durch").toBe(false);
    const tooSmall = await put(link.url, new TextEncoder().encode("hi"), "text/plain");
    expect(tooSmall.ok, "R2 setzt die Größe nicht durch").toBe(false);
    const wrongType = await put(link.url, data, "application/pdf");
    expect(wrongType.ok, "R2 setzt den Typ nicht durch").toBe(false);
    expect((await headObject(ctx().config, key)).exists).toBe(false);

    const good = await put(link.url, data, "text/plain");
    expect(good.status).toBe(200);
    expect(await headObject(ctx().config, key)).toMatchObject({
      exists: true,
      size: data.length,
      contentType: "text/plain",
    });
  });

  it("GET-Link liefert den Inhalt; Server-GET und Liste sehen ihn", async () => {
    const path = `${sessionA.userId}/${noteA}/${crypto.randomUUID()}.txt`;
    const key = objectKey("attachments", path);
    created.push(key);
    const data = new TextEncoder().encode("lesen");
    const link = await presignPut(ctx().config, key, {
      contentType: "text/plain",
      size: data.length,
    });
    expect((await put(link.url, data, "text/plain")).status).toBe(200);
    const res = await fetch(await presignGet(ctx().config, key));
    expect(await res.text()).toBe("lesen");
    const direct = await getObject(ctx().config, key);
    expect(new TextDecoder().decode(direct?.body)).toBe("lesen");
    expect(await listKeys(ctx().config, `attachments/${sessionA.userId}/${noteA}/`)).toContain(key);
  });
});

describe("Kein Überschreiben (P, Vormerkung 1)", () => {
  const text = (value: string) => new TextEncoder().encode(value);
  const stored = async (key: string) =>
    new TextDecoder().decode((await getObject(ctx().config, key))?.body);

  it("hochladen: vorhandener Pfad bekommt keinen Link (409), die Datei bleibt", async () => {
    const id = crypto.randomUUID();
    const path = `${sessionA.userId}/${noteA}/${id}.txt`;
    const key = objectKey("attachments", path);
    created.push(key);
    const base = {
      bucket: "attachments",
      ownerId: noteA,
      contentType: "text/plain",
      name: "a.txt",
    };
    const first = await json(await handleUpload(ctx(), { ...base, size: 4, id }));
    expect(first.path).toBe(path);
    expect((await put(first.url, text("eins"), "text/plain")).status).toBe(200);

    const again = await handleUpload(ctx(), { ...base, size: 4, id });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("Datei gibt es schon.");
    // auch die KI bekommt keinen Link auf einen vorhandenen Pfad
    expect((await handleUpload(ctx({ actor: "ai" }), { ...base, size: 4, id })).status).toBe(409);
    expect(await stored(key)).toBe("eins");
  });

  it("Server-PUT (KI: Chat, Notion) überschreibt nie – R2 lehnt mit 412 ab", async () => {
    const key = objectKey("attachments", `${sessionA.userId}/${noteA}/${crypto.randomUUID()}.txt`);
    created.push(key);
    await putObject(ctx().config, key, text("eins"), "text/plain");
    const error = await putObject(ctx().config, key, text("zwei"), "text/plain").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(R2Error);
    expect((error as R2Error).status).toBe(412);
    expect(await stored(key)).toBe("eins");
  });

  it("KI-Link (exclusive): nimmt genau einen PUT an; zweiter und einer ohne If-None-Match scheitern", async () => {
    const res = await handleUpload(
      ctx({ actor: "ai" }),
      { bucket: "attachments", ownerId: noteA, contentType: "text/plain", size: 4, name: "k.txt" },
      { seconds: 3600, exclusive: true },
    );
    expect(res.status).toBe(200);
    const link = (await res.json()) as {
      path: string;
      url: string;
      headers: Record<string, string>;
    };
    const key = objectKey("attachments", link.path);
    created.push(key);
    expect(link.headers).toEqual({ "content-type": "text/plain", "if-none-match": "*" });
    const send = (headers: Record<string, string>, body: string) =>
      fetch(link.url, { method: "PUT", headers, body: text(body) as BodyInit });
    // ohne den signierten Kopf: abgelehnt (Signatur)
    expect((await send({ "content-type": "text/plain" }, "eins")).ok).toBe(false);
    expect((await send(link.headers, "eins")).status).toBe(200);
    expect((await send(link.headers, "zwei")).status).toBe(412);
    expect((await send({ "content-type": "text/plain" }, "drei")).ok).toBe(false);
    expect(await stored(key)).toBe("eins");
  });

  it("hochladen: Kennung und Besitzer nur in kleiner Schreibweise (sonst findet das Aufräumen sie nicht)", async () => {
    const base = { bucket: "attachments", contentType: "text/plain", size: 3, name: "x.txt" };
    const upper = crypto.randomUUID().toUpperCase();
    expect((await handleUpload(ctx(), { ...base, ownerId: noteA, id: upper })).status).toBe(400);
    expect((await handleUpload(ctx(), { ...base, ownerId: noteA.toUpperCase() })).status).toBe(404);
  });
});

describe("Handler", () => {
  it("links: eigener Pfad bekommt Link, fremde user_id und ungültige Pfade werden abgelehnt", async () => {
    const path = `${sessionA.userId}/${noteA}/${crypto.randomUUID()}.png`;
    const ok = await handleLinks(ctx(), { items: [{ bucket: "note-images", path }] });
    expect(ok.status).toBe(200);
    expect((await json(ok)).links[0].url).toContain("X-Amz-Signature=");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    const foreign = `${sessionB.userId}/${noteB}/${crypto.randomUUID()}.png`;
    expect(
      (await handleLinks(ctx(), { items: [{ bucket: "note-images", path: foreign }] })).status,
    ).toBe(403);
    expect((await handleLinks(ctx(), { items: [{ bucket: "x", path }] })).status).toBe(403);
    expect((await handleLinks(ctx(), { items: [] })).status).toBe(400);
  });

  it("hochladen: Pfad vom Server, PUT-Link passt; falsche Eingaben und fremder Besitzer abgelehnt", async () => {
    const res = await handleUpload(ctx(), {
      bucket: "attachments",
      ownerId: noteA,
      contentType: "text/plain",
      size: 3,
      name: "x.txt",
    });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.path).toMatch(new RegExp(`^${sessionA.userId}/${noteA}/[0-9a-f-]{36}\\.txt$`));
    created.push(objectKey("attachments", out.path));
    expect((await put(out.url, new TextEncoder().encode("abc"), "text/plain")).status).toBe(200);
    const exists = await json(await handleExists(ctx(), { bucket: "attachments", path: out.path }));
    expect(exists).toMatchObject({ exists: true, size: 3 });

    const base = { bucket: "attachments", ownerId: noteA, contentType: "text/plain", size: 3 };
    // gewählte Kennung (Browser setzt den Pfad vor dem Hochladen in den Inhalt): nur eine UUID
    const chosen = crypto.randomUUID();
    const withId = await json(await handleUpload(ctx(), { ...base, name: "y.txt", id: chosen }));
    expect(withId.path).toBe(`${sessionA.userId}/${noteA}/${chosen}.txt`);
    expect((await handleUpload(ctx(), { ...base, id: "../x" })).status).toBe(400);
    expect((await handleUpload(ctx(), { ...base, size: 0 })).status).toBe(400);
    expect((await handleUpload(ctx(), { ...base, size: 101 * 1024 * 1024 })).status).toBe(400);
    expect((await handleUpload(ctx(), { ...base, bucket: "note-images" })).status).toBe(400);
    // Notiz von Nutzer B gehört A nicht (RLS) – auch nicht mit eigener user_id im Pfad
    expect((await handleUpload(ctx(), { ...base, ownerId: noteB })).status).toBe(404);
    expect((await handleUpload(ctx(), { ...base, ownerId: crypto.randomUUID() })).status).toBe(404);
    // aal1-Token sieht den eigenen Eintrag nicht (Migration 13) → 404
    const aal1 = ctx({ supabase: aal1Client(sessionA) });
    expect((await handleUpload(aal1, base)).status).toBe(404);
  });

  it("vorhanden: fremder Pfad abgelehnt, fehlendes Objekt = exists false", async () => {
    const missing = `${sessionA.userId}/${noteA}/${crypto.randomUUID()}.png`;
    expect(await json(await handleExists(ctx(), { bucket: "note-images", path: missing }))).toEqual(
      { exists: false },
    );
    const foreign = `${sessionB.userId}/${noteB}/${crypto.randomUUID()}.png`;
    expect((await handleExists(ctx(), { bucket: "note-images", path: foreign })).status).toBe(403);
  });

  it("liste/loeschen: App darf eigene, KI nie, fremde Pfade nicht", async () => {
    const path = `${sessionA.userId}/${noteA}/${crypto.randomUUID()}.txt`;
    const key = objectKey("attachments", path);
    created.push(key);
    const link = await presignPut(ctx().config, key, { contentType: "text/plain", size: 1 });
    expect((await put(link.url, new TextEncoder().encode("x"), "text/plain")).status).toBe(200);

    const ai = ctx({ actor: "ai" });
    expect((await handleList(ai, { bucket: "attachments", ownerId: noteA })).status).toBe(403);
    expect((await handleDelete(ai, { bucket: "attachments", paths: [path] })).status).toBe(403);
    expect((await headObject(ctx().config, key)).exists).toBe(true);

    const foreign = `${sessionB.userId}/${noteB}/${crypto.randomUUID()}.txt`;
    expect(
      (await handleDelete(ctx(), { bucket: "attachments", paths: [path, foreign] })).status,
    ).toBe(403);
    expect((await headObject(ctx().config, key)).exists).toBe(true);

    const listed = await json(await handleList(ctx(), { bucket: "attachments", ownerId: noteA }));
    expect(listed.paths).toContain(path);
    // R-2: der Besitzer (noteA) lebt → nichts löschen (409), die Datei bleibt
    const living = await handleDelete(ctx(), { bucket: "attachments", paths: [path] });
    expect(living.status).toBe(409);
    expect(await living.json()).toMatchObject({ living: [noteA] });
    expect((await headObject(ctx().config, key)).exists).toBe(true);
    // Besitzer weg (endgültig gelöscht) → löschen geht
    const gone = crypto.randomUUID();
    const orphan = `${sessionA.userId}/${gone}/${crypto.randomUUID()}.txt`;
    const orphanKey = objectKey("attachments", orphan);
    created.push(orphanKey);
    const orphanLink = await presignPut(ctx().config, orphanKey, {
      contentType: "text/plain",
      size: 1,
    });
    expect((await put(orphanLink.url, new TextEncoder().encode("x"), "text/plain")).status).toBe(
      200,
    );
    // gemischt: ein lebender Besitzer sperrt den ganzen Aufruf
    expect(
      (await handleDelete(ctx(), { bucket: "attachments", paths: [path, orphan] })).status,
    ).toBe(409);
    expect((await headObject(ctx().config, orphanKey)).exists).toBe(true);
    expect((await handleDelete(ctx(), { bucket: "attachments", paths: [orphan] })).status).toBe(
      200,
    );
    expect((await headObject(ctx().config, orphanKey)).exists).toBe(false);
    expect((await headObject(ctx().config, key)).exists).toBe(true);
  });

  it("hochladen mit R2_EXCLUSIVE_UPLOADS (R-5): auch der App-Link nimmt nur einen PUT an", async () => {
    const exclusive = ctx({
      config: { ...(config as NonNullable<typeof config>), exclusiveUploads: true },
    });
    const id = crypto.randomUUID();
    const response = await handleUpload(exclusive, {
      bucket: "attachments",
      ownerId: noteA,
      contentType: "text/plain",
      size: 2,
      name: "r5.txt",
      id,
    });
    expect(response.status).toBe(200);
    const link = (await response.json()) as {
      path: string;
      url: string;
      headers: Record<string, string>;
    };
    created.push(objectKey("attachments", link.path));
    expect(link.headers["if-none-match"]).toBe("*");
    const body = new TextEncoder().encode("r5");
    const first = await fetch(link.url, { method: "PUT", headers: link.headers, body });
    expect(first.status).toBe(200);
    const second = await fetch(link.url, { method: "PUT", headers: link.headers, body });
    expect(second.status).toBe(412);
    // ohne Schalter wie bisher: kein if-none-match im Link der App
    const plain = await handleUpload(ctx(), {
      bucket: "attachments",
      ownerId: noteA,
      contentType: "text/plain",
      size: 2,
      name: "r5b.txt",
      id: crypto.randomUUID(),
    });
    const plainLink = (await plain.json()) as { path: string; headers: Record<string, string> };
    expect(plainLink.headers["if-none-match"]).toBeUndefined();
  });
});
