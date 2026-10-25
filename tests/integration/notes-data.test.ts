/**
 * App-Datenschicht gegen das Testprojekt: die Abfragen der Wissen-Ansicht (Notizen mit Vorschau,
 * Themen, Blöcke, Rückverweise) und der Supabase-Persister der Speicher-Warteschlange.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { fetchBacklinks, fetchNoteBlocks, fetchNotes, fetchTopics } from "@/features/notes/queries";
import type { SaveOp } from "@/lib/save-queue/save-queue";
import {
  createSupabasePersister,
  isRetryableSaveError,
  type PersisterClient,
  SaveError,
} from "@/lib/save-queue/supabase-persister";
import { runMarker, userClient } from "../support/supabase-node";

const db = userClient(inject("sessionA"));
const marker = runMarker();
const persist = createSupabasePersister(() => db as unknown as PersisterClient);

const ids = {
  topic: crypto.randomUUID(),
  note: crypto.randomUUID(),
  linking: crypto.randomUUID(),
  first: crypto.randomUUID(),
  second: crypto.randomUUID(),
  child: crypto.randomUUID(),
  removed: crypto.randomUUID(),
  link: crypto.randomUUID(),
};
let areaId = "";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const block = (id: string, parent: string | null, sort: string, text: string, extra = {}) => ({
  table: "note_blocks",
  id,
  mode: "upsert" as const,
  values: {
    note_id: ids.note,
    parent_id: parent,
    sort,
    content: paragraph(text),
    content_text: text,
    collapsed: false,
    task_id: null,
    deleted_at: null,
    ...extra,
  },
});

beforeAll(async () => {
  const { data } = await db.from("areas").select("id").order("sort").limit(1).single();
  areaId = data?.id ?? "";
  expect(areaId).not.toBe("");
});

afterAll(async () => {
  await db.from("notes").delete().in("id", [ids.note, ids.linking]);
  await db.from("topics").delete().eq("id", ids.topic);
});

describe("Supabase-Persister", () => {
  it("speichert Thema, Notiz und Blöcke in einem Paket – Kind vor Eltern-Block, Notiz zuletzt eingereiht", async () => {
    const batch: SaveOp[] = [
      // absichtlich in „falscher“ Reihenfolge eingereiht
      block(ids.child, ids.first, "a0", `Kind ${marker}`),
      block(ids.removed, null, "Zz", "gelöscht", { deleted_at: new Date().toISOString() }),
      block(ids.second, null, "a1", "Zweiter"),
      block(ids.first, null, "a0", `Erster ${marker}`),
      {
        table: "notes",
        id: ids.note,
        mode: "upsert",
        values: { title: `Daten ${marker}`, area_id: areaId, topic_id: ids.topic, tags: [] },
      },
      {
        table: "topics",
        id: ids.topic,
        mode: "upsert",
        values: { area_id: areaId, name: `Thema ${marker}`, sort: "a0" },
      },
    ];
    await persist(batch);

    const blocks = await fetchNoteBlocks(db, ids.note);
    expect(blocks.map((b) => b.id).sort()).toEqual([ids.child, ids.first, ids.second].sort());
    expect(blocks.find((b) => b.id === ids.child)?.parent_id).toBe(ids.first);
  });

  it("Update einzelner Felder, Soft-Delete und Fehlerarten", async () => {
    await persist([
      { table: "notes", id: ids.note, mode: "update", values: { title: `Umbenannt ${marker}` } },
      { table: "note_blocks", id: ids.second, mode: "update", values: { deleted_at: null } },
    ]);
    const { data } = await db.from("notes").select("title").eq("id", ids.note).single();
    expect(data?.title).toBe(`Umbenannt ${marker}`);

    const missing = await persist([
      { table: "notes", id: crypto.randomUUID(), mode: "update", values: { title: "x" } },
    ]).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(SaveError);
    expect(isRetryableSaveError(missing)).toBe(false);

    const invalid = await persist([
      // eigene Typen sind erlaubt (#34), die Form des Schlüssels prüft weiter ein Check
      { table: "notes", id: ids.note, mode: "update", values: { type: "Kein Typ!" } },
    ]).catch((e: unknown) => e);
    expect((invalid as SaveError).code).toBe("23514");
    expect(isRetryableSaveError(invalid)).toBe(false);
  });
});

describe("Abfragen der Wissen-Ansicht", () => {
  it("Notizliste mit Vorschau aus dem ersten nicht gelöschten Block der obersten Ebene", async () => {
    const notes = await fetchNotes(db);
    const note = notes.find((n) => n.id === ids.note);
    expect(note).toMatchObject({
      title: `Umbenannt ${marker}`,
      topic_id: ids.topic,
      snippet: `Erster ${marker}`,
    });
    for (const n of notes) expect(n.deleted_at).toBeNull();
  });

  it("„zuletzt bearbeitet“ = jüngster Zeitpunkt aus Notiz und ihren Blöcken (auch gelöschten)", async () => {
    const { data: blocks, error } = await db
      .from("note_blocks")
      .select("updated_at")
      .eq("note_id", ids.note);
    expect(error).toBeNull();
    expect(blocks?.length).toBeGreaterThan(0);
    const note = (await fetchNotes(db)).find((n) => n.id === ids.note);
    if (!note) throw new Error("Notiz fehlt");
    const newest = Math.max(
      Date.parse(note.updated_at),
      ...(blocks ?? []).map((b) => Date.parse(b.updated_at)),
    );
    expect(Date.parse(note.edited_at)).toBe(newest);
  });

  it("Themen ohne Papierkorb", async () => {
    const topics = await fetchTopics(db);
    expect(topics.find((t) => t.id === ids.topic)?.name).toBe(`Thema ${marker}`);
  });

  it("Rückverweise zählen verlinkende Blöcke je Notiz", async () => {
    await persist([
      {
        table: "notes",
        id: ids.linking,
        mode: "upsert",
        values: { title: `Verweist ${marker}`, area_id: areaId, tags: [] },
      },
      {
        table: "note_blocks",
        id: ids.link,
        mode: "upsert",
        values: {
          note_id: ids.linking,
          parent_id: null,
          sort: "a0",
          content: {
            type: "paragraph",
            content: [{ type: "noteLink", attrs: { noteId: ids.note } }],
          },
          content_text: "[[x]]",
          collapsed: false,
          task_id: null,
          deleted_at: null,
        },
      },
    ]);
    expect(await fetchBacklinks(db, ids.note)).toEqual([{ noteId: ids.linking, count: 1 }]);
  });
});
