/**
 * Trigger und RPCs im echten Supabase-Testprojekt (als Testnutzer A):
 * completed_at, Zyklus-Sperre, Bereichs-Ableitung, [[Link]]-Trigger (inkl. Umbenennen),
 * Verweise aus der Notiz einer Aufgabe (task_note_links),
 * Inline-Tags (E14), v_tasks/v_projects, complete_task/undo, Suche.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import { runMarker, userClient } from "../support/supabase-node";

const session = inject("sessionA");
const db = userClient(session);
const marker = runMarker();

let areaId = "";
let otherAreaId = "";
const created = { tasks: [] as string[], notes: [] as string[], projects: [] as string[] };

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (...content: Json[]): NonNullable<Json> => ({ type: "paragraph", content });
const noteLink = (noteId: string) => ({ type: "noteLink", attrs: { noteId } });
const tag = (name: string) => ({ type: "tag", attrs: { name } });

async function createTask(values: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const { data, error } = await db
    .from("tasks")
    .insert({ id, area_id: areaId, title: `Aufgabe ${marker}`, sort: "a0", ...values })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  created.tasks.push(id);
  return data as NonNullable<typeof data>;
}

async function createNote(title: string, values: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const { error } = await db.from("notes").insert({ id, area_id: areaId, title, ...values });
  expect(error, error?.message).toBeNull();
  created.notes.push(id);
  return id;
}

async function linksFrom(blockId: string) {
  const { data, error } = await db
    .from("links")
    .select("source_note_id, target_note_id")
    .eq("source_block_id", blockId);
  expect(error).toBeNull();
  return data ?? [];
}

beforeAll(async () => {
  const { data } = await db.from("areas").select("id").order("sort");
  areaId = data?.[0]?.id ?? "";
  otherAreaId = data?.[1]?.id ?? "";
  expect(areaId).not.toBe("");
  expect(otherAreaId).not.toBe("");
});

afterAll(async () => {
  // hart löschen, nur eigene Testdaten (Blöcke und Links hängen per cascade an den Notizen)
  if (created.notes.length) await db.from("notes").delete().in("id", created.notes);
  if (created.tasks.length) await db.from("tasks").delete().in("id", created.tasks);
  if (created.projects.length) await db.from("projects").delete().in("id", created.projects);
});

describe("Aufgaben", () => {
  it("completed_at wird beim Erledigen gesetzt und beim Wiedereröffnen geleert", async () => {
    const task = await createTask();
    expect(task.completed_at).toBeNull();
    const done = await db
      .from("tasks")
      .update({ status: "erledigt" })
      .eq("id", task.id)
      .select()
      .single();
    expect(done.data?.completed_at).not.toBeNull();
    const reopened = await db
      .from("tasks")
      .update({ status: "offen" })
      .eq("id", task.id)
      .select()
      .single();
    expect(reopened.data?.completed_at).toBeNull();
  });

  it("ohne Bereich nur in der Inbox", async () => {
    const { error } = await db
      .from("tasks")
      .insert({ title: marker, sort: "a0", area_id: null, in_inbox: false });
    expect(error?.code).toBe("23514");
    const inbox = await createTask({ area_id: null, in_inbox: true });
    expect(inbox.area_id).toBeNull();
  });

  it("Bereich folgt dem Projekt", async () => {
    const projectId = crypto.randomUUID();
    await db
      .from("projects")
      .insert({ id: projectId, area_id: otherAreaId, title: `Projekt ${marker}`, sort: "a0" });
    created.projects.push(projectId);
    const task = await createTask({ project_id: projectId });
    expect(task.area_id).toBe(otherAreaId);
    await db.from("projects").update({ area_id: areaId }).eq("id", projectId);
    const moved = await db.from("tasks").select("area_id").eq("id", task.id).single();
    expect(moved.data?.area_id).toBe(areaId);
  });

  it("„Blockiert durch“: Selbstverweis und Zyklen werden abgelehnt", async () => {
    const [t1, t2, t3] = [await createTask(), await createTask(), await createTask()];
    const self = await db
      .from("task_dependencies")
      .insert({ task_id: t1.id, blocked_by_task_id: t1.id });
    expect(self.error?.code).toBe("23514");

    expect(
      (await db.from("task_dependencies").insert({ task_id: t1.id, blocked_by_task_id: t2.id }))
        .error,
    ).toBeNull();
    expect(
      (await db.from("task_dependencies").insert({ task_id: t2.id, blocked_by_task_id: t3.id }))
        .error,
    ).toBeNull();
    const cycle = await db
      .from("task_dependencies")
      .insert({ task_id: t3.id, blocked_by_task_id: t1.id });
    expect(cycle.error?.code).toBe("23514");
    expect(cycle.error?.message).toMatch(/Zyklus/);

    const blocked = await db.from("v_tasks").select("is_blocked").eq("id", t1.id).single();
    expect(blocked.data?.is_blocked).toBe(true);
    await db.from("tasks").update({ status: "erledigt" }).eq("id", t2.id);
    const free = await db.from("v_tasks").select("is_blocked").eq("id", t1.id).single();
    expect(free.data?.is_blocked).toBe(false);
  });

  it("complete_task erzeugt die Folgeinstanz, undo_complete_task entfernt sie", async () => {
    const task = await createTask({ recurrence: "FREQ=WEEKLY", due_date: "2026-10-20" });
    const nextId = crypto.randomUUID();
    created.tasks.push(nextId);
    const done = await db.rpc("complete_task", {
      p_task_id: task.id,
      p_next_due: "2026-10-27",
      p_next_id: nextId,
    });
    expect(done.error).toBeNull();
    expect(done.data).toEqual({ completed_id: task.id, next_id: nextId });
    const next = await db.from("tasks").select("*").eq("id", nextId).single();
    expect(next.data).toMatchObject({
      status: "offen",
      due_date: "2026-10-27",
      recurrence_source_id: task.id,
    });

    const undo = await db.rpc("undo_complete_task", { p_task_id: task.id });
    expect(undo.error).toBeNull();
    const after = await db
      .from("tasks")
      .select("id, status, deleted_at")
      .in("id", [task.id, nextId]);
    expect(after.data?.find((t) => t.id === task.id)?.status).toBe("offen");
    expect(after.data?.find((t) => t.id === nextId)?.deleted_at).not.toBeNull();
  });

  it("v_projects: Fortschritt = erledigte ÷ alle Aufgaben, ohne Aufgaben null", async () => {
    const projectId = crypto.randomUUID();
    await db
      .from("projects")
      .insert({ id: projectId, area_id: areaId, title: `Fortschritt ${marker}`, sort: "a1" });
    created.projects.push(projectId);
    const empty = await db.from("v_projects").select("progress").eq("id", projectId).single();
    expect(empty.data?.progress).toBeNull();
    await createTask({ project_id: projectId, status: "erledigt" });
    await createTask({ project_id: projectId });
    const half = await db
      .from("v_projects")
      .select("progress, task_count, done_count")
      .eq("id", projectId)
      .single();
    expect(half.data).toEqual({ progress: 0.5, task_count: 2, done_count: 1 });
  });
});

describe("Notizen und [[Links]]", () => {
  it("Link-Trigger: anlegen, Umbenennen bricht nichts, entfernen, Papierkorb", async () => {
    const source = await createNote(`Quelle ${marker}`);
    const target = await createNote(`Ziel ${marker}`);
    const blockId = crypto.randomUUID();

    const insert = await db.from("note_blocks").insert({
      id: blockId,
      note_id: source,
      sort: "a0",
      content: paragraph(text("siehe "), noteLink(target), noteLink(target)),
      content_text: "siehe [[Ziel]]",
    });
    expect(insert.error).toBeNull();
    expect(await linksFrom(blockId)).toEqual([{ source_note_id: source, target_note_id: target }]);

    // Umbenennen: Verweis per ID bleibt bestehen
    await db
      .from("notes")
      .update({ title: `Ziel umbenannt ${marker}` })
      .eq("id", target);
    const backlinks = await db.from("links").select("source_note_id").eq("target_note_id", target);
    expect(backlinks.data).toEqual([{ source_note_id: source }]);

    await db
      .from("note_blocks")
      .update({ content: paragraph(text("ohne Link")) })
      .eq("id", blockId);
    expect(await linksFrom(blockId)).toEqual([]);

    await db
      .from("note_blocks")
      .update({ content: paragraph(noteLink(target)) })
      .eq("id", blockId);
    expect(await linksFrom(blockId)).toHaveLength(1);

    await db.from("note_blocks").update({ deleted_at: new Date().toISOString() }).eq("id", blockId);
    expect(await linksFrom(blockId)).toEqual([]);

    await db.from("note_blocks").update({ deleted_at: null }).eq("id", blockId);
    expect(await linksFrom(blockId)).toHaveLength(1);
  });

  it("Verweise aus der Notiz einer Aufgabe: anlegen, entfernen, Papierkorb, Folgeinstanz", async () => {
    const target = await createNote(`Aufgabenziel ${marker}`);
    const doc = (...content: Json[]) => ({ type: "doc", content: [paragraph(...content)] });
    const task = await createTask({
      body: doc(text("siehe "), noteLink(target), noteLink(target), noteLink("kein-uuid")),
      recurrence: "FREQ=DAILY",
      due_date: "2026-10-12",
    });
    const fromTask = async (taskId: string) => {
      const { data, error } = await db
        .from("task_note_links")
        .select("task_id, target_note_id")
        .eq("task_id", taskId);
      expect(error).toBeNull();
      return data ?? [];
    };
    expect(await fromTask(task.id)).toEqual([{ task_id: task.id, target_note_id: target }]);

    await db
      .from("tasks")
      .update({ body: doc(text("ohne Link")) })
      .eq("id", task.id);
    expect(await fromTask(task.id)).toEqual([]);
    await db
      .from("tasks")
      .update({ body: doc(noteLink(target)) })
      .eq("id", task.id);
    expect(await fromTask(task.id)).toHaveLength(1);

    await db.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", task.id);
    expect(await fromTask(task.id)).toEqual([]);
    await db.from("tasks").update({ deleted_at: null }).eq("id", task.id);
    expect(await fromTask(task.id)).toHaveLength(1);

    // Erledigen einer wiederkehrenden Aufgabe: die Folgeinstanz verweist ebenfalls
    const nextId = crypto.randomUUID();
    created.tasks.push(nextId);
    const done = await db.rpc("complete_task", {
      p_task_id: task.id,
      p_next_due: "2026-10-13",
      p_next_id: nextId,
    });
    expect(done.error, done.error?.message).toBeNull();
    expect(await fromTask(nextId)).toEqual([{ task_id: nextId, target_note_id: target }]);

    // „((Neue Notiz“: die Warteschlange speichert die Aufgabe vor der Notiz (Migration 11)
    const laterNote = crypto.randomUUID();
    const waiting = await createTask({ body: doc(noteLink(laterNote)) });
    expect(await fromTask(waiting.id)).toEqual([]);
    const insert = await db
      .from("notes")
      .insert({ id: laterNote, area_id: areaId, title: `Später ${marker}` });
    expect(insert.error).toBeNull();
    created.notes.push(laterNote);
    expect(await fromTask(waiting.id)).toEqual([
      { task_id: waiting.id, target_note_id: laterNote },
    ]);
  });

  it("Selbstverweise und ungültige IDs erzeugen keinen Link", async () => {
    const note = await createNote(`Selbst ${marker}`);
    const blockId = crypto.randomUUID();
    await db.from("note_blocks").insert({
      id: blockId,
      note_id: note,
      sort: "a0",
      content: paragraph(noteLink(note), noteLink("kein-uuid"), noteLink(crypto.randomUUID())),
    });
    expect(await linksFrom(blockId)).toEqual([]);
  });

  it("Inline-Tags landen in notes.tags und werden nie automatisch entfernt (E14)", async () => {
    const note = await createNote(`Tags ${marker}`, { tags: ["eigen"] });
    const blockId = crypto.randomUUID();
    await db.from("note_blocks").insert({
      id: blockId,
      note_id: note,
      sort: "a0",
      content: paragraph(text("Prüfung "), tag("pa"), tag("wartung")),
    });
    const withTags = await db.from("notes").select("tags").eq("id", note).single();
    expect(withTags.data?.tags).toEqual(["eigen", "pa", "wartung"]);

    await db
      .from("note_blocks")
      .update({ content: paragraph(text("ohne")) })
      .eq("id", blockId);
    const still = await db.from("notes").select("tags").eq("id", note).single();
    expect(still.data?.tags).toEqual(["eigen", "pa", "wartung"]);
  });

  it("Notiz übernimmt den Bereich ihres Themas", async () => {
    const topicId = crypto.randomUUID();
    await db
      .from("topics")
      .insert({ id: topicId, area_id: otherAreaId, name: `Thema ${marker}`, sort: "a0" });
    const note = await createNote(`Im Thema ${marker}`, { topic_id: topicId });
    const { data } = await db.from("notes").select("area_id").eq("id", note).single();
    expect(data?.area_id).toBe(otherAreaId);
    await db.from("notes").delete().eq("id", note);
    await db.from("topics").delete().eq("id", topicId);
  });

  it("Suche: Stemming, Präfix und Teilwort", async () => {
    const note = await createNote(`Prüfung der Atemschutzgeräte ${marker}`);
    for (const query of ["Prüfungen", "Atemschutz", "schutzgerät"]) {
      const { data, error } = await db.rpc("search_all", { p_query: query });
      expect(error).toBeNull();
      expect(
        data?.map((r) => r.id),
        query,
      ).toContain(note);
    }
  });
});
