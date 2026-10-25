/**
 * Alter Datei-Bucket „attachments“ (Migration 19, #27) gegen das Testprojekt. Seit Migration 44
 * (R2, E41) nur noch lesen: jeder Nutzer sieht nur den eigenen Ordner, ohne zweiten Faktor (aal1)
 * und ohne Anmeldung nichts – und niemand (auch nicht mit aal2) legt dort etwas ab, ändert oder
 * löscht.
 */
import { afterAll, describe, expect, inject, it } from "vitest";
import { addLegacyRow, dropLegacyRow, writePolicies } from "../support/legacy-storage";
import { aal1Client, anonClient, runMarker, userClient } from "../support/supabase-node";

const sessionA = inject("sessionA");
const sessionB = inject("sessionB");
const a = userClient(sessionA);
const b = userClient(sessionB);
const marker = runMarker().replace(/[^a-z0-9-]/gi, "-");
const ownerId = `test-${marker}`;
const folder = `${sessionA.userId}/${ownerId}`;
const pdfPath = `${folder}/plan.pdf`;
const pdf = () => new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" });

afterAll(async () => {
  await dropLegacyRow("attachments", pdfPath);
});

describe("Alter Datei-Bucket (nur lesen, Migration 44)", () => {
  it("keine erlaubende Schreib-Policy mehr; nur die Lese-Policy bleibt", async () => {
    expect(await writePolicies("attachments")).toEqual([]);
  });

  it("A lädt nichts mehr hoch, auch nicht in den eigenen Ordner", async () => {
    const up = await a.storage
      .from("attachments")
      .upload(pdfPath, pdf(), { contentType: "application/pdf" });
    expect(up.error).not.toBeNull();
    const doc = await a.storage
      .from("attachments")
      .upload(`${folder}/bericht.docx`, new Blob(["x"]), {
        contentType: "application/octet-stream",
      });
    expect(doc.error).not.toBeNull();
  });

  it("A sieht die vorhandene Datei im eigenen Ordner, B und aal1/anon nicht", async () => {
    await addLegacyRow("attachments", pdfPath, sessionA.userId);
    const own = await a.storage.from("attachments").list(folder);
    expect(own.error).toBeNull();
    expect((own.data ?? []).map((f) => f.name)).toEqual(["plan.pdf"]);
    const seenByB = await b.storage.from("attachments").list(folder);
    expect(seenByB.data ?? []).toEqual([]);
    const aal1 = await aal1Client(sessionA).storage.from("attachments").list(folder);
    expect(aal1.data ?? []).toEqual([]);
    const anon = await anonClient().storage.from("attachments").list(folder);
    expect(anon.data ?? []).toEqual([]);
  });

  it("A kann die vorhandene Datei weder ändern noch entfernen", async () => {
    const overwrite = await a.storage
      .from("attachments")
      .upload(pdfPath, pdf(), { contentType: "application/pdf", upsert: true });
    expect(overwrite.error).not.toBeNull();
    const moved = await a.storage.from("attachments").move(pdfPath, `${folder}/neu.pdf`);
    expect(moved.error).not.toBeNull();
    await a.storage.from("attachments").remove([pdfPath]);
    const still = await a.storage.from("attachments").list(folder);
    expect((still.data ?? []).map((f) => f.name)).toEqual(["plan.pdf"]);
  });

  it("A darf nicht in B's Ordner schreiben", async () => {
    const foreign = await a.storage
      .from("attachments")
      .upload(`${sessionB.userId}/${ownerId}/fremd.pdf`, pdf(), { contentType: "application/pdf" });
    expect(foreign.error).not.toBeNull();
  });
});
