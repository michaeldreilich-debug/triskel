/**
 * Öffentliche Freigabe (#94, E42, Migration 45) gegen das Testprojekt und den R2-Test-Bucket:
 * anon liest die Tabelle nie, nur Titel und Blöcke per Token; B sieht As Freigaben nicht und kann
 * keine fremde Notiz freigeben; die Datei-Route leitet nur für Dateien der freigegebenen Notiz auf
 * einen signierten Link um (fremder oder nicht enthaltener Pfad, beendet → 404).
 * Aufgeräumt wird in `afterAll` (nur eigene Notizen und Objekte).
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { newShareToken } from "@/features/share/token";
import { deleteObjects, putObject } from "@/features/storage/client";
import { readR2Config } from "@/features/storage/config";
import { objectKey } from "@/features/storage/paths";
import { handleSharedFile, sharedFileLookup } from "@/features/storage/shared";
import { assertR2TestBucket } from "../guard";
import { readEnvFile } from "../support/env-file";
import { aal1Client, anonClient, runMarker, userClient } from "../support/supabase-node";

assertR2TestBucket();
const config = readR2Config(readEnvFile(".env.test.local"));
const sessionA = inject("sessionA");
const sessionB = inject("sessionB");
const a = userClient(sessionA);
const b = userClient(sessionB);
const anon = anonClient();
const marker = runMarker();
const noteId = crypto.randomUUID();
const linkedId = crypto.randomUUID();
const shareId = crypto.randomUUID();
const token = newShareToken();
const imagePath = `${sessionA.userId}/${noteId}/${crypto.randomUUID()}.png`;
const filePath = `${sessionA.userId}/${noteId}/${crypto.randomUUID()}.txt`;
const created: string[] = [];
// 1×1 PNG
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const route = (t: string, path: string | null, name: string | null = null) =>
  handleSharedFile(
    { token: t, path, name },
    { config, lookup: (tok, p) => sharedFileLookup(anon)(tok, p) },
  );

beforeAll(async () => {
  expect(config, "R2-Werte fehlen in .env.test.local").not.toBeNull();
  const { data: area } = await a.from("areas").select("id").order("sort").limit(1).single();
  const notes = await a.from("notes").insert(
    [
      { id: noteId, area_id: area?.id ?? "", title: `Freigabe ${marker}`, tags: ["geheimtag"] },
      { id: linkedId, area_id: area?.id ?? "", title: `Verlinkt geheim ${marker}` },
    ],
    { defaultToNull: false },
  );
  expect(notes.error, notes.error?.message).toBeNull();
  const blocks = await a.from("note_blocks").insert(
    [
      {
        note_id: noteId,
        sort: "a0",
        content: {
          type: "paragraph",
          content: [
            { type: "text", text: `Öffentlich ${marker} ` },
            { type: "noteLink", attrs: { noteId: linkedId } },
          ],
        },
        content_text: `Öffentlich ${marker} [[Verlinkt geheim ${marker}]]`,
      },
      {
        note_id: noteId,
        sort: "a1",
        content: {
          type: "paragraph",
          content: [
            { type: "noteImage", attrs: { path: imagePath, alt: "Bild" } },
            {
              type: "noteFile",
              attrs: { path: filePath, name: "Liste Ä.txt", mime: "text/plain" },
            },
          ],
        },
      },
    ],
    { defaultToNull: false },
  );
  expect(blocks.error, blocks.error?.message).toBeNull();
  const share = await a.from("note_shares").insert({ id: shareId, note_id: noteId, token });
  expect(share.error, share.error?.message).toBeNull();
  if (config) {
    const imageKey = objectKey("note-images", imagePath);
    const fileKey = objectKey("attachments", filePath);
    created.push(imageKey, fileKey);
    await putObject(config, imageKey, PNG, "image/png");
    await putObject(config, fileKey, new TextEncoder().encode("hallo"), "text/html");
  }
});

afterAll(async () => {
  if (config && created.length > 0) await deleteObjects(config, created);
  await a.from("notes").delete().in("id", [noteId, linkedId]);
});

describe("Tabelle note_shares", () => {
  it("anon liest und schreibt nichts", async () => {
    const read = await anon.from("note_shares").select("*").limit(1);
    expect(read.data).toBeNull();
    expect(read.error?.code).toBe("42501");
    const write = await anon
      .from("note_shares")
      .insert({ note_id: noteId, token: newShareToken() });
    expect(write.error?.code).toBe("42501");
  });

  it("B sieht As Freigabe nicht und kann As Notiz nicht freigeben", async () => {
    const seen = await b.from("note_shares").select("id").eq("id", shareId);
    expect(seen.error).toBeNull();
    expect(seen.data).toEqual([]);
    const foreign = await b.from("note_shares").insert({ note_id: noteId, token: newShareToken() });
    expect(foreign.error?.code).toBe("23503");
    // auch nicht über den Token
    const update = await b
      .from("note_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token", token)
      .select();
    expect(update.data).toEqual([]);
  });

  it("ohne zweiten Faktor (aal1, auch KI-Tokens) sieht A die eigene Freigabe nicht", async () => {
    const { data, error } = await aal1Client(sessionA).from("note_shares").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A sieht die eigene Freigabe; eine zweite aktive für dieselbe Notiz geht nicht", async () => {
    const own = await a.from("note_shares").select("token").eq("id", shareId).single();
    expect(own.data?.token).toBe(token);
    const second = await a.from("note_shares").insert({ note_id: noteId, token: newShareToken() });
    expect(second.error?.code).toBe("23505");
  });
});

describe("shared_note (anon)", () => {
  it("liefert Titel und Blöcke, ohne Eigenschaften und ohne Ziel der verknüpften Notiz", async () => {
    const { data, error } = await anon.rpc("shared_note", { p_token: token });
    expect(error).toBeNull();
    const note = data as { title: string; blocks: Array<{ content: unknown }> };
    expect(note.title).toBe(`Freigabe ${marker}`);
    expect(note.blocks).toHaveLength(2);
    const raw = JSON.stringify(data);
    for (const secret of ["geheimtag", "Verlinkt geheim", linkedId, "content_text", "area"]) {
      expect(raw, secret).not.toContain(secret);
    }
  });

  it("unbekannt oder falsches Format → null", async () => {
    for (const bad of [newShareToken(), "kurz", `${token}x`]) {
      const { data, error } = await anon.rpc("shared_note", { p_token: bad });
      expect(error).toBeNull();
      expect(data).toBeNull();
    }
  });
});

describe("Datei-Route /api/freigabe/<token>/datei", () => {
  it("Bild der Notiz: 302 auf einen signierten Link, R2 liefert es als Bild", async () => {
    const res = await route(token, imagePath);
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const location = res.headers.get("location") ?? "";
    expect(location).toContain(".r2.cloudflarestorage.com/");
    const file = await fetch(location);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it("Datei: nur zum Herunterladen mit dem Namen aus der Notiz (Endung bleibt), auch wenn sie als HTML hochgeladen wurde", async () => {
    const res = await route(token, filePath, "Liste Ä.html");
    expect(res.status).toBe(302);
    const file = await fetch(res.headers.get("location") ?? "");
    expect(file.status).toBe(200);
    const disposition = file.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="Liste _\.txt"/);
    expect(disposition).toContain("filename*=UTF-8''Liste%20%C3%84.txt");
    expect(await file.text()).toBe("hallo");
  });

  it("fremder, nicht enthaltener oder ungültiger Pfad und falscher Token → 404", async () => {
    const missing = `${sessionA.userId}/${noteId}/${crypto.randomUUID()}.png`;
    const foreign = `${sessionB.userId}/${noteId}/${imagePath.split("/")[2]}`;
    for (const [t, path] of [
      [token, missing],
      [token, foreign],
      [token, `../${imagePath}`],
      [token, null],
      [newShareToken(), imagePath],
      ["kurz", imagePath],
    ] as const) {
      const res = await route(t, path);
      expect(res.status, String(path)).toBe(404);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("Notiz im Papierkorb → 404 und Seite null; zurückgeholt → wieder da; beendet → 404", async () => {
    await a.from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", noteId);
    expect((await route(token, imagePath)).status).toBe(404);
    expect((await anon.rpc("shared_note", { p_token: token })).data).toBeNull();
    await a.from("notes").update({ deleted_at: null }).eq("id", noteId);
    expect((await route(token, imagePath)).status).toBe(302);

    const ended = await a
      .from("note_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", shareId)
      .select("id");
    expect(ended.data).toHaveLength(1);
    expect((await route(token, imagePath)).status).toBe(404);
    expect((await anon.rpc("shared_note", { p_token: token })).data).toBeNull();
  });
});
