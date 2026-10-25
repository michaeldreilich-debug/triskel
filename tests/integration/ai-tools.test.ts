/**
 * KI-Schnittstelle (#33) gegen das Testprojekt: die MCP-Werkzeuge mit dem Token von Testnutzer A
 * (aal2) über eine In-Memory-Verbindung. Prüft, dass Anlegen und Ändern dieselben Daten ergeben
 * wie die App (Blöcke, Links, Tags, Aufgaben aus Checkboxen, Wiederholung, Fahrplan) und dass
 * jede Schreibaktion im KI-Protokoll steht. Die Anmeldung selbst prüft oauth.test.ts.
 */
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { editedBlockIds, parseUndo, undoConflicts, undoOps } from "@/features/ai/activity";
import { MAX_INLINE_BASE64_CHARS } from "@/features/ai/server/media";
import { SHARED_NOTE_LOCKED } from "@/features/ai/server/shares";
import { recapId } from "@/features/recaps/model";
import { newShareToken } from "@/features/share/token";
import { getObject } from "@/features/storage/client";
import { objectKey } from "@/features/storage/paths";
import { createSupabasePersister, type PersisterClient } from "@/lib/save-queue/supabase-persister";
import { asAllowedAi, connectAi } from "../support/mcp";
import { removeR2Folders, testR2Config } from "../support/media";
import { runMarker, userClient } from "../support/supabase-node";

const sessionA = inject("sessionA");
const sessionB = inject("sessionB");
const db = userClient(sessionA);
const marker = runMarker();
const clientId = `test-${marker}`;
const r2 = testR2Config();
let ai: Awaited<ReturnType<typeof connectAi>>;
const storedText = async (bucket: string, path: string) => {
  const got = await getObject(r2 as NonNullable<typeof r2>, objectKey(bucket as never, path));
  return got ? new TextDecoder().decode(got.body) : null;
};
const storedBytes = async (bucket: string, path: string) => {
  const got = await getObject(r2 as NonNullable<typeof r2>, objectKey(bucket as never, path));
  return got ? Buffer.from(got.body) : null;
};

const idOf = (structured: Record<string, unknown> | undefined) => String(structured?.id ?? "");
const activity = async (entityId: string) =>
  (
    await db
      .from("ai_activity")
      .select("tool, entity, summary, undo")
      .eq("client_id", clientId)
      .eq("entity_id", entityId)
      .order("created_at")
  ).data ?? [];

beforeAll(async () => {
  ai = await connectAi({
    db: asAllowedAi(db),
    userId: sessionA.userId,
    clientId,
    origin: "https://app.test",
    now: () => new Date(),
    r2,
  });
});

afterAll(async () => {
  await ai?.close();
  const like = `${marker}%`;
  const notes = (await db.from("notes").select("id").like("title", like)).data ?? [];
  if (r2) {
    // Dateien dieses Laufs im Test-Bucket: nur Ordner der eigenen Notizen und Aufgaben
    const tasks = (await db.from("tasks").select("id").like("title", like)).data ?? [];
    const ids = [...notes, ...tasks].map((row) => row.id);
    for (const bucket of ["note-images", "attachments"] as const) {
      await removeR2Folders(r2, bucket, sessionA.userId, ids);
    }
  }
  await db
    .from("note_blocks")
    .delete()
    .in(
      "note_id",
      notes.map((n) => n.id),
    );
  await db
    .from("notes")
    .delete()
    .in(
      "id",
      notes.map((n) => n.id),
    );
  const projects = (await db.from("projects").select("id").like("title", like)).data ?? [];
  await db
    .from("projects")
    .update({ next_task_id: null })
    .in(
      "id",
      projects.map((p) => p.id),
    );
  await db.from("tasks").delete().like("title", like);
  await db
    .from("milestones")
    .delete()
    .in(
      "project_id",
      projects.map((p) => p.id),
    );
  await db
    .from("projects")
    .delete()
    .in(
      "id",
      projects.map((p) => p.id),
    );
  await db.from("topics").delete().like("name", like);
  await db.from("ai_activity").delete().eq("client_id", clientId);
});

describe("Lesen", () => {
  it("overview nennt Bereiche mit IDs und die erlaubten Werte", async () => {
    const result = await ai.call("overview");
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/- Privat \(id: [0-9a-f-]{36}\)/);
    expect(result.text).toContain("Aufgaben-Status: offen (Offen)");
  });
});

describe("Notizen", () => {
  let targetId = "";
  let noteId = "";

  it("create_note: Gliederung, [[Link]], #tag, Checkbox → Blöcke, Link, Tag, Aufgabe", async () => {
    const target = await ai.call("create_note", {
      titel: `${marker} Ziel`,
      bereich: "Privat",
      inhalt: "- Ziel",
    });
    targetId = idOf(target.structured);
    const result = await ai.call("create_note", {
      titel: `${marker} Protokoll`,
      typ: "protokoll",
      bereich: "privat",
      thema: `${marker} Thema`,
      thema_anlegen: true,
      inhalt: [
        `- Anlass ${marker}wort`,
        `  - siehe [[${marker} Ziel]]`,
        "- Beschlüsse #beschluss",
        `- [ ] ${marker} Termin klären`,
      ].join("\n"),
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain("4 Zeilen · 1 Aufgaben aus Checkboxen");
    noteId = idOf(result.structured);

    const note = (await db.from("notes").select("type, tags, topic_id").eq("id", noteId).single())
      .data;
    expect(note?.type).toBe("protokoll");
    expect(note?.tags).toContain("beschluss");
    expect(note?.topic_id).toBeTruthy();
    const blocks =
      (await db.from("note_blocks").select("id, parent_id, task_id").eq("note_id", noteId)).data ??
      [];
    expect(blocks).toHaveLength(4);
    expect(blocks.filter((b) => b.parent_id)).toHaveLength(1);
    const links = (await db.from("links").select("target_note_id").eq("source_note_id", noteId))
      .data;
    expect(links?.map((l) => l.target_note_id)).toEqual([targetId]);
    const taskId = blocks.find((b) => b.task_id)?.task_id as string;
    const task = (
      await db.from("tasks").select("title, area_id, in_inbox").eq("id", taskId).single()
    ).data;
    expect(task).toMatchObject({ title: `${marker} Termin klären`, in_inbox: false });
    expect((await activity(noteId)).map((a) => a.tool)).toEqual(["create_note"]);
  });

  it("fetch liefert dieselbe Gliederung zurück; search findet die Notiz", async () => {
    const result = await ai.call("fetch", { id: noteId });
    expect(result.text).toContain(`- Anlass ${marker}wort\n  - siehe [[${marker} Ziel]]`);
    expect(result.text).toContain(`- [ ] ${marker} Termin klären`);
    expect(result.text).toContain("notiztyp: Protokoll");
    const hits = await ai.call("search", { query: `${marker}wort` });
    expect(hits.text).toContain(`${marker} Protokoll`);
    expect(hits.structured?.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: noteId, kind: "notiz" })]),
    );
  });

  it("update_note: anhängen hängt unten an, ersetzen löscht nur weich (Rückgängig-Daten)", async () => {
    const before =
      (await db.from("note_blocks").select("id, sort").eq("note_id", noteId).is("parent_id", null))
        .data ?? [];
    const appended = await ai.call("update_note", { id: noteId, inhalt: "- Nachtrag" });
    expect(appended.text).toContain("1 Zeilen angehängt");
    const fetched = await ai.call("fetch", { id: noteId });
    expect(fetched.text.trimEnd()).toMatch(/- Nachtrag\n\n\[In der App öffnen\]/);

    const live =
      (await db.from("note_blocks").select("id").eq("note_id", noteId).is("deleted_at", null))
        .data ?? [];
    expect(live.length).toBe(5);
    const replaced = await ai.call("update_note", {
      id: noteId,
      titel: `${marker} Protokoll neu`,
      inhalt: "- Nur noch das",
      inhalt_modus: "ersetzen",
    });
    expect(replaced.isError, replaced.text).toBe(false);
    const after =
      (await db.from("note_blocks").select("id, deleted_at").eq("note_id", noteId)).data ?? [];
    expect(after.filter((b) => !b.deleted_at)).toHaveLength(1);
    expect(after.filter((b) => b.deleted_at)).toHaveLength(5);
    const log = await activity(noteId);
    const undo = log.at(-1)?.undo as { kind: string; removed: string[]; note_before: unknown };
    expect(undo.kind).toBe("replace");
    expect([...undo.removed].sort()).toEqual(live.map((b) => b.id).sort());
    expect(undo.note_before).toEqual({ title: `${marker} Protokoll` });
    expect(before.length).toBe(3);
  });

  it("Rückgängig aus dem KI-Protokoll (über den Persister der App) holt den alten Inhalt zurück", async () => {
    const log =
      (
        await db
          .from("ai_activity")
          .select("id, undo")
          .eq("client_id", clientId)
          .eq("entity_id", noteId)
          .eq("tool", "update_note")
          .order("created_at")
      ).data ?? [];
    const last = log.at(-1);
    expect(last).toBeTruthy();
    const persist = createSupabasePersister(() => db as unknown as PersisterClient);
    await persist(undoOps(last as { id: string; undo: unknown }, new Date().toISOString()));
    const live =
      (await db.from("note_blocks").select("id").eq("note_id", noteId).is("deleted_at", null))
        .data ?? [];
    expect(live).toHaveLength(5);
    const note = (await db.from("notes").select("title").eq("id", noteId).single()).data;
    expect(note?.title).toBe(`${marker} Protokoll`);
    const marked = (
      await db
        .from("ai_activity")
        .select("undone_at")
        .eq("id", (last as { id: string }).id)
        .single()
    ).data;
    expect(marked?.undone_at).toBeTruthy();
    const fetched = await ai.call("fetch", { id: noteId });
    expect(fetched.text).toContain(`- Anlass ${marker}wort`);
    expect(fetched.text).not.toContain("Nur noch das");
  });

  it("ohne Bereich, Thema oder Projekt → verständlicher Fehler, nichts angelegt", async () => {
    const result = await ai.call("create_note", { titel: `${marker} ohne Ort` });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Bereich fehlt");
    const rows = (await db.from("notes").select("id").eq("title", `${marker} ohne Ort`)).data;
    expect(rows).toEqual([]);
  });
});

