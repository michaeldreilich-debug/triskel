/**
 * B1-Abnahme gegen das Testprojekt: Ohne Login ist nichts lesbar (Tabellen, Views, RPCs),
 * Testnutzer A sieht und ändert nichts von Testnutzer B.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { anonClient, type Db, runMarker, userClient } from "../support/supabase-node";

const TABLES = [
  "user_settings",
  "areas",
  "topics",
  "projects",
  "milestones",
  "tasks",
  "task_dependencies",
  "notes",
  "note_blocks",
  "links",
  "task_note_links",
  "recaps",
  "templates",
  "saved_views",
  "ai_activity",
  "ai_clients",
  "calendar_sources",
  "google_accounts",
  "event_links",
  // öffentliche Freigaben (#94): anon nur über shared_note/shared_note_file (freigabe.test.ts)
  "note_shares",
] as const;
const VIEWS = ["v_tasks", "v_projects"] as const;
type Relation = (typeof TABLES)[number] | (typeof VIEWS)[number];

const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

/** RPCs mit gültigen Argumenten – anon muss trotzdem abgewiesen werden. */
const RPCS: Array<[string, Record<string, unknown>]> = [
  ["complete_task", { p_task_id: ZERO_UUID }],
  ["undo_complete_task", { p_task_id: ZERO_UUID }],
  ["week_stats", { p_start: "2026-10-05", p_end: "2026-10-11" }],
  ["close_recap", { p_recap_id: ZERO_UUID }],
  ["empty_trash", { p_entity: "tasks", p_ids: [ZERO_UUID] }],
  ["search_all", { p_query: "Beruf" }],
  ["seed_user_defaults", { p_user_id: ZERO_UUID }],
  ["ai_client_allowed", {}],
];

const sessionA = inject("sessionA");
const sessionB = inject("sessionB");
const anon = anonClient();
const a = userClient(sessionA);
const b = userClient(sessionB);
const marker = runMarker();

// Daten von B, die A auf keinem Weg sehen darf
const bData = {
  topicId: crypto.randomUUID(),
  noteId: crypto.randomUUID(),
  blockId: crypto.randomUUID(),
  taskId: crypto.randomUUID(),
  blockerId: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
};
let bAreaId = "";

async function rows(client: Db, relation: Relation) {
  // Union der Relationen: für den Typ genügt eine stellvertretende Tabelle
  const { data, error } = await client.from(relation as "areas").select("*");
  expect(error, `${relation}: ${error?.message}`).toBeNull();
  return (data ?? []) as Array<{ user_id: string | null }>;
}

beforeAll(async () => {
  const { data: areas, error } = await b.from("areas").select("id").order("sort").limit(1);
  expect(error).toBeNull();
  bAreaId = areas?.[0]?.id ?? "";
  expect(bAreaId).not.toBe("");

  const steps = [
    b
      .from("topics")
      .insert({ id: bData.topicId, area_id: bAreaId, name: `B ${marker}`, sort: "a0" }),
    b.from("projects").insert({
      id: bData.projectId,
      area_id: bAreaId,
      title: `Geheimprojekt ${marker}`,
      sort: "a0",
    }),
    b.from("notes").insert({
      id: bData.noteId,
      area_id: bAreaId,
      topic_id: bData.topicId,
      title: `Geheimnotiz ${marker}`,
    }),
    b.from("note_blocks").insert({
      id: bData.blockId,
      note_id: bData.noteId,
      sort: "a0",
      content: { type: "paragraph", content: [{ type: "text", text: `Geheim ${marker}` }] },
      content_text: `Geheim ${marker}`,
    }),
    b.from("tasks").insert([
      { id: bData.taskId, area_id: bAreaId, title: `Geheimaufgabe ${marker}`, sort: "a0" },
      { id: bData.blockerId, area_id: bAreaId, title: `Blocker ${marker}`, sort: "a1" },
    ]),
    b.from("task_dependencies").insert({
      task_id: bData.taskId,
      blocked_by_task_id: bData.blockerId,
    }),
  ];
  for (const step of steps) {
    const { error: stepError } = await step;
    expect(stepError, stepError?.message).toBeNull();
  }
});

afterAll(async () => {
  await b.from("notes").delete().eq("id", bData.noteId);
  await b.from("tasks").delete().in("id", [bData.taskId, bData.blockerId]);
  await b.from("projects").delete().eq("id", bData.projectId);
  await b.from("topics").delete().eq("id", bData.topicId);
});

