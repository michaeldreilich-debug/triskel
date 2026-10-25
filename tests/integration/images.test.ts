/**
 * Alter Bilder-Bucket „note-images“ (Migration 18) gegen das Testprojekt. Seit Migration 44 (R2,
 * E41) nur noch lesen: jeder Nutzer sieht nur den eigenen Ordner, ohne zweiten Faktor (aal1) und
 * ohne Anmeldung nichts – und niemand (auch nicht mit aal2) legt dort etwas ab, ändert oder löscht.
 */
import { afterAll, describe, expect, inject, it } from "vitest";
import { addLegacyRow, dropLegacyRow, writePolicies } from "../support/legacy-storage";
import { aal1Client, anonClient, runMarker, userClient } from "../support/supabase-node";

const sessionA = inject("sessionA");
const sessionB = inject("sessionB");
const a = userClient(sessionA);
const b = userClient(sessionB);
const marker = runMarker().replace(/[^a-z0-9-]/gi, "-");
const noteId = `test-${marker}`;
const folder = `${sessionA.userId}/${noteId}`;
const path = `${folder}/bild.png`;
// 1×1 PNG
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const blob = () => new Blob([png], { type: "image/png" });

afterAll(async () => {
  await dropLegacyRow("note-images", path);
});

describe("Alter Bilder-Bucket (nur lesen, Migration 44)", () => {
  it("keine erlaubende Schreib-Policy mehr; nur die Lese-Policy bleibt", async () => {
    expect(await writePolicies("note-images")).toEqual([]);
  });

  it("A lädt nichts mehr hoch, auch nicht in den eigenen Ordner", async () => {
    const up = await a.storage
      .from("note-images")
      .upload(path, blob(), { contentType: "image/png" });
    expect(up.error).not.toBeNull();
  });

  it("A sieht die vorhandene Datei im eigenen Ordner, B und aal1/anon nicht", async () => {
    await addLegacyRow("note-images", path, sessionA.userId);
    const own = await a.storage.from("note-images").list(folder);
    expect(own.error).toBeNull();
    expect((own.data ?? []).map((f) => f.name)).toEqual(["bild.png"]);
    const seenByB = await b.storage.from("note-images").list(folder);
    expect(seenByB.data ?? []).toEqual([]);
    const aal1 = await aal1Client(sessionA).storage.from("note-images").list(folder);
    expect(aal1.data ?? []).toEqual([]);
    const anon = await anonClient().storage.from("note-images").list(folder);
    expect(anon.data ?? []).toEqual([]);
  });

  it("A kann die vorhandene Datei weder ändern noch entfernen", async () => {
    const overwrite = await a.storage
      .from("note-images")
      .upload(path, blob(), { contentType: "image/png", upsert: true });
    expect(overwrite.error).not.toBeNull();
    const moved = await a.storage.from("note-images").move(path, `${folder}/neu.png`);
    expect(moved.error).not.toBeNull();
    await a.storage.from("note-images").remove([path]);
    const still = await a.storage.from("note-images").list(folder);
    expect((still.data ?? []).map((f) => f.name)).toEqual(["bild.png"]);
  });

  it("A darf nicht in B's Ordner schreiben", async () => {
    const foreign = await a.storage
      .from("note-images")
      .upload(`${sessionB.userId}/${noteId}/fremd.png`, blob(), { contentType: "image/png" });
    expect(foreign.error).not.toBeNull();
  });
});