describe("Öffentlich freigegebene Notiz (#94, Migration 46): die KI ändert sie nicht", () => {
  it("update_note, attach_file, prepare_upload lehnen ab; fetch nennt die Freigabe; beendet → geht wieder", async () => {
    const { data: area } = await db.from("areas").select("id").order("sort").limit(1).single();
    const noteId = crypto.randomUUID();
    const created = await db
      .from("notes")
      .insert({ id: noteId, title: `${marker} Einsatzplan öffentlich`, area_id: area?.id ?? "" });
    expect(created.error).toBeNull();
    await db.from("note_blocks").insert({
      note_id: noteId,
      sort: "a0",
      content: { type: "paragraph", content: [{ type: "text", text: "Plan" }] },
      content_text: "Plan",
    });
    const share = await db
      .from("note_shares")
      .insert({ note_id: noteId, token: newShareToken() })
      .select("id")
      .single();
    expect(share.error).toBeNull();
    const blocks = async () =>
      (await db.from("note_blocks").select("id").eq("note_id", noteId).is("deleted_at", null)).data
        ?.length;

    for (const [tool, args] of [
      ["update_note", { id: noteId, inhalt: "- Zugangsdaten: geheim" }],
      ["update_note", { id: noteId, inhalt: "- neu", inhalt_modus: "ersetzen" }],
      ["update_note", { id: noteId, titel: "Gekapert" }],
      ["update_note", { id: noteId, tags_hinzu: ["ki"] }],
      [
        "attach_file",
        { ziel: noteId, inhalt_base64: Buffer.from("geheim").toString("base64"), name: "a.txt" },
      ],
      ["prepare_upload", { ziel: noteId, name: "a.pdf", groesse: 10 }],
    ] as const) {
      const result = await ai.call(tool, args);
      expect(result.isError, `${tool}: ${result.text}`).toBe(true);
      expect(result.text).toBe(SHARED_NOTE_LOCKED);
    }
    expect(await blocks()).toBe(1);
    const note = await db.from("notes").select("title, tags").eq("id", noteId).single();
    expect(note.data).toEqual({ title: `${marker} Einsatzplan öffentlich`, tags: [] });

    const read = await ai.call("fetch", { id: noteId, bilder: false });
    expect(read.isError).toBe(false);
    expect(read.text).toContain("Öffentlich freigegeben");
    expect(read.structured?.metadata).toMatchObject({ kind: "notiz", oeffentlich: true });

    await db
      .from("note_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", share.data?.id ?? "");
    const after = await ai.call("update_note", { id: noteId, inhalt: "- Nachtrag" });
    expect(after.isError, after.text).toBe(false);
    expect(await blocks()).toBe(2);
    const plainRead = await ai.call("fetch", { id: noteId, bilder: false });
    expect(plainRead.text).not.toContain("Öffentlich freigegeben");
  });
});

describe("Dateien (attach_file)", () => {
  it("PDF von einem Notion-Link an Notiz und Aufgabe – im eigenen Ordner gespeichert", async () => {
    const realFetch = globalThis.fetch;
    // nur der Notion-Abruf ist gespielt; R2 (Test-Bucket) und Supabase laufen echt
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://file.notion.so/")) {
        return new Response("%PDF-1.7 Test", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return realFetch(input, init);
    });
    try {
      const note = await ai.call("create_note", { titel: `${marker} Belege`, bereich: "Privat" });
      const noteId = idOf(note.structured);
      const attached = await ai.call("attach_file", {
        ziel: noteId,
        url: "https://file.notion.so/f/f/s/f/Arzt%20M%C3%A4rz.pdf?signature=x",
        ganz_anzeigen: true,
      });
      expect(attached.isError, attached.text).toBe(false);
      expect(attached.text).toContain("Datei „Arzt März.pdf“");
      const block = (
        await db.from("note_blocks").select("content, content_text").eq("note_id", noteId).single()
      ).data;
      expect(block?.content_text).toBe("[Datei: Arzt März.pdf]");
      const paragraph = block?.content as
        | { content: Array<{ type: string; attrs: Record<string, unknown> }> }
        | undefined;
      const node = paragraph?.content[0];
      expect(node).toMatchObject({
        type: "noteFile",
        attrs: { name: "Arzt März.pdf", view: "full" },
      });
      const path = String(node?.attrs.path);
      expect(path.startsWith(`${sessionA.userId}/${noteId}/`)).toBe(true);
      expect(await storedText("attachments", path)).toBe("%PDF-1.7 Test");

      const task = await ai.call("create_task", {
        titel: `${marker} Beleg einreichen`,
        notiz: "Abgeben",
      });
      const taskId = idOf(task.structured);
      await ai.call("attach_file", {
        ziel: taskId,
        url: "https://file.notion.so/f/x/Quittung.pdf",
      });
      const row = (await db.from("tasks").select("body_text").eq("id", taskId).single()).data;
      expect(row?.body_text).toBe("Abgeben\n[Datei: Quittung.pdf]");

      const refused = await ai.call("attach_file", {
        ziel: taskId,
        url: "https://example.com/a.pdf",
      });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("nur von Notion");
    } finally {
      spy.mockRestore();
    }
  });

  it("Datei vom Rechner (#51, R3): prepare_upload mit groesse → PUT an den R2-Link → attach_file mit upload; falsche Größe und fremder Pfad werden abgelehnt", async () => {
    const note = await ai.call("create_note", { titel: `${marker} Bilanz`, bereich: "Privat" });
    const noteId = idOf(note.structured);
    const other = await ai.call("create_note", { titel: `${marker} Andere`, bereich: "Privat" });
    const otherId = idOf(other.structured);
    const content = "%PDF-1.7 Hochgeladen";
    const size = Buffer.byteLength(content);

    // groesse ist Pflicht und begrenzt
    const missing = await ai.call("prepare_upload", { ziel: noteId, name: "Bilanz 2026.pdf" });
    expect(missing.isError).toBe(true);
    const tooBig = await ai.call("prepare_upload", {
      ziel: noteId,
      name: "Riesig.pdf",
      groesse: 100 * 1024 * 1024 + 1,
    });
    expect(tooBig.isError).toBe(true);
    const bigImage = await ai.call("prepare_upload", {
      ziel: noteId,
      name: "Panorama.png",
      groesse: 11 * 1024 * 1024,
    });
    expect(bigImage.isError).toBe(true);
    expect(bigImage.text).toContain("als_datei");
    // fremde Notiz: kein Link
    const foreign = await ai.call("prepare_upload", {
      ziel: crypto.randomUUID(),
      name: "x.pdf",
      groesse: 10,
    });
    expect(foreign.isError).toBe(true);

    const prepared = await ai.call("prepare_upload", {
      ziel: noteId,
      name: "Bilanz 2026.pdf",
      groesse: size,
    });
    expect(prepared.isError, prepared.text).toBe(false);
    const uploadUrl = String(prepared.structured?.upload_url);
    const upload = String(prepared.structured?.upload);
    expect(prepared.structured).toMatchObject({
      method: "PUT",
      content_type: "application/pdf",
      groesse: size,
      // ein PUT je Link: ein zweiter überschreibt nichts (P)
      headers: { "content-type": "application/pdf", "if-none-match": "*" },
    });
    expect(prepared.text).toContain("If-None-Match: *");
    expect(upload.startsWith(`attachments:${sessionA.userId}/${noteId}/`)).toBe(true);
    // R2-Link, kein Supabase; 1 Stunde gültig
    const link = new URL(uploadUrl);
    expect(link.host).toBe(`${r2?.accountId}.eu.r2.cloudflarestorage.com`);
    expect(
      link.pathname.startsWith(`/${r2?.bucket}/attachments/${sessionA.userId}/${noteId}/`),
    ).toBe(true);
    expect(link.searchParams.get("X-Amz-Expires")).toBe("3600");

    // vor dem Hochladen: verständlicher Fehler, nichts angehängt
    const early = await ai.call("attach_file", { ziel: noteId, upload });
    expect(early.isError).toBe(true);
    expect(early.text).toContain("noch keine Datei");

    // falsche Größe und falscher Typ: R2 lehnt den PUT ab
    const wrongSize = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf", "if-none-match": "*" },
      body: `${content} und mehr`,
    });
    expect(wrongSize.ok).toBe(false);
    const wrongType = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "text/plain", "if-none-match": "*" },
      body: content,
    });
    expect(wrongType.ok).toBe(false);
    expect((await ai.call("attach_file", { ziel: noteId, upload })).text).toContain(
      "noch keine Datei",
    );

    // so lädt die KI hoch: roher Dateiinhalt per PUT mit den Headern aus prepare_upload, ohne Schlüssel
    const headers = prepared.structured?.headers as Record<string, string>;
    const put = await fetch(uploadUrl, { method: "PUT", headers, body: content });
    expect(put.ok, await put.clone().text()).toBe(true);
    // ein zweiter PUT an denselben Link überschreibt nichts – auch nicht mit gleicher Größe
    const overwrite = "%PDF-1.7 ".padEnd(size, "x");
    expect(Buffer.byteLength(overwrite)).toBe(size);
    expect((await fetch(uploadUrl, { method: "PUT", headers, body: overwrite })).status).toBe(412);
    expect(
      (
        await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": "application/pdf" },
          body: overwrite,
        })
      ).ok,
    ).toBe(false);

    const wrongTarget = await ai.call("attach_file", { ziel: otherId, upload });
    expect(wrongTarget.isError).toBe(true);
    expect(wrongTarget.text).toContain("gehört nicht");
    // fremder Pfad im Verweis (anderer Nutzer, Ordner-Trick, anderer Bucket)
    const [, rest] = upload.split(":");
    const file = String(rest).split("/").pop();
    for (const evil of [
      `attachments:${sessionB.userId}/${noteId}/${file}`,
      `attachments:${sessionA.userId}/${noteId}/../${otherId}/${file}`,
      `avatars:${sessionA.userId}/${noteId}/${file}`,
      `https://example.com/${file}`,
    ]) {
      const refused = await ai.call("attach_file", { ziel: noteId, upload: evil });
      expect(refused.isError, evil).toBe(true);
    }
    const both = await ai.call("attach_file", {
      ziel: noteId,
      upload,
      url: "https://file.notion.so/f/x.pdf",
    });
    expect(both.isError).toBe(true);
    expect(both.text).toContain("Genau eins");

    const attached = await ai.call("attach_file", {
      ziel: noteId,
      upload,
      name: "Bilanz 2026.pdf",
      ganz_anzeigen: true,
    });
    expect(attached.isError, attached.text).toBe(false);
    expect(attached.text).toContain("Datei „Bilanz 2026.pdf“");
    const block = (
      await db.from("note_blocks").select("content, content_text").eq("note_id", noteId).single()
    ).data;
    expect(block?.content_text).toBe("[Datei: Bilanz 2026.pdf]");
    const paragraph = block?.content as
      | { content: Array<{ type: string; attrs: Record<string, unknown> }> }
      | undefined;
    const node = paragraph?.content[0];
    expect(node).toMatchObject({
      type: "noteFile",
      attrs: { name: "Bilanz 2026.pdf", mime: "application/pdf", view: "full", size },
    });
    expect(`attachments:${String(node?.attrs.path)}`).toBe(upload);
    expect(await storedText("attachments", String(node?.attrs.path))).toBe(content);
    expect((await activity(noteId)).map((a) => a.tool)).toContain("attach_file");

    // Bilder landen im Bilder-Bucket und erscheinen als Bild
    const image = await ai.call("prepare_upload", { ziel: noteId, name: "Foto.png", groesse: 100 });
    expect(String(image.structured?.upload)).toMatch(/^note-images:/);
    expect(image.structured?.content_type).toBe("image/png");
  });

  it("ohne KI-Freigabe (Token ohne freigegebenen Client) gibt es weder Hochlade-Link noch Datei", async () => {
    const note = await ai.call("create_note", { titel: `${marker} Gesperrt`, bereich: "Privat" });
    const plain = await connectAi({
      db,
      userId: sessionA.userId,
      clientId,
      origin: "https://app.test",
      now: () => new Date(),
      r2,
    });
    try {
      const refused = await plain.call("prepare_upload", {
        ziel: idOf(note.structured),
        name: "a.pdf",
        groesse: 10,
      });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("nicht freigegeben");
      const inline = await plain.call("attach_file", {
        ziel: idOf(note.structured),
        inhalt_base64: Buffer.from("%PDF-1.7").toString("base64"),
        name: "a.pdf",
      });
      expect(inline.isError).toBe(true);
      expect(inline.text).toContain("nicht freigegeben");
    } finally {
      await plain.close();
    }
  });

  it("Die KI löscht nie: kein Werkzeug zum Löschen oder Auflisten von Dateien, die Speicher-Schicht sperrt es", async () => {
    const { tools } = await ai.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.filter((n) => /delete_file|remove|list_files|list_attachments/.test(n))).toEqual(
      [],
    );
    const { handleDelete, handleList } = await import("@/features/storage/handlers");
    const files = {
      userId: sessionA.userId,
      supabase: db,
      config: r2 as never,
      actor: "ai" as const,
    };
    const path = `${sessionA.userId}/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`;
    expect((await handleDelete(files, { bucket: "attachments", paths: [path] })).status).toBe(403);
    expect(
      (await handleList(files, { bucket: "attachments", ownerId: crypto.randomUUID() })).status,
    ).toBe(403);
  });
});