describe("anon (ohne Login) liest nichts", () => {
  it.each([...TABLES, ...VIEWS])("%s: Lesen wird verweigert", async (relation) => {
    const { data, error } = await anon
      .from(relation as "areas")
      .select("*")
      .limit(1);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it.each(TABLES)("%s: Schreiben wird verweigert", async (table) => {
    const { error } = await anon
      .from(table)
      .insert({} as never)
      .select();
    expect(error?.code).toBe("42501");
  });

  it.each(RPCS)("RPC %s wird verweigert", async (fn, args) => {
    const { data, error } = await anon.rpc(fn as never, args as never);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("seed_user_defaults ist auch für Angemeldete gesperrt", async () => {
    const { error } = await a.rpc("seed_user_defaults", { p_user_id: sessionA.userId });
    expect(error?.code).toBe("42501");
  });
});

describe("Testnutzer A sieht nichts von Testnutzer B", () => {
  it.each([...TABLES, ...VIEWS])("%s: nur eigene Zeilen", async (relation) => {
    const own = await rows(a, relation);
    for (const row of own) expect(row.user_id).toBe(sessionA.userId);
  });

  it("B sieht seine eigenen Daten (Gegenprobe)", async () => {
    const notes = await b.from("notes").select("id").eq("id", bData.noteId);
    expect(notes.data).toHaveLength(1);
    const blocked = await b.from("v_tasks").select("is_blocked").eq("id", bData.taskId).single();
    expect(blocked.data?.is_blocked).toBe(true);
  });

  it("A findet Bs Daten weder per ID noch über die Suche", async () => {
    for (const [table, id] of [
      ["notes", bData.noteId],
      ["note_blocks", bData.blockId],
      ["tasks", bData.taskId],
      ["projects", bData.projectId],
      ["topics", bData.topicId],
      ["areas", bAreaId],
    ] as const) {
      const { data, error } = await a.from(table).select("id").eq("id", id);
      expect(error).toBeNull();
      expect(data, table).toEqual([]);
    }
    const viaView = await a.from("v_projects").select("id").eq("id", bData.projectId);
    expect(viaView.data).toEqual([]);

    const searchA = await a.rpc("search_all", { p_query: `Geheimnotiz ${marker}` });
    expect(searchA.error).toBeNull();
    expect(searchA.data).toEqual([]);
    const searchB = await b.rpc("search_all", { p_query: `Geheimnotiz ${marker}` });
    expect(searchB.data?.map((r) => r.id)).toContain(bData.noteId);
  });

  it("A kann Bs Zeilen weder ändern noch löschen", async () => {
    const update = await a
      .from("notes")
      .update({ title: "übernommen" })
      .eq("id", bData.noteId)
      .select();
    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);

    const remove = await a.from("areas").delete().eq("id", bAreaId).select();
    expect(remove.error).toBeNull();
    expect(remove.data).toEqual([]);

    const rpc = await a.rpc("complete_task", { p_task_id: bData.taskId });
    expect(rpc.error?.code).toBe("P0002"); // „nicht gefunden“ – RLS blendet sie aus

    const check = await b.from("notes").select("title").eq("id", bData.noteId).single();
    expect(check.data?.title).toBe(`Geheimnotiz ${marker}`);
    const task = await b.from("tasks").select("status").eq("id", bData.taskId).single();
    expect(task.data?.status).toBe("offen");
    const area = await b.from("areas").select("id").eq("id", bAreaId);
    expect(area.data).toHaveLength(1);
  });

  it("in jeder Tabelle: A liest und ändert keine Zeile mit Bs user_id (Review Teil B, M-7)", async () => {
    for (const table of TABLES) {
      const read = await a.from(table).select("user_id").eq("user_id", sessionB.userId);
      expect(read.error, table).toBeNull();
      expect(read.data, table).toEqual([]);
      const changed = await a
        .from(table)
        .update({ updated_at: new Date().toISOString() } as never)
        .eq("user_id", sessionB.userId)
        .select("user_id");
      expect(changed.data ?? [], table).toEqual([]);
    }
    // Gegenprobe: B hat in den Stammtabellen Zeilen, die A nicht sieht
    for (const table of ["areas", "note_types", "templates", "user_settings"] as const) {
      const own = await b.from(table).select("user_id").eq("user_id", sessionB.userId);
      expect((own.data ?? []).length, table).toBeGreaterThan(0);
    }
  });

  it("A kann keine Zeilen im Namen von B anlegen", async () => {
    const { error } = await a.from("areas").insert({
      user_id: sessionB.userId,
      name: `Fremd ${marker}`,
      sort: "z9",
    });
    expect(error?.code).toBe("42501");
  });

  it("Ein [[Link]] von A auf Bs Notiz entsteht nicht", async () => {
    const { data: area } = await a.from("areas").select("id").limit(1).single();
    const noteId = crypto.randomUUID();
    const blockId = crypto.randomUUID();
    await a.from("notes").insert({ id: noteId, area_id: area?.id as string, title: marker });
    const insert = await a.from("note_blocks").insert({
      id: blockId,
      note_id: noteId,
      sort: "a0",
      content: {
        type: "paragraph",
        content: [{ type: "noteLink", attrs: { noteId: bData.noteId } }],
      },
    });
    expect(insert.error).toBeNull();
    const links = await a.from("links").select("*").eq("source_block_id", blockId);
    expect(links.data).toEqual([]);
    const linksB = await b.from("links").select("*").eq("target_note_id", bData.noteId);
    expect(linksB.data).toEqual([]);
    await a.from("notes").delete().eq("id", noteId);
  });

  it("Ein Verweis aus einer Aufgabe von A auf Bs Notiz entsteht nicht", async () => {
    const { data: area } = await a.from("areas").select("id").limit(1).single();
    const taskId = crypto.randomUUID();
    const insert = await a.from("tasks").insert({
      id: taskId,
      area_id: area?.id as string,
      title: marker,
      sort: "a0",
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "noteLink", attrs: { noteId: bData.noteId } }] },
        ],
      },
    });
    expect(insert.error).toBeNull();
    const links = await a.from("task_note_links").select("*").eq("task_id", taskId);
    expect(links.data).toEqual([]);
    const linksB = await b.from("task_note_links").select("*").eq("target_note_id", bData.noteId);
    expect(linksB.data).toEqual([]);
    await a.from("tasks").delete().eq("id", taskId);
  });
});
