/**
 * Papierkorb (B13) gegen das Testprojekt: die Abfrage der Papierkorb-Seite, Zurückholen (Notiz
 * samt Blöcken) und endgültiges Löschen über die Speicher-Warteschlange (rpc:empty_trash) – nur
 * was schon im Papierkorb liegt, Meilensteine gehen mit dem Projekt, Aufgaben bleiben ohne Projekt,
 * und Nutzer B kann nichts von A löschen.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { fetchNoteBlocks, fetchNotes } from "@/features/notes/queries";
import { fetchTrash } from "@/features/trash/queries";
import type { SaveOp } from "@/lib/save-queue/save-queue";
import {
  createSupabasePersister,
  type PersisterClient,
  RPC_EMPTY_TRASH,
} from "@/lib/save-queue/supabase-persister";
import { runMarker, userClient } from "../support/supabase-node";

const a = userClient(inject("sessionA"));
const b = userClient(inject("sessionB"));
const marker = runMarker();
const persistA = createSupabasePersister(() => a as unknown as PersisterClient);
const persistB = createSupabasePersister(() => b as unknown as PersisterClient);

const ids = {
  note: crypto.randomUUID(),
  block: crypto.randomUUID(),
  child: crypto.randomUUID(),
  project: crypto.randomUUID(),
  milestone: crypto.randomUUID(),
  task: crypto.randomUUID(),
  live: crypto.randomUUID(),
};
let areaId = "";

const trashOp = (table: string, id: string, deletedAt: string | null): SaveOp => ({
  table,
  id,
  mode: "update",
  values: { deleted_at: deletedAt },
});
const purgeOp = (entity: string, id: string): SaveOp => ({
  table: RPC_EMPTY_TRASH,
  id,
  mode: "update",
  values: { entity },
});
const exists = async (table: "notes" | "projects" | "milestones" | "tasks", id: string) => {
  const { data, error } = await a.from(table).select("id").eq("id", id);
  expect(error).toBeNull();
  return (data ?? []).length === 1;
};

beforeAll(async () => {
  const { data } = await a.from("areas").select("id").order("sort").limit(1).single();
  areaId = data?.id ?? "";
  expect(areaId).not.toBe("");
  const title = (label: string) => `${label} ${marker}`;
  expect(
    (await a.from("notes").insert({ id: ids.note, title: title("Notiz"), area_id: areaId })).error,
  ).toBeNull();
  expect(
    (
      await a.from("note_blocks").insert([
        {
          id: ids.block,
          note_id: ids.note,
          sort: "a0",
          content: { type: "paragraph" },
          content_text: "Erster Block",
        },
        {
          id: ids.child,
          note_id: ids.note,
          parent_id: ids.block,
          sort: "a0",
          content: { type: "paragraph" },
          content_text: "Kind",
        },
      ])
    ).error,
  ).toBeNull();
  expect(
    (
      await a
        .from("projects")
        .insert({ id: ids.project, title: title("Projekt"), area_id: areaId, sort: "a0" })
    ).error,
  ).toBeNull();
  expect(
    (
      await a.from("milestones").insert({
        id: ids.milestone,
        project_id: ids.project,
        title: title("Meilenstein"),
        sort: "a0",
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await a.from("tasks").insert([
        {
          id: ids.task,
          title: title("Aufgabe"),
          area_id: areaId,
          project_id: ids.project,
          milestone_id: ids.milestone,
          sort: "a0",
        },
        { id: ids.live, title: title("Lebt"), area_id: areaId, sort: "a1" },
      ])
    ).error,
  ).toBeNull();
});

afterAll(async () => {
  await a.from("tasks").delete().in("id", [ids.task, ids.live]);
  await a.from("notes").delete().eq("id", ids.note);
  await a.from("projects").delete().eq("id", ids.project);
});

describe("Papierkorb", () => {
  it("zeigt Gelöschtes aus allen Tabellen, neueste zuerst, nichts Lebendes", async () => {
    await persistA([trashOp("projects", ids.project, "2026-10-16T08:00:00Z")]);
    await persistA([trashOp("notes", ids.note, "2026-10-16T09:00:00Z")]);
    await persistA([trashOp("tasks", ids.task, "2026-10-16T07:00:00Z")]);
    const mine = (await fetchTrash(a)).filter((i) =>
      [ids.note, ids.project, ids.task, ids.live].includes(i.id),
    );
    expect(mine.map((i) => [i.table, i.id])).toEqual([
      ["notes", ids.note],
      ["projects", ids.project],
      ["tasks", ids.task],
    ]);
    expect(mine[2]).toMatchObject({ projectId: ids.project, areaId, inInbox: false });
    // Nutzer B sieht A's Papierkorb nicht
    expect((await fetchTrash(b)).some((i) => i.id === ids.note)).toBe(false);
  });

  it("Zurückholen bringt die Notiz samt Blöcken zurück", async () => {
    await persistA([trashOp("notes", ids.note, null)]);
    expect((await fetchNotes(a)).some((n) => n.id === ids.note)).toBe(true);
    const blocks = await fetchNoteBlocks(a, ids.note);
    expect(blocks.map((bl) => bl.content_text).sort()).toEqual(["Erster Block", "Kind"]);
    expect((await fetchTrash(a)).some((i) => i.id === ids.note)).toBe(false);
  });

  it("endgültig löschen trifft nur, was im Papierkorb liegt – auch nicht über Nutzer B", async () => {
    await persistA([purgeOp("tasks", ids.live), purgeOp("notes", ids.note)]);
    expect(await exists("tasks", ids.live)).toBe(true);
    expect(await exists("notes", ids.note)).toBe(true);
    // B kann A's gelöschtes Projekt nicht endgültig löschen (RLS)
    await persistB([purgeOp("projects", ids.project)]);
    expect(await exists("projects", ids.project)).toBe(true);
  });

  it("Soft-Delete und endgültig löschen im selben Paket: erst in den Papierkorb, dann weg (Blöcke mit)", async () => {
    await persistA([
      purgeOp("notes", ids.note),
      trashOp("notes", ids.note, new Date().toISOString()),
    ]);
    expect(await exists("notes", ids.note)).toBe(false);
    const { data } = await a.from("note_blocks").select("id").in("id", [ids.block, ids.child]);
    expect(data).toEqual([]);
  });

  it("Projekt endgültig gelöscht: Meilensteine gehen mit, Aufgaben bleiben ohne Projekt", async () => {
    await persistA([purgeOp("projects", ids.project)]);
    expect(await exists("projects", ids.project)).toBe(false);
    expect(await exists("milestones", ids.milestone)).toBe(false);
    const { data } = await a
      .from("tasks")
      .select("project_id, milestone_id, deleted_at")
      .eq("id", ids.task)
      .single();
    expect(data).toMatchObject({ project_id: null, milestone_id: null });
    expect(data?.deleted_at).not.toBeNull();
  });
});