describe("Bilder und Dateien für die KI (#71)", () => {
  type Block = {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: { mimeType?: string; blob?: string };
  };
  /** Werkzeug aufrufen und alle Inhalte (Text, Bild, Ressource) behalten */
  const raw = async (name: string, args: Record<string, unknown>) => {
    const result = await ai.client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Block[];
    return {
      content,
      text: content.map((c) => c.text ?? "").join("\n"),
      images: content.filter((c) => c.type === "image"),
      isError: result.isError === true,
      structured: result.structuredContent,
    };
  };
  const png = async (color: string, width = 40, height = 30) =>
    (
      await sharp({ create: { width, height, channels: 3, background: color } })
        .png()
        .toBuffer()
    ).toString("base64");
  const MINI_PDF = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    "4 0 obj<</Length 44>>stream",
    "BT /F1 18 Tf 20 100 Td (Hallo Welt) Tj ET",
    "endstream endobj",
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n");
  const stored: Array<{ bucket: string; path: string }> = [];
  type Node = { type: string; attrs: Record<string, unknown> };
  const noteNodes = async (noteId: string) =>
    (
      (await db.from("note_blocks").select("content").eq("note_id", noteId).order("sort")).data ??
      []
    ).flatMap((b) => ((b.content as { content?: Node[] }).content ?? []) as Node[]);

  afterAll(async () => {
    if (!r2) return;
    const owners = [...new Set(stored.map((f) => f.path.split("/")[1] as string))];
    for (const bucket of ["note-images", "attachments"] as const) {
      await removeR2Folders(r2, bucket, sessionA.userId, owners);
    }
  });

  it("attach_file mit inhalt_base64 (Umlaute im Namen) → Bild bzw. Datei-Kachel, KI-Protokoll; fetch liefert das Bild, get_attachment Bild und Text", async () => {
    const note = await ai.call("create_note", {
      titel: `${marker} Namensliste Tallys`,
      bereich: "Privat",
      inhalt: "Liste vom Einsatz",
    });
    const noteId = idOf(note.structured);
    const image = await png("#c0392b");
    const attached = await ai.call("attach_file", {
      ziel: noteId,
      inhalt_base64: image,
      name: "Namensliste Tallys Überlingen.png",
    });
    expect(attached.isError, attached.text).toBe(false);
    expect(attached.text).toContain("Bild „Namensliste Tallys Überlingen.png“");
    const text = await ai.call("attach_file", {
      ziel: noteId,
      inhalt_base64: `data:text/plain;base64,${Buffer.from("Grüße aus Überlingen\nZeile 2").toString("base64")}`,
      name: "Grüße März.txt",
    });
    expect(text.isError, text.text).toBe(false);

    const nodes = await noteNodes(noteId);
    const imageNode = nodes.find((n) => n.type === "noteImage") as Node;
    const fileNode = nodes.find((n) => n.type === "noteFile") as Node;
    const imagePath = String(imageNode.attrs.path);
    const filePath = String(fileNode.attrs.path);
    stored.push(
      { bucket: "note-images", path: imagePath },
      { bucket: "attachments", path: filePath },
    );
    expect(imagePath).toMatch(new RegExp(`^${sessionA.userId}/${noteId}/[0-9a-f-]{36}\\.png$`));
    expect(imageNode.attrs.alt).toBe("Namensliste Tallys Überlingen.png");
    expect(fileNode.attrs).toMatchObject({
      name: "Grüße März.txt",
      mime: "text/plain",
      size: Buffer.byteLength("Grüße aus Überlingen\nZeile 2"),
    });
    expect((await storedBytes("note-images", imagePath))?.toString("base64")).toBe(image);
    const log = await activity(noteId);
    const attachLog = log.filter((a) => a.tool === "attach_file");
    expect(attachLog).toHaveLength(2);
    expect(attachLog[0]?.undo).toMatchObject({ kind: "append", note_id: noteId });

    // fetch: Bild als Bildinhalt (klein → unverändert), Verweise im Abschnitt „Bilder und Dateien“
    const imageRef = imagePath.split("/").pop() as string;
    const fetched = await raw("fetch", { id: noteId });
    expect(fetched.isError).toBe(false);
    expect(fetched.text).toContain(`![[${imageRef}]]`);
    expect(fetched.text).toContain("## Bilder und Dateien");
    expect(fetched.text).toContain(`Bild 1 von 1: ![[${imageRef}]]`);
    expect(fetched.text).toMatch(
      /Datei „Grüße März\.txt“ \(TXT, 1 KB\): \[\[Grüße März-[0-9a-f]{8}\.txt\]\]/,
    );
    expect(fetched.images).toEqual([{ type: "image", data: image, mimeType: "image/png" }]);
    const textOnly = await raw("fetch", { id: noteId, bilder: false });
    expect(textOnly.images).toEqual([]);
    expect(textOnly.text).toContain("nicht mitgeliefert (bilder: false)");
    expect(textOnly.text).toContain(
      `„get_attachment“ mit eintrag „${noteId}“ und datei „${imageRef}“`,
    );

    // get_attachment: Bild und Text der Datei, nur was im Eintrag steht
    const one = await raw("get_attachment", { eintrag: noteId, datei: `![[${imageRef}]]` });
    expect(one.isError, one.text).toBe(false);
    expect(one.images).toEqual([{ type: "image", data: image, mimeType: "image/png" }]);
    const txt = await raw("get_attachment", { eintrag: noteId, datei: "Grüße März.txt" });
    expect(txt.isError, txt.text).toBe(false);
    expect(txt.text).toContain("Grüße aus Überlingen\nZeile 2");
    // ohne strukturierte Daten – sonst zeigt Claude Code nur diese und der Inhalt fehlt
    expect([one.structured, txt.structured]).toEqual([undefined, undefined]);
    for (const datei of [
      `${sessionB.userId}/${noteId}/${imageRef}`,
      `${sessionA.userId}/${noteId}/../${imageRef}`,
      "attachments:../../x.png",
      "fremd.png",
    ]) {
      const refused = await raw("get_attachment", { eintrag: noteId, datei });
      expect(refused.isError, datei).toBe(true);
      expect(refused.text).toContain("steht nicht in diesem Eintrag");
    }
    // Lesen schreibt nicht ins KI-Protokoll
    expect((await activity(noteId)).filter((a) => a.tool === "attach_file")).toHaveLength(2);
    expect((await activity(noteId)).map((a) => a.tool)).not.toContain("get_attachment");
  });

  it("ersetzen mit dem Text aus fetch behält Bilder und Datei-Kacheln (Notiz und Aufgabe, O8)", async () => {
    /** Inhalt aus „fetch“: zwischen „# Titel“ und dem nächsten Abschnitt (## …) */
    const bodyOf = (text: string, title: string) =>
      (text.split(`# ${title}\n\n`)[1] ?? "")
        .split("\n## ")[0]
        ?.split("\n[In der App")[0]
        ?.trim() ?? "";
    const mediaOf = (nodes: Node[]) =>
      nodes
        .filter((n) => n.type === "noteImage" || n.type === "noteFile")
        .map((n) => ({ type: n.type, path: n.attrs.path, name: n.attrs.name ?? n.attrs.alt }));

    // Notiz: Text, Bild, Datei
    const title = `${marker} Ersetzen mit Bild`;
    const note = await ai.call("create_note", {
      titel: title,
      bereich: "Privat",
      inhalt: "Vorher",
    });
    const noteId = idOf(note.structured);
    for (const [inhalt_base64, name] of [
      [await png("#2e86c1"), "Foto.png"],
      [Buffer.from("Zeile 1").toString("base64"), "Liste.txt"],
    ] as const) {
      const attached = await ai.call("attach_file", { ziel: noteId, inhalt_base64, name });
      expect(attached.isError, attached.text).toBe(false);
    }
    const before = mediaOf(await noteNodes(noteId));
    expect(before.map((m) => m.type)).toEqual(["noteImage", "noteFile"]);
    for (const m of before) {
      stored.push({
        bucket: m.type === "noteImage" ? "note-images" : "attachments",
        path: String(m.path),
      });
    }
    const fetched = await raw("fetch", { id: noteId, bilder: false });
    const text = bodyOf(fetched.text, title);
    expect(text).toContain("![[");
    const replaced = await ai.call("update_note", {
      id: noteId,
      inhalt: `${text}\n- Nachher`,
      inhalt_modus: "ersetzen",
    });
    expect(replaced.isError, replaced.text).toBe(false);
    // nur die lebenden Blöcke (die alten liegen weich gelöscht daneben, fürs Rückgängig)
    const live = (
      (
        await db
          .from("note_blocks")
          .select("content")
          .eq("note_id", noteId)
          .is("deleted_at", null)
          .order("sort")
      ).data ?? []
    ).flatMap((b) => ((b.content as { content?: Node[] }).content ?? []) as Node[]);
    expect(mediaOf(live)).toEqual(before);
    const again = await raw("fetch", { id: noteId });
    expect(again.images).toHaveLength(1);
    expect(bodyOf(again.text, title)).toBe(`${text}\n- Nachher`);

    // Aufgabe: Bild in der Notiz der Aufgabe
    const taskTitle = `${marker} Aufgabe mit Bild`;
    const task = await ai.call("create_task", {
      titel: taskTitle,
      bereich: "Privat",
      notiz: "Vorher",
    });
    const taskId = idOf(task.structured);
    const attached = await ai.call("attach_file", {
      ziel: taskId,
      inhalt_base64: await png("#27ae60"),
      name: "Skizze.png",
    });
    expect(attached.isError, attached.text).toBe(false);
    const bodyNodes = async () => {
      const row = (await db.from("tasks").select("body").eq("id", taskId).single()).data;
      const flat: Node[] = [];
      const walk = (node: { type?: string; content?: unknown[] } & Partial<Node>) => {
        if (node.type === "noteImage" || node.type === "noteFile") flat.push(node as Node);
        for (const child of (node.content ?? []) as (typeof node)[]) walk(child);
      };
      walk((row?.body ?? {}) as Node);
      return flat;
    };
    const taskBefore = mediaOf(await bodyNodes());
    expect(taskBefore).toHaveLength(1);
    stored.push({ bucket: "note-images", path: String(taskBefore[0]?.path) });
    const taskText = bodyOf((await raw("fetch", { id: taskId, bilder: false })).text, taskTitle);
    expect(taskText).toContain("![[");
    const updated = await ai.call("update_task", {
      id: taskId,
      notiz: `Neu oben\n${taskText}`,
      notiz_modus: "ersetzen",
    });
    expect(updated.isError, updated.text).toBe(false);
    expect(mediaOf(await bodyNodes())).toEqual(taskBefore);
  });

  it("fremde user_id im Inhalt: weder fetch noch get_attachment lädt die Datei", async () => {
    const note = await ai.call("create_note", {
      titel: `${marker} Fremdes Bild`,
      bereich: "Privat",
    });
    const noteId = idOf(note.structured);
    const foreign = `${sessionB.userId}/${noteId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
    const content = {
      type: "paragraph",
      content: [{ type: "noteImage", attrs: { path: foreign, alt: "", width: null } }],
    };
    const inserted = await db.from("note_blocks").insert({
      id: crypto.randomUUID(),
      note_id: noteId,
      parent_id: null,
      sort: "a0",
      content: content as never,
      content_text: "[Bild]",
      collapsed: false,
      task_id: null,
    });
    expect(inserted.error).toBeNull();
    const fetched = await raw("fetch", { id: noteId });
    expect(fetched.isError).toBe(false);
    expect(fetched.images).toEqual([]);
    expect(fetched.text).toContain("nicht ladbar: Diese Datei liegt nicht im eigenen Ordner.");
    const got = await raw("get_attachment", {
      eintrag: noteId,
      datei: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
    });
    expect(got.isError).toBe(true);
    expect(got.text).toContain("nicht im eigenen Ordner");
  });

  it("Grenzen: genau eine Quelle, Name nötig, Inhalt muss zum Typ passen, Größe begrenzt", async () => {
    const note = await ai.call("create_note", { titel: `${marker} Grenzen`, bereich: "Privat" });
    const noteId = idOf(note.structured);
    const hallo = Buffer.from("Hallo").toString("base64");
    const both = await ai.call("attach_file", {
      ziel: noteId,
      inhalt_base64: hallo,
      name: "a.txt",
      url: "https://file.notion.so/f/a.pdf",
    });
    expect(both.isError).toBe(true);
    expect(both.text).toContain("Genau eins");
    const unnamed = await ai.call("attach_file", { ziel: noteId, inhalt_base64: hallo });
    expect(unnamed.isError).toBe(true);
    expect(unnamed.text).toContain("auch „name“");
    const fakePng = await ai.call("attach_file", {
      ziel: noteId,
      inhalt_base64: hallo,
      name: "Foto.png",
    });
    expect(fakePng.isError).toBe(true);
    expect(fakePng.text).toContain("kein PNG-Bild");
    const fakePdf = await ai.call("attach_file", {
      ziel: noteId,
      inhalt_base64: hallo,
      name: "Beleg.pdf",
    });
    expect(fakePdf.isError).toBe(true);
    expect(fakePdf.text).toContain("kein PDF");
    const broken = await ai.call("attach_file", {
      ziel: noteId,
      inhalt_base64: "ab$cd",
      name: "a.txt",
    });
    expect(broken.isError).toBe(true);
    expect(broken.text).toContain("kein gültiges Base64");
    const huge = await ai.call("attach_file", {
      ziel: noteId,
      inhalt_base64: "A".repeat(MAX_INLINE_BASE64_CHARS + 4),
      name: "gross.bin",
    });
    expect(huge.isError).toBe(true);
    expect(huge.text).toContain("Zu groß");
    expect(await noteNodes(noteId)).toEqual([]);
    expect((await activity(noteId)).map((a) => a.tool)).not.toContain("attach_file");
  });

  it("Aufgabe: PDF aus dem Chat → get_attachment liest den Text, auf Wunsch eingebettet; fetch liefert höchstens 5 Bilder", async () => {
    const task = await ai.call("create_task", {
      titel: `${marker} Fotos sichten`,
      notiz: "Fotos:",
    });
    const taskId = idOf(task.structured);
    const pdf = await ai.call("attach_file", {
      ziel: taskId,
      inhalt_base64: Buffer.from(MINI_PDF).toString("base64"),
      name: "Bericht Übung.pdf",
      content_type: "application/pdf",
    });
    expect(pdf.isError, pdf.text).toBe(false);
    const colors = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"];
    for (const [index, color] of colors.entries()) {
      const added = await ai.call("attach_file", {
        ziel: taskId,
        inhalt_base64: await png(color),
        name: `Foto ${index + 1}.png`,
      });
      expect(added.isError, added.text).toBe(false);
    }
    const body = (await db.from("tasks").select("body, body_text").eq("id", taskId).single()).data;
    const walk = (node: {
      type?: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    }): Node[] => [
      ...(node.type === "noteImage" || node.type === "noteFile" ? [node as Node] : []),
      ...((node.content ?? []) as Array<typeof node>).flatMap(walk),
    ];
    const nodes = walk(body?.body as never);
    for (const node of nodes) {
      stored.push({
        bucket: node.type === "noteImage" ? "note-images" : "attachments",
        path: String(node.attrs.path),
      });
    }
    expect(body?.body_text).toContain("[Datei: Bericht Übung.pdf]");
    expect(nodes.filter((n) => n.type === "noteImage")).toHaveLength(6);

    const fetched = await raw("fetch", { id: taskId });
    expect(fetched.images).toHaveLength(5);
    const sixth = String(nodes.filter((n) => n.type === "noteImage")[5]?.attrs.path)
      .split("/")
      .pop();
    expect(fetched.text).toContain(
      `Bild 6 „Foto 6.png“: ![[${sixth}]] – nicht mitgeliefert (höchstens 5 Bilder je Antwort) → „get_attachment“ mit eintrag „${taskId}“ und datei „${sixth}“`,
    );
    const sixthImage = await raw("get_attachment", { eintrag: taskId, datei: String(sixth) });
    expect(sixthImage.images).toEqual([
      { type: "image", data: await png("#666666"), mimeType: "image/png" },
    ]);

    const read = await raw("get_attachment", { eintrag: taskId, datei: "Bericht Übung.pdf" });
    expect(read.isError, read.text).toBe(false);
    expect(read.text).toContain("PDF · 1 KB · 1 Seite");
    expect(read.text).toContain("Hallo Welt");
    expect(read.structured).toBeUndefined();
    expect(read.content.some((c) => c.type === "resource")).toBe(false);
    const embedded = await raw("get_attachment", {
      eintrag: taskId,
      datei: "Bericht Übung.pdf",
      pdf_einbetten: true,
    });
    const resource = embedded.content.find((c) => c.type === "resource");
    expect(resource?.resource?.mimeType).toBe("application/pdf");
    expect(Buffer.from(String(resource?.resource?.blob), "base64").toString()).toBe(MINI_PDF);
  });
});

describe("Aufgaben", () => {
  it("create_task ohne Bereich → Inbox; capture mit #privat → Bereich", async () => {
    const inbox = await ai.call("create_task", {
      titel: `${marker} Inbox`,
      notiz: "Vorher klären\n- [ ] Leiter",
    });
    const row = (
      await db
        .from("tasks")
        .select("in_inbox, area_id, body_text")
        .eq("id", idOf(inbox.structured))
        .single()
    ).data;
    expect(row).toMatchObject({
      in_inbox: true,
      area_id: null,
      body_text: "Vorher klären\nLeiter",
    });
    const captured = await ai.call("capture", { text: `${marker} Milch #privat` });
    expect(captured.text).toContain("Privat");
  });

  it("update_task erledigt → Folgeaufgabe bei Wiederholung; wieder öffnen räumt sie weg", async () => {
    const created = await ai.call("create_task", {
      titel: `${marker} Müll`,
      bereich: "Privat",
      faellig: "2026-10-19",
      wiederholung: "wöchentlich",
    });
    const taskId = idOf(created.structured);
    const done = await ai.call("update_task", { id: taskId, status: "erledigt" });
    expect(done.text).toMatch(/erledigt, nächste am 2026-10-26/);
    const next =
      (await db.from("tasks").select("id, due_date, deleted_at").eq("recurrence_source_id", taskId))
        .data ?? [];
    expect(next).toHaveLength(1);
    expect(next[0]?.due_date).toBe("2026-10-26");
    await ai.call("update_task", { id: taskId, status: "offen" });
    const after = (await db.from("tasks").select("status").eq("id", taskId).single()).data;
    expect(after?.status).toBe("offen");
    const trashed = (
      await db
        .from("tasks")
        .select("deleted_at")
        .eq("id", next[0]?.id as string)
        .single()
    ).data;
    expect(trashed?.deleted_at).toBeTruthy();
    expect((await activity(taskId)).map((a) => a.tool)).toEqual([
      "create_task",
      "update_task",
      "update_task",
    ]);
  });
  it("Checkliste (#86): letzter Punkt abgehakt → erledigt; neuer offener Punkt → wieder offen", async () => {
    const created = await ai.call("create_task", {
      titel: `${marker} Checkliste`,
      bereich: "Privat",
      notiz: "- [x] Leiter\n- [ ] Schlauch",
    });
    const taskId = idOf(created.structured);
    const status = async () =>
      (await db.from("tasks").select("status").eq("id", taskId).single()).data?.status;
    const done = await ai.call("update_task", {
      id: taskId,
      notiz: "- [x] Leiter\n- [x] Schlauch",
      notiz_modus: "ersetzen",
    });
    expect(done.text).toContain("erledigt (alle Punkte abgehakt)");
    expect(await status()).toBe("erledigt");
    const reopened = await ai.call("update_task", { id: taskId, notiz: "- [ ] Kupplung" });
    expect(reopened.text).toContain("Status offen (ein Punkt ist wieder offen)");
    expect(await status()).toBe("offen");
    // ausdrücklicher Status geht vor
    await ai.call("update_task", { id: taskId, status: "wartet", notiz: "- [x] Kupplung" });
    expect(await status()).toBe("wartet");
  });
  it("zustaendig (#77): „ki“ = Arbeitsschritt der KI, list_tasks filtert, update_task gibt zurück; „ki“ nur im Projekt (M-5)", async () => {
    // M-5: ohne Projekt wäre eine KI-Aufgabe nirgends sichtbar → Fehler statt stiller Anlage
    const loose = await ai.call("create_task", {
      titel: `${marker} Bauschritt lose`,
      bereich: "Privat",
      zustaendig: "ki",
    });
    expect(loose.isError).toBe(true);
    expect(loose.text).toContain("nur für Aufgaben in einem Projekt");
    const project = await ai.call("create_project", {
      titel: `${marker} KI-Projekt`,
      bereich: "Privat",
    });
    expect(project.isError, project.text).toBe(false);
    const step = await ai.call("create_task", {
      titel: `${marker} Bauschritt`,
      projekt: idOf(project.structured),
      zustaendig: "ki",
    });
    const stepId = idOf(step.structured);
    expect(step.isError, step.text).toBe(false);
    expect(step.text).toContain("für die KI");
    // Projekt lösen oder Inbox-Aufgabe auf „ki“ setzen: ebenfalls abgelehnt
    const detached = await ai.call("update_task", { id: stepId, projekt: "" });
    expect(detached.isError).toBe(true);
    expect(detached.text).toContain("nur für Aufgaben in einem Projekt");
    const mine = await ai.call("create_task", { titel: `${marker} Prüfen`, bereich: "Privat" });
    const mineId = idOf(mine.structured);
    const assignee = async (id: string) =>
      (await db.from("tasks").select("assignee").eq("id", id).single()).data?.assignee;
    expect(await assignee(stepId)).toBe("ai");
    expect(await assignee(mineId)).toBe("user");
    const inbox = await ai.call("update_task", { id: mineId, zustaendig: "ki" });
    expect(inbox.isError).toBe(true);
    const onlyAi = await ai.call("list_tasks", { bereich: "Privat", zustaendig: "ki" });
    expect(onlyAi.text).toContain(`${marker} Bauschritt`);
    expect(onlyAi.text).not.toContain(`${marker} Prüfen`);
    expect(onlyAi.text).toContain("für die KI");
    const fetched = await ai.call("fetch", { id: stepId });
    expect(fetched.text).toContain("zustaendig: KI");
    await ai.call("update_task", { id: stepId, zustaendig: "ich" });
    expect(await assignee(stepId)).toBe("user");
  });
});

describe("Eingaben der KI-Werkzeuge (S-8, S-9)", () => {
  it("create_task erledigt mit Wiederholung startet die Serie (Folgeaufgabe)", async () => {
    const created = await ai.call("create_task", {
      titel: `${marker} Schon erledigt`,
      bereich: "Privat",
      status: "erledigt",
      faellig: "2026-10-19",
      wiederholung: "wöchentlich",
    });
    expect(created.isError, created.text).toBe(false);
    expect(created.text).toContain("erledigt, nächste am 2026-10-26");
    const taskId = idOf(created.structured);
    const row = (await db.from("tasks").select("status, completed_at").eq("id", taskId).single())
      .data;
    expect(row?.status).toBe("erledigt");
    expect(row?.completed_at).toBeTruthy();
    const next =
      (await db.from("tasks").select("due_date, status").eq("recurrence_source_id", taskId)).data ??
      [];
    expect(next).toEqual([{ due_date: "2026-10-26", status: "offen" }]);
  });

  it("bereich an Projekt-Aufgabe oder -Notiz: verständlicher Fehler statt still verworfen", async () => {
    const areas = (await db.from("areas").select("id, name").order("sort")).data ?? [];
    const other = areas.find((a) => a.name !== "Privat")?.name as string;
    const project = await ai.call("create_project", {
      titel: `${marker} Bereichsprobe`,
      bereich: "Privat",
    });
    const projectId = idOf(project.structured);
    const refused = await ai.call("create_task", {
      titel: `${marker} Falscher Bereich`,
      projekt: projectId,
      bereich: other,
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Bereich folgt dem Projekt");

    const task = await ai.call("create_task", {
      titel: `${marker} Im Projekt`,
      projekt: projectId,
    });
    const taskId = idOf(task.structured);
    const update = await ai.call("update_task", { id: taskId, bereich: other });
    expect(update.isError).toBe(true);
    expect(update.text).toContain('projekt: ""');
    // gleicher Bereich wie das Projekt ist kein Widerspruch – und Projekt lösen + Bereich geht
    const same = await ai.call("update_task", { id: taskId, bereich: "Privat", titel: "x" });
    expect(same.isError, same.text).toBe(false);
    const moved = await ai.call("update_task", { id: taskId, projekt: "", bereich: other });
    expect(moved.isError, moved.text).toBe(false);
    const row = (await db.from("tasks").select("project_id, area_id").eq("id", taskId).single())
      .data;
    expect(row?.project_id).toBeNull();
    expect(row?.area_id).toBe(areas.find((a) => a.name === other)?.id);
    await db
      .from("tasks")
      .update({ title: `${marker} Im Projekt` })
      .eq("id", taskId);

    const note = await ai.call("create_note", {
      titel: `${marker} Projektnotiz`,
      projekt: projectId,
    });
    const noteUpdate = await ai.call("update_note", { id: idOf(note.structured), bereich: other });
    expect(noteUpdate.isError).toBe(true);
    expect(noteUpdate.text).toContain("Bereich folgt dem Projekt");
  });
});

describe("Rückgängig aus dem KI-Protokoll vollständig (G6)", () => {
  const persist = () => createSupabasePersister(() => db as unknown as PersisterClient);
  const undoLatest = async (entityId: string) => {
    const rows =
      (
        await db
          .from("ai_activity")
          .select("id, undo")
          .eq("client_id", clientId)
          .eq("entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(1)
      ).data ?? [];
    await persist()(undoOps(rows[0] as { id: string; undo: unknown }, new Date().toISOString()));
  };

  it("wieder geöffnete Wiederholung: Rückgängig holt die Folgeaufgabe zurück (S-3)", async () => {
    const created = await ai.call("create_task", {
      titel: `${marker} Serie`,
      bereich: "Privat",
      faellig: "2026-10-19",
      wiederholung: "wöchentlich",
    });
    const taskId = idOf(created.structured);
    await ai.call("update_task", { id: taskId, status: "erledigt" });
    await ai.call("update_task", { id: taskId, status: "offen" });
    await undoLatest(taskId);
    const task = (await db.from("tasks").select("status").eq("id", taskId).single()).data;
    expect(task?.status).toBe("erledigt");
    const next =
      (await db.from("tasks").select("deleted_at").eq("recurrence_source_id", taskId)).data ?? [];
    // genau eine Folgeaufgabe, wieder aus dem Papierkorb (keine zweite angelegt)
    expect(next).toEqual([{ deleted_at: null }]);
  });

  it("angehängte Checkbox: Rückgängig legt auch die entstandene Aufgabe in den Papierkorb (S-4)", async () => {
    const note = await ai.call("create_note", { titel: `${marker} Checkliste`, bereich: "Privat" });
    const noteId = idOf(note.structured);
    await ai.call("update_note", { id: noteId, inhalt: `- [ ] ${marker} Angebot einholen` });
    const task = (await db.from("tasks").select("id").eq("title", `${marker} Angebot einholen`))
      .data?.[0];
    expect(task).toBeTruthy();
    await undoLatest(noteId);
    const after = (
      await db
        .from("tasks")
        .select("deleted_at")
        .eq("id", task?.id as string)
        .single()
    ).data;
    expect(after?.deleted_at).toBeTruthy();
  });

  it("Projekt: Rückgängig holt Meilenstein-Änderungen zurück, auch ohne Projektfelder (S-10)", async () => {
    const project = await ai.call("create_project", {
      titel: `${marker} Fahrplan-Probe`,
      bereich: "Privat",
      meilensteine: [{ titel: "Planen" }],
    });
    const projectId = idOf(project.structured);
    await ai.call("update_project", {
      id: projectId,
      meilenstein_aendern: [{ meilenstein: "Planen", erreicht: true, titel: "Geplant" }],
      meilenstein_hinzu: [{ titel: "Bauen" }],
    });
    await undoLatest(projectId);
    const steps =
      (
        await db
          .from("milestones")
          .select("title, done_at, deleted_at")
          .eq("project_id", projectId)
          .order("sort")
      ).data ?? [];
    expect(steps).toEqual([
      { title: "Planen", done_at: null, deleted_at: null },
      { title: "Bauen", done_at: null, deleted_at: expect.any(String) },
    ]);
  });
});

describe("Papierkorb (trash)", () => {
  it("legt Notiz, Aufgabe, Projekt in den Papierkorb (nur per ID); Rückgängig holt sie zurück", async () => {
    const note = await ai.call("create_note", { titel: `${marker} Weg damit`, bereich: "Privat" });
    const task = await ai.call("create_task", {
      titel: `${marker} Aufgabe weg`,
      bereich: "Privat",
    });
    const project = await ai.call("create_project", {
      titel: `${marker} Projekt weg`,
      bereich: "Privat",
      aufgaben: [{ titel: `${marker} bleibt im Projekt` }],
    });
    const targets = [
      ["notiz", "notes", idOf(note.structured)],
      ["aufgabe", "tasks", idOf(task.structured)],
      ["projekt", "projects", idOf(project.structured)],
    ] as const;
    for (const [typ, table, id] of targets) {
      const trashed = await ai.call("trash", { typ, id });
      expect(trashed.isError, trashed.text).toBe(false);
      expect(trashed.text).toContain("Papierkorb");
      const row = (await db.from(table).select("deleted_at").eq("id", id).single()).data;
      expect(row?.deleted_at, table).toBeTruthy();
    }
    // nichts endgültig gelöscht: die Aufgabe im Projekt bleibt, wie in der App
    const kept = await db.from("tasks").select("deleted_at").like("title", `${marker} bleibt%`);
    expect(kept.data?.[0]?.deleted_at).toBeNull();
    // zweites Mal: schon im Papierkorb → verständlicher Fehler
    const again = await ai.call("trash", { typ: "notiz", id: targets[0][2] });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("schon im Papierkorb");
    // Name statt ID wird abgelehnt (nie per Name raten)
    const byName = await ai.call("trash", { typ: "aufgabe", id: `${marker} Aufgabe weg` });
    expect(byName.isError).toBe(true);

    const log = await activity(targets[1][2]);
    const entry = log.find((r) => r.summary.includes("in den Papierkorb"));
    expect(entry?.undo).toEqual({ kind: "trash", table: "tasks", id: targets[1][2] });
    const rows =
      (
        await db
          .from("ai_activity")
          .select("id, undo")
          .eq("client_id", clientId)
          .eq("tool", "trash")
      ).data ?? [];
    const persist = createSupabasePersister(() => db as unknown as PersisterClient);
    for (const row of rows) await persist(undoOps(row, new Date().toISOString()));
    for (const [, table, id] of targets) {
      const row = (await db.from(table).select("deleted_at").eq("id", id).single()).data;
      expect(row?.deleted_at, table).toBeNull();
    }
  });
});

describe("Umwandeln (convert, #65)", () => {
  const rows = async (table: "notes" | "tasks", id: string) =>
    (await db.from(table).select("*").eq("id", id).single()).data as Record<string, unknown> | null;

  it("Aufgabe → Notiz: Titel, Inhalt, Projekt, Original im Papierkorb; Rückgängig holt es zurück", async () => {
    const project = await ai.call("create_project", {
      titel: `${marker} Umbau`,
      bereich: "Privat",
    });
    const projectId = idOf(project.structured);
    const task = await ai.call("create_task", {
      titel: `${marker} Einkaufsplan`,
      projekt: projectId,
      faellig: "2026-11-01",
      prioritaet: "hoch",
      notiz: "Vorab klären\n- [x] Milch\n- [ ] Brot",
    });
    const taskId = idOf(task.structured);

    const result = await ai.call("convert", { id: taskId, in: "notiz" });
    expect(result.isError, result.text).toBe(false);
    const noteId = idOf(result.structured);
    expect(result.text).toContain("nicht übernommen");
    expect(result.text).toContain("Priorität Hoch");

    const note = await rows("notes", noteId);
    expect(note).toMatchObject({
      title: `${marker} Einkaufsplan`,
      type: "idee",
      project_id: projectId,
      deleted_at: null,
    });
    const blocks =
      (
        await db
          .from("note_blocks")
          .select("content_text")
          .eq("note_id", noteId)
          .is("deleted_at", null)
          .order("sort")
      ).data ?? [];
    expect(blocks.map((b) => b.content_text)).toEqual(["Vorab klären", "☑ Milch", "☐ Brot"]);
    expect((await rows("tasks", taskId))?.deleted_at).toBeTruthy();

    const entry = (await activity(noteId)).find((r) => r.tool === "convert");
    expect(entry?.undo).toEqual({
      kind: "convert",
      restore: { table: "tasks", id: taskId },
      trash: { table: "notes", id: noteId },
    });
    const log =
      (
        await db
          .from("ai_activity")
          .select("id, undo")
          .eq("client_id", clientId)
          .eq("entity_id", noteId)
      ).data ?? [];
    const persist = createSupabasePersister(() => db as unknown as PersisterClient);
    for (const row of log) await persist(undoOps(row, new Date().toISOString()));
    expect((await rows("tasks", taskId))?.deleted_at).toBeNull();
    expect((await rows("notes", noteId))?.deleted_at).toBeTruthy();
    // nichts endgültig gelöscht: die Blöcke der Notiz bestehen weiter
    expect((await db.from("note_blocks").select("id").eq("note_id", noteId)).data?.length).toBe(3);
  });

  it("Notiz → Aufgabe: Inhalt als Notiz und Checkliste, Verweise gemeldet, Rückgängig", async () => {
    const target = await ai.call("create_note", {
      titel: `${marker} Verweisziel`,
      bereich: "Privat",
      inhalt: "- Ziel",
    });
    const note = await ai.call("create_note", {
      titel: `${marker} Wird Aufgabe`,
      bereich: "Privat",
      thema: `${marker} Thema`,
      thema_anlegen: true,
      inhalt: "- Überblick\n  - Detail\n- ☐ Anrufen\n- ☑ Mailen",
    });
    const noteId = idOf(note.structured);
    await ai.call("create_note", {
      titel: `${marker} Verweiser`,
      bereich: "Privat",
      inhalt: `- siehe [[${marker} Wird Aufgabe]]`,
    });
    void target;

    const result = await ai.call("convert", { id: noteId, in: "aufgabe" });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain("verweisen noch");
    const taskId = idOf(result.structured);
    const task = await rows("tasks", taskId);
    expect(task).toMatchObject({
      title: `${marker} Wird Aufgabe`,
      in_inbox: false,
      deleted_at: null,
    });
    expect(String(task?.body_text)).toBe("Überblick\nDetail\nAnrufen\nMailen");
    const body = JSON.stringify(task?.body);
    expect(body).toContain('"taskItem"');
    expect((await rows("notes", noteId))?.deleted_at).toBeTruthy();

    // falsche Richtung und unbekannte ID werden verständlich abgelehnt
    const wrong = await ai.call("convert", { id: noteId, in: "notiz" });
    expect(wrong.isError).toBe(true);
    const missing = await ai.call("convert", {
      id: "00000000-0000-4000-8000-000000000000",
      in: "aufgabe",
    });
    expect(missing.isError).toBe(true);

    const log =
      (
        await db
          .from("ai_activity")
          .select("id, undo")
          .eq("client_id", clientId)
          .eq("entity_id", taskId)
      ).data ?? [];
    const persist = createSupabasePersister(() => db as unknown as PersisterClient);
    for (const row of log) await persist(undoOps(row, new Date().toISOString()));
    expect((await rows("notes", noteId))?.deleted_at).toBeNull();
    expect((await rows("tasks", taskId))?.deleted_at).toBeTruthy();
  });

  it("Aufgabe aus der Inbox braucht für die Notiz einen Bereich", async () => {
    const task = await ai.call("create_task", { titel: `${marker} Inbox-Ding` });
    const taskId = idOf(task.structured);
    const refused = await ai.call("convert", { id: taskId, in: "notiz" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Bereich");
    expect((await rows("tasks", taskId))?.deleted_at).toBeNull();
    const ok = await ai.call("convert", { id: taskId, in: "notiz", bereich: "Privat" });
    expect(ok.isError, ok.text).toBe(false);
  });
});

describe("Rückblicke (S1a)", () => {
  // Rückblicke haben keinen Titel: ein zufälliger Monat weit in der Zukunft, je Lauf ein anderer
  const month = `20${80 + Math.floor(Math.random() * 19)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;
  // auch nach einem abgebrochenen Lauf nichts stehen lassen (die Suche in rls.test.ts fände es)
  afterAll(async () => {
    await db.from("recaps").delete().eq("kind", "monat").gte("period_start", "2080-01-01");
  });

  it("create_recap legt den Monatsrückblick mit fester ID an, nie doppelt; list_recaps und fetch finden ihn", async () => {
    await db.from("recaps").delete().eq("kind", "monat").eq("period_start", `${month}-01`);
    const created = await ai.call("create_recap", {
      art: "monat",
      datum: `${month}-15`,
      stimmung: 4,
      gut: `${marker} lief rund`,
      fokus: ["Bericht", "Übung"],
      themen: ["#schlaf"],
    });
    expect(created.isError, created.text).toBe(false);
    const id = idOf(created.structured);
    // dieselbe ID wie die App (D-3): beide treffen sich auf derselben Zeile
    expect(id).toBe(recapId(sessionA.userId, "monat", `${month}-01`));
    const { data: row } = await db
      .from("recaps")
      .select("kind, period_start, mood, answers, focus_next, themes, questions")
      .eq("id", id)
      .single();
    expect(row).toMatchObject({
      kind: "monat",
      period_start: `${month}-01`,
      mood: 4,
      answers: { good: `${marker} lief rund` },
      focus_next: ["Bericht", "Übung"],
      themes: ["schlaf"],
    });
    expect(JSON.stringify(row?.questions)).toContain("Fokus nächster Monat");

    const again = await ai.call("create_recap", {
      art: "monat",
      datum: `${month}-02`,
      stimmung: 1,
    });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("gibt es schon");

    const list = await ai.call("list_recaps", { art: "monat", jahr: Number(month.slice(0, 4)) });
    expect(list.text).toContain(`(id: ${id})`);
    expect(list.text).toContain("Stimmung 4");
    const read = await ai.call("fetch", { id });
    expect(read.text).toContain(`${marker} lief rund`);
    expect(await activity(id)).toEqual([
      expect.objectContaining({ tool: "create_recap", entity: "rueckblick" }),
    ]);
    await db.from("recaps").delete().eq("id", id);
  });

  it("Gesprächsfelder (#66): create/update_recap füllen sie, fetch zeigt sie mit Überschrift, ersetzen und Rückgängig", async () => {
    await db.from("recaps").delete().eq("kind", "monat").eq("period_start", "2099-01-01");
    const created = await ai.call("create_recap", {
      art: "monat",
      datum: "2099-01-04",
      gespraech: `${marker} Gespräch`,
      hypothese: `${marker} Hypothese`,
    });
    expect(created.isError, created.text).toBe(false);
    const id = idOf(created.structured);
    const { data: row } = await db
      .from("recaps")
      .select("answers, questions")
      .eq("id", id)
      .single();
    expect(row?.answers).toEqual({
      conversation: `${marker} Gespräch`,
      hypothesis: `${marker} Hypothese`,
    });
    expect(JSON.stringify(row?.questions)).toContain("Bezug zum Vormonat");
    const updated = await ai.call("update_recap", {
      id,
      hypothese: `${marker} mehr`,
      gegenhypothese: `${marker} Gegen`,
      klartext: `${marker} Klartext`,
      bezug_vorwoche: `${marker} Bezug`,
    });
    expect(updated.isError, updated.text).toBe(false);
    expect((await db.from("recaps").select("answers").eq("id", id).single()).data?.answers).toEqual(
      {
        conversation: `${marker} Gespräch`,
        hypothesis: `${marker} Hypothese\n\n${marker} mehr`,
        counter_hypothesis: `${marker} Gegen`,
        plain_talk: `${marker} Klartext`,
        last_week: `${marker} Bezug`,
      },
    );
    const read = await ai.call("fetch", { id });
    expect(read.text).toContain("## Gespräch");
    expect(read.text).toContain("### Gegenhypothese");
    expect(read.text).toContain(`${marker} Klartext`);
    const replaced = await ai.call("update_recap", {
      id,
      hypothese: `${marker} neu`,
      modus: "ersetzen",
    });
    expect(replaced.isError, replaced.text).toBe(false);
    expect(
      (await db.from("recaps").select("answers").eq("id", id).single()).data?.answers,
    ).toMatchObject({ hypothesis: `${marker} neu` });
    await db.from("recaps").delete().eq("id", id);
  });

  it("update_recap ändert Werte, hängt Texte an (ersetzen nur auf Wunsch), nie Art/Zeitraum; Rückgängig stellt alles zurück (Migration 34)", async () => {
    await db.from("recaps").delete().eq("kind", "monat").eq("period_start", `${month}-01`);
    const created = await ai.call("create_recap", {
      art: "monat",
      datum: `${month}-03`,
      stimmung: 4,
      gut: `${marker} lief rund`,
    });
    const id = idOf(created.structured);
    const appended = await ai.call("update_recap", {
      id,
      stimmung: 2,
      energie: 5,
      gut: `${marker} und der Lauf`,
      fokus: ["Steuer"],
      themen: ["#schlaf", "Sport"],
    });
    expect(appended.isError, appended.text).toBe(false);
    const after = (
      await db
        .from("recaps")
        .select("kind, period_start, mood, energy, answers, focus_next, themes")
        .eq("id", id)
        .single()
    ).data;
    expect(after).toEqual({
      kind: "monat",
      period_start: `${month}-01`,
      mood: 2,
      energy: 5,
      answers: { good: `${marker} lief rund\n\n${marker} und der Lauf` },
      focus_next: ["Steuer"],
      themes: ["schlaf", "Sport"],
    });
    const replaced = await ai.call("update_recap", {
      id,
      gut: `${marker} neu`,
      modus: "ersetzen",
      sport: null,
    });
    expect(replaced.isError, replaced.text).toBe(false);
    expect((await db.from("recaps").select("answers, sport").eq("id", id).single()).data).toEqual({
      answers: { good: `${marker} neu` },
      sport: null,
    });
    // unbekannte Frage und leere Änderung werden abgewiesen
    const unknown = await ai.call("update_recap", { id, antworten: { fremd: "x" } });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("keine Textfrage");
    expect((await ai.call("update_recap", { id })).isError).toBe(true);

    // Protokoll mit Rückgängig: die letzte Änderung zurück, dann die erste
    // (der vorige Test ließ sein create_recap-Protokoll zur selben festen ID stehen)
    const log = await activity(id);
    expect(log.filter((r) => r.tool === "update_recap")).toHaveLength(2);
    expect(log.every((r) => r.entity === "rueckblick")).toBe(true);
    const rows =
      (
        await db
          .from("ai_activity")
          .select("id, undo")
          .eq("entity_id", id)
          .eq("tool", "update_recap")
          .order("created_at", { ascending: false })
      ).data ?? [];
    const persist = createSupabasePersister(() => db as unknown as PersisterClient);
    for (const row of rows) await persist(undoOps(row, new Date().toISOString()));
    expect(
      (
        await db
          .from("recaps")
          .select("mood, energy, sport, answers, focus_next, themes")
          .eq("id", id)
          .single()
      ).data,
    ).toEqual({
      mood: 4,
      energy: null,
      sport: null,
      answers: { good: `${marker} lief rund` },
      focus_next: [],
      themes: [],
    });
    await db.from("recaps").delete().eq("id", id);
  });
});

describe("Projekte", () => {
  it("create_project legt Fahrplan an; fetch zeigt ihn; update_project hakt ab", async () => {
    const created = await ai.call("create_project", {
      titel: `${marker} Werkstatt`,
      bereich: "Privat",
      status: "aktiv",
      warum: "Damit es läuft",
      ergebnis: ["Software läuft"],
      meilensteine: [
        { titel: "Planen", aufgaben: [{ titel: `${marker} Raum buchen` }] },
        { titel: "Umsetzen" },
      ],
      aufgaben: [{ titel: `${marker} Lose Aufgabe` }],
      naechster_schritt: `${marker} Raum buchen`,
    });
    expect(created.isError, created.text).toBe(false);
    const projectId = idOf(created.structured);
    const page = await ai.call("fetch", { id: projectId });
    expect(page.text).toContain("## Fahrplan");
    expect(page.text).toMatch(
      new RegExp(`### 1\\. Planen · offen\\n\\n- \\[ \\] ${marker} Raum buchen \\(id: `),
    );
    expect(page.text).toContain("## Nächster Schritt");
    expect(page.text).toContain("- [ ] Software läuft");

    const updated = await ai.call("update_project", {
      id: projectId,
      ergebnis_erledigt: ["Software läuft"],
      meilenstein_aendern: [{ meilenstein: "Planen", erreicht: true }],
      meilenstein_hinzu: [{ titel: "Abschließen" }],
    });
    expect(updated.isError, updated.text).toBe(false);
    const again = await ai.call("fetch", { id: projectId });
    expect(again.text).toContain("- [x] Software läuft");
    expect(again.text).toMatch(/### 1\. Planen · erreicht/);
    expect(again.text).toContain("### 3. Abschließen · offen");

    const list = await ai.call("list_tasks", { projekt: `${marker} Werkstatt` });
    expect(list.text).toContain("2 Aufgaben");
  });

  it("letzte Aufgabe abgehakt → Meilenstein erreicht und genannt; wieder öffnen öffnet ihn (#60, Migration 35)", async () => {
    const created = await ai.call("create_project", {
      titel: `${marker} Meilenstein folgt`,
      bereich: "Privat",
      meilensteine: [
        {
          titel: "Vorbereiten",
          aufgaben: [{ titel: `${marker} Liste schreiben` }, { titel: `${marker} Einkaufen` }],
        },
      ],
    });
    expect(created.isError, created.text).toBe(false);
    const projectId = idOf(created.structured);
    const tasks =
      (await db.from("tasks").select("id, title, milestone_id").eq("project_id", projectId)).data ??
      [];
    const [first, second] = tasks.sort((a, b) => a.title.localeCompare(b.title));
    const milestoneId = first?.milestone_id as string;
    const doneAt = async () =>
      (await db.from("milestones").select("done_at").eq("id", milestoneId).single()).data?.done_at;

    const one = await ai.call("update_task", { id: first?.id as string, status: "erledigt" });
    expect(one.text).not.toContain("Meilenstein");
    expect(await doneAt()).toBeNull();
    const two = await ai.call("update_task", { id: second?.id as string, status: "erledigt" });
    expect(two.text).toContain("Meilenstein „Vorbereiten“ damit erreicht");
    expect(await doneAt()).toBeTruthy();
    await ai.call("update_task", { id: second?.id as string, status: "offen" });
    expect(await doneAt()).toBeNull();
  });

  it("Links im Steckbrief (Migration 22): anlegen, ergänzen, entfernen; nur sichere Adressen", async () => {
    const created = await ai.call("create_project", {
      titel: `${marker} Steuer`,
      bereich: "Privat",
      links: [{ name: "Elster", adresse: "elster.de" }],
    });
    expect(created.isError, created.text).toBe(false);
    const projectId = idOf(created.structured);
    // kopierter App-Link statt ID (#47)
    const page = await ai.call("fetch", { id: `https://app.example/projekte/${projectId}` });
    expect(page.isError, page.text).toBe(false);
    expect(page.text).toContain("## Links");
    expect(page.text).toContain("- [Elster](https://elster.de/)");

    const bad = await ai.call("update_project", {
      id: projectId,
      links_hinzu: [{ name: "Böse", adresse: "javascript:alert(1)" }],
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("keine Link-Adresse");

    const updated = await ai.call("update_project", {
      id: projectId,
      links_hinzu: [
        { adresse: "https://www.notion.so/Steuer-2024" },
        { name: `${marker}kanzlei`, adresse: "mailto:kanzlei@example.org" },
      ],
      links_entfernen: ["Elster"],
    });
    expect(updated.isError, updated.text).toBe(false);
    const again = await ai.call("fetch", { id: projectId });
    expect(again.text).not.toContain("Elster");
    expect(again.text).toContain("- [notion.so](https://www.notion.so/Steuer-2024)");
    // Link-Namen sind durchsuchbar (search_all, Migration 22)
    const found = await ai.call("search", { query: `${marker}kanzlei` });
    expect(found.text).toContain(`${marker} Steuer`);
  });

  it("Freitext im Projekt (#44, Migration 24): anlegen, anhängen, ersetzen; durchsuchbar", async () => {
    const created = await ai.call("create_project", {
      titel: `${marker} Gartenhaus`,
      bereich: "Privat",
      freitext: "Absprache mit dem Zimmermann\n- [ ] Dachlatten bestellen",
    });
    expect(created.isError, created.text).toBe(false);
    const projectId = idOf(created.structured);
    const page = await ai.call("fetch", { id: projectId });
    expect(page.text).toContain("## Freitext");
    expect(page.text).toContain("Absprache mit dem Zimmermann\n- [ ] Dachlatten bestellen");

    const appended = await ai.call("update_project", {
      id: projectId,
      freitext: "- [ ] Fundament prüfen",
    });
    expect(appended.isError, appended.text).toBe(false);
    expect(appended.text).toContain("body");
    const again = await ai.call("fetch", { id: projectId });
    expect(again.text).toContain("- [ ] Dachlatten bestellen\n- [ ] Fundament prüfen");

    const replaced = await ai.call("update_project", {
      id: projectId,
      freitext: `${marker}stand Dach ist dicht`,
      freitext_modus: "ersetzen",
    });
    expect(replaced.isError, replaced.text).toBe(false);
    const last = await ai.call("fetch", { id: projectId });
    expect(last.text).not.toContain("Dachlatten");
    const found = await ai.call("search", { query: `${marker}stand` });
    expect(found.text).toContain(`${marker} Gartenhaus`);
  });

  it("Notiz-Typen (#34): eigener Typ per Name, unbekannter Typ nennt die vorhandenen, Überblick listet sie", async () => {
    const key = `t${Date.now().toString(36)}`;
    const name = `${marker} Besprechung`;
    await db.from("note_types").insert({ key, name, sort: "z9" });
    try {
      const created = await ai.call("create_note", {
        titel: `${marker} Dienstbesprechung`,
        bereich: "Privat",
        typ: name.toUpperCase(),
      });
      expect(created.isError, created.text).toBe(false);
      const row = await db.from("notes").select("type").eq("id", idOf(created.structured)).single();
      expect(row.data?.type).toBe(key);
      const listed = await ai.call("list_notes", { typ: key });
      expect(listed.text).toContain(`${marker} Dienstbesprechung`);
      expect(listed.text).toContain(name);

      const bad = await ai.call("create_note", {
        titel: `${marker} Falsch`,
        bereich: "Privat",
        typ: "Gibtsnicht",
      });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain("Vorhanden:");
      expect(bad.text).toContain("protokoll (Protokoll)");

      const overview = await ai.call("overview");
      expect(overview.text).toContain(`${key} (${name})`);
    } finally {
      await db.from("note_types").delete().eq("key", key);
    }
  });

  it("Wissen (#56, Migration 39): Überblick nennt die Wissens-Typen, list_notes nur_wissen zeigt nur Wissen/Anleitung", async () => {
    const wissen = await ai.call("create_note", {
      titel: `${marker} Wissen-Notiz`,
      bereich: "Privat",
      typ: "wissen",
    });
    const idee = await ai.call("create_note", {
      titel: `${marker} Ideen-Notiz`,
      bereich: "Privat",
    });
    expect(wissen.isError, wissen.text).toBe(false);
    expect(idee.isError, idee.text).toBe(false);
    const overview = await ai.call("overview");
    expect(overview.text).toContain("Zählen als Wissen");
    expect(overview.text).toMatch(
      /Zählen als Wissen[^\n]*wissen \(Wissen\)[^\n]*anleitung \(Anleitung\)/,
    );
    const all = await ai.call("list_notes", { limit: 200 });
    expect(all.text).toContain(`${marker} Ideen-Notiz`);
    const only = await ai.call("list_notes", { nur_wissen: true, limit: 200 });
    expect(only.text).toContain(`${marker} Wissen-Notiz`);
    expect(only.text).not.toContain(`${marker} Ideen-Notiz`);
  });
});

/**
 * Supabase-Client, bei dem `from(table).insert(…)` fehlschlägt – für die Reihenfolge Protokoll →
 * Änderung (K-5). Alles andere läuft gegen das Testprojekt.
 */
function failingInsert<T extends object>(client: T, table: string): T {
  const failed = { data: null, error: { code: "XX000", message: "Testfehler intern" } };
  // bewusst ein Thenable: `await db.from(t).insert(…)` (ohne select) wartet direkt darauf
  const fakeInsert = () => ({
    select: () => Promise.resolve(failed),
    // biome-ignore lint/suspicious/noThenProperty: Supabase-Builder sind Thenables
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(failed).then(ok, err),
  });
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === "from") {
        return (name: string) => {
          const builder = (target as never as { from: (n: string) => object }).from(name);
          if (name !== table) return builder;
          return new Proxy(builder, {
            get(b, k, r) {
              if (k === "insert") return fakeInsert;
              const v = Reflect.get(b, k, r);
              return typeof v === "function" ? v.bind(b) : v;
            },
          });
        };
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("Review Teil B – Rückgängig und Protokoll (M-1, K-2, K-3, K-5, K-7)", () => {
  const persist = createSupabasePersister(() => db as unknown as PersisterClient);
  let noteId = "";
  const liveBlocks = async (id: string) =>
    (
      (await db.from("note_blocks").select("id").eq("note_id", id).is("deleted_at", null)).data ??
      []
    )
      .map((b) => b.id)
      .sort();

  beforeAll(async () => {
    const created = await ai.call("create_note", {
      titel: `${marker} Teil B Notiz`,
      bereich: "Privat",
      inhalt: "- erste Zeile\n- zweite Zeile",
    });
    expect(created.isError, created.text).toBe(false);
    noteId = idOf(created.structured);
  });

  it("M-1: ein gefälschter Protokolleintrag holt nichts aus dem Papierkorb – nur erlaubte Spalten zählen", async () => {
    const now = new Date().toISOString();
    expect((await db.from("notes").update({ deleted_at: now }).eq("id", noteId)).error).toBeNull();
    // Eintrag, wie ihn ein KI-Token direkt per PostgREST schreiben könnte
    const forged = await db
      .from("ai_activity")
      .insert({
        client_id: clientId,
        tool: "update_note",
        entity: "notiz",
        entity_id: noteId,
        summary: `${marker} gefälscht`,
        undo: {
          kind: "update",
          table: "notes",
          id: noteId,
          before: {
            deleted_at: null,
            user_id: "00000000-0000-4000-8000-000000000bad",
            title: "Gekapert",
          },
        },
      })
      .select("id, undo")
      .single();
    expect(forged.error).toBeNull();
    const ops = undoOps(forged.data as { id: string; undo: unknown }, now);
    expect(ops.map((o) => [o.table, o.values])).toEqual([
      ["notes", { title: "Gekapert" }],
      ["ai_activity", { undone_at: now }],
    ]);
    await persist(ops);
    const note = await db.from("notes").select("deleted_at, title").eq("id", noteId).single();
    expect(note.data?.deleted_at).toBeTruthy();
    expect(note.data?.title).toBe("Gekapert");
    expect(
      (
        await db
          .from("notes")
          .update({ deleted_at: null, title: `${marker} Teil B Notiz` })
          .eq("id", noteId)
      ).error,
    ).toBeNull();
  });

  it("K-5: scheitert das Einfügen bei „ersetzen“, bleibt der alte Inhalt; scheitert das Protokoll, ändert sich nichts (K-7: fester Text)", async () => {
    const before = await liveBlocks(noteId);
    expect(before).toHaveLength(2);
    const base = {
      userId: sessionA.userId,
      clientId,
      origin: "https://app.test",
      now: () => new Date(),
      r2,
    };

    const blocksFail = await connectAi({
      ...base,
      db: failingInsert(asAllowedAi(db), "note_blocks"),
    });
    try {
      const result = await blocksFail.call("update_note", {
        id: noteId,
        inhalt: "- ganz neu",
        inhalt_modus: "ersetzen",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toBe("Inhalt speichern fehlgeschlagen: Datenbankfehler (XX000)");
      expect(result.text).not.toContain("Testfehler");
    } finally {
      await blocksFail.close();
    }
    // der alte Inhalt steht noch – nichts weich gelöscht, nichts leer
    expect(await liveBlocks(noteId)).toEqual(before);
    // das Protokoll nennt den Versuch; sein Rückgängig ist ein Leerlauf (entfernt nur Eingefügtes)
    const logged = (await activity(noteId)).filter((row) => row.summary.includes("Inhalt ersetzt"));
    expect(logged.length).toBeGreaterThan(0);

    const logFail = await connectAi({ ...base, db: failingInsert(asAllowedAi(db), "ai_activity") });
    try {
      const result = await logFail.call("update_note", {
        id: noteId,
        titel: `${marker} nie`,
        inhalt: "- ganz neu",
        inhalt_modus: "ersetzen",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toBe("KI-Protokoll schreiben fehlgeschlagen: Datenbankfehler (XX000)");
      // Aufgabe: dasselbe – die alte Notiz der Aufgabe stünde sonst nur im Protokoll
      const task = await ai.call("create_task", {
        titel: `${marker} K-5 Aufgabe`,
        bereich: "Privat",
        notiz: "- alte Notiz",
      });
      expect(task.isError, task.text).toBe(false);
      const taskId = idOf(task.structured);
      const replaced = await logFail.call("update_task", {
        id: taskId,
        notiz: "- neue Notiz",
        notiz_modus: "ersetzen",
        status: "erledigt",
      });
      expect(replaced.isError).toBe(true);
      const row = (await db.from("tasks").select("body_text, status").eq("id", taskId).single())
        .data;
      expect(row).toEqual({ body_text: "alte Notiz", status: "offen" });
    } finally {
      await logFail.close();
    }
    const note = (await db.from("notes").select("title").eq("id", noteId).single()).data;
    expect(note?.title).toBe(`${marker} Teil B Notiz`);
    expect(await liveBlocks(noteId)).toEqual(before);
  });

  it("K-2: attach_file an eine Aufgabe schreibt den Stand danach; eingefügte und dann bearbeitete Blöcke fallen auf", async () => {
    const task = await ai.call("create_task", {
      titel: `${marker} K-2 Aufgabe`,
      bereich: "Privat",
    });
    expect(task.isError, task.text).toBe(false);
    const taskId = idOf(task.structured);
    const attached = await ai.call("attach_file", {
      ziel: taskId,
      inhalt_base64: Buffer.from("Hallo").toString("base64"),
      name: "k2.txt",
    });
    expect(attached.isError, attached.text).toBe(false);
    const undo = parseUndo((await activity(taskId)).at(-1)?.undo);
    expect(undo?.kind).toBe("update");
    if (undo?.kind !== "update") throw new Error("kein update-Rückgängig");
    expect(undo.after).toMatchObject({ body: expect.anything(), body_text: expect.any(String) });
    // unverändert → keine Rückfrage; der Nutzer schreibt weiter → Rückfrage „Notiz“
    const current = (await db.from("tasks").select("body, body_text").eq("id", taskId).single())
      .data as Record<string, unknown>;
    expect(undoConflicts(undo, current)).toEqual([]);
    expect(undoConflicts(undo, { ...current, body: { type: "doc", content: [] } })).toEqual([
      "body",
    ]);

    // Blöcke: angehängt, dann einen davon bearbeitet (wie das iPhone) → updated_at rückt vor
    const appended = await ai.call("update_note", { id: noteId, inhalt: "- Nachtrag K-2" });
    expect(appended.isError, appended.text).toBe(false);
    const added = (parseUndo((await activity(noteId)).at(-1)?.undo) as { added: string[] }).added;
    expect(added).toHaveLength(1);
    const rows = async () =>
      (await db.from("note_blocks").select("id, created_at, updated_at").in("id", added)).data ??
      [];
    expect(editedBlockIds(await rows())).toEqual([]);
    expect(
      (
        await db
          .from("note_blocks")
          .update({ content_text: "Nachtrag K-2 ergänzt" })
          .in("id", added)
      ).error,
    ).toBeNull();
    expect(editedBlockIds(await rows())).toEqual(added);
  });

  it("K-3: trash und convert nennen die Freigabe einer freigegebenen Notiz", async () => {
    const { data: area } = await db.from("areas").select("id").order("sort").limit(1).single();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, id] of ids.entries()) {
      expect(
        (
          await db
            .from("notes")
            .insert({ id, title: `${marker} K-3 öffentlich ${index}`, area_id: area?.id ?? "" })
        ).error,
      ).toBeNull();
      expect(
        (await db.from("note_shares").insert({ note_id: id, token: newShareToken() })).error,
      ).toBeNull();
    }
    const trashed = await ai.call("trash", { typ: "notiz", id: ids[0] as string });
    expect(trashed.isError, trashed.text).toBe(false);
    expect(trashed.text).toContain("Die Notiz war öffentlich freigegeben");
    expect(trashed.structured?.oeffentlich).toBe(true);
    const converted = await ai.call("convert", { id: ids[1] as string, in: "aufgabe" });
    expect(converted.isError, converted.text).toBe(false);
    expect(converted.text).toContain("Die Notiz war öffentlich freigegeben");
    // nicht freigegeben: kein Hinweis
    const plain = await ai.call("trash", { typ: "notiz", id: noteId });
    expect(plain.isError, plain.text).toBe(false);
    expect(plain.text).not.toContain("öffentlich");
    expect(plain.structured?.oeffentlich).toBe(false);
    await db.from("notes").update({ deleted_at: null }).eq("id", noteId);
    await db.from("tasks").delete().eq("id", idOf(converted.structured));
  });
});

describe("Review Teil B – Namensauflösung beim Schreiben (K-1)", () => {
  it("Teiltreffer schreiben nicht, sondern fragen mit Kandidaten zurück; Lesen bleibt unscharf", async () => {
    const dienstplan = await ai.call("create_project", {
      titel: `${marker} Feuerwerk Silvester`,
      bereich: "Privat",
      meilensteine: [{ titel: "7 Oberfläche Teil 2 (#34 … #48)" }],
    });
    const rezepte = await ai.call("create_project", {
      titel: `${marker} Lagerfeuer Rezepte`,
      bereich: "Privat",
    });
    expect(dienstplan.isError, dienstplan.text).toBe(false);
    expect(rezepte.isError, rezepte.text).toBe(false);
    // 19.10.: „8“ traf den Meilenstein 7 (enthalten in „#48“) – jetzt Rückfrage, nichts angelegt
    const wrong = await ai.call("create_task", {
      titel: `${marker} K-1 Aufgabe`,
      projekt: idOf(dienstplan.structured),
      meilenstein: "8",
    });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/Meilenstein „8“ passt auf keinen Namen genau.*7 Oberfläche Teil 2/);
    expect((await db.from("tasks").select("id").eq("title", `${marker} K-1 Aufgabe`)).data).toEqual(
      [],
    );
    // Wortanfang „Lagerfeuer“ (Stufe 60) reicht zum Schreiben nicht, der Namensanfang schon
    const byWord = await ai.call("create_task", {
      titel: `${marker} K-1 Aufgabe`,
      projekt: "Lagerfeuer",
    });
    expect(byWord.isError).toBe(true);
    expect(byWord.text).toContain("Gemeint sein könnte");
    const byPrefix = await ai.call("create_task", {
      titel: `${marker} K-1 Aufgabe`,
      projekt: `${marker} Feuer`,
    });
    expect(byPrefix.isError, byPrefix.text).toBe(false);
    expect(byPrefix.text).toContain("Feuerwerk Silvester");
    // Lesen: der eindeutige Teiltreffer filtert weiterhin
    const listed = await ai.call("list_tasks", { projekt: "Lagerfeuer", limit: 50 });
    expect(listed.isError, listed.text).toBe(false);
  });
});
