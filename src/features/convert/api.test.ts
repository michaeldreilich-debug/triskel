import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNoteActions, noteBlocksKey, notesKey } from "@/features/notes/api";
import type { NoteRow } from "@/features/notes/types";
import type { BlockRow } from "@/features/outliner/model/serializer";
import { createTaskActions, tasksKey } from "@/features/tasks/api";
import { toTask } from "@/features/tasks/queries";
import { type SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import { createConvertActions } from "./api";

let undo: (() => void) | undefined;
let message = "";
vi.mock("@/components/ui/toast", () => ({
  notifyWithUndo: (m: string, fn: () => void) => {
    message = m;
    undo = fn;
  },
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

const task = toTask({
  id: "t-1",
  title: "Einkaufen",
  area_id: "a-1",
  project_id: "p-1",
  due_date: "2026-10-21",
  body: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Samstag" }] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Milch" }] }],
          },
        ],
      },
    ],
  },
  sort: "a0",
  status: "offen",
  deleted_at: null,
});

function setup() {
  const batches: SaveOp[][] = [];
  const queue = new SaveQueue({ persist: async (batch) => void batches.push(batch) });
  const queryClient = new QueryClient();
  queryClient.setQueryData(tasksKey, [task]);
  queryClient.setQueryData(notesKey, []);
  queryClient.setQueryData(["projects"], [{ id: "p-1", area_id: "a-1", title: "Haus" }]);
  const navigated: string[] = [];
  let here = "/aufgaben?aufgabe=t-1";
  const convert = createConvertActions({
    queue,
    queryClient,
    getSupabase: () => {
      throw new Error("offline");
    },
    taskActions: createTaskActions(queue, queryClient),
    noteActions: createNoteActions(queue, queryClient),
    fallbackAreaId: () => "a-1",
    noteType: "idee",
    navigate: (href) => {
      navigated.push(href);
      here = href;
    },
    currentHref: () => here,
  });
  const ops = async () => {
    await queue.flush();
    return batches.flat();
  };
  return { queue, queryClient, convert, navigated, ops };
}

beforeEach(() => {
  undo = undefined;
  message = "";
});

describe("Aufgabe → Notiz (Aktion)", () => {
  it("legt Notiz samt Blöcken an, Aufgabe in den Papierkorb, springt zur Notiz", async () => {
    const { convert, queryClient, navigated, ops } = setup();
    const result = convert.taskToNote("t-1");
    expect(result.ok).toBe(true);
    const notes = queryClient.getQueryData<NoteRow[]>(notesKey) ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Einkaufen",
      type: "idee",
      area_id: "a-1",
      project_id: "p-1",
      snippet: "Samstag",
    });
    expect(queryClient.getQueryData(tasksKey)).toEqual([]);
    expect(navigated).toEqual([`/wissen/${notes[0]?.id}`]);
    expect(message).toContain("ist jetzt eine Notiz");
    expect(message).toContain("fällig");

    const sent = await ops();
    const blocks = sent.filter((o) => o.table === "note_blocks");
    expect(blocks.map((o) => o.values.content_text)).toEqual(["Samstag", "☑ Milch"]);
    expect(blocks.every((o) => o.values.note_id === notes[0]?.id)).toBe(true);
    expect(sent.find((o) => o.table === "tasks")?.values.deleted_at).toEqual(expect.any(String));
    // Reihenfolge: Aufgabe, Notiz, dann ihre Blöcke
    const tables = sent.map((o) => o.table);
    expect(tables.indexOf("notes")).toBeLessThan(tables.indexOf("note_blocks"));
  });

  it("Rückgängig holt die Aufgabe zurück, legt die Notiz in den Papierkorb und springt zurück", async () => {
    const { convert, queryClient, navigated, queue } = setup();
    convert.taskToNote("t-1");
    undo?.();
    expect(queryClient.getQueryData<unknown[]>(tasksKey)).toHaveLength(1);
    expect(queryClient.getQueryData<unknown[]>(notesKey)).toHaveLength(0);
    expect(navigated.at(-1)).toBe("/aufgaben?aufgabe=t-1");
    // noch nichts gesendet: Papierkorb und Zurückholen heben sich in der Warteschlange auf
    const op = queue.unconfirmedOps().find((o) => o.table === "tasks");
    expect(op?.values.deleted_at).toBeNull();
    const note = queue.unconfirmedOps().find((o) => o.table === "notes");
    expect(note?.values.deleted_at).toEqual(expect.any(String));
  });

  it("ohne Bereich und ohne Projekt nimmt es den Ersatz-Bereich (Inbox)", () => {
    const { convert, queryClient } = setup();
    queryClient.setQueryData(tasksKey, [
      { ...task, area_id: null, project_id: null, in_inbox: true },
    ]);
    convert.taskToNote("t-1");
    expect(queryClient.getQueryData<NoteRow[]>(notesKey)?.[0]?.area_id).toBe("a-1");
  });
});

const note: NoteRow = {
  id: "n-1",
  title: "Plan",
  type: "wissen",
  area_id: "a-1",
  topic_id: null,
  project_id: "p-1",
  task_id: null,
  tags: ["x"],
  reviewed_at: null,
  archived_at: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  deleted_at: null,
  edited_at: "2026-10-01T00:00:00Z",
  snippet: "",
};
const block = (id: string, text: string, sort: string): BlockRow => ({
  id,
  parent_id: null,
  sort,
  content: { type: "paragraph", content: [{ type: "text", text }] },
  content_text: text,
  collapsed: false,
  task_id: null,
});

describe("Notiz → Aufgabe (Aktion)", () => {
  it("legt die Aufgabe mit Inhalt an, Notiz in den Papierkorb, springt zur Aufgabe", async () => {
    const { convert, queryClient, navigated, ops } = setup();
    queryClient.setQueryData(notesKey, [note]);
    queryClient.setQueryData(noteBlocksKey("n-1"), {
      rows: [block("b1", "Erster Punkt", "a0"), block("b2", "☐ Offen", "a1")],
      unconfirmed: 0,
    });
    const result = await convert.noteToTask("n-1");
    expect(result.ok).toBe(true);
    const tasks = queryClient.getQueryData<Array<ReturnType<typeof toTask>>>(tasksKey) ?? [];
    const created = tasks.find((t) => t.id !== "t-1");
    expect(created).toMatchObject({
      title: "Plan",
      area_id: "a-1",
      project_id: "p-1",
      body_text: "Erster Punkt\nOffen",
    });
    expect(queryClient.getQueryData(notesKey)).toEqual([]);
    expect(navigated).toEqual([`/aufgaben?aufgabe=${created?.id}`]);
    expect(message).toContain("Typ, Tags gehen nicht mit");
    const sent = await ops();
    expect(sent.find((o) => o.table === "notes")?.values.deleted_at).toEqual(expect.any(String));
    expect(sent.find((o) => o.table === "tasks" && o.id === created?.id)?.mode).toBe("upsert");

    undo?.();
    expect(queryClient.getQueryData<unknown[]>(notesKey)).toHaveLength(1);
    expect(
      queryClient.getQueryData<Array<{ id: string }>>(tasksKey)?.some((t) => t.id === created?.id),
    ).toBe(false);
  });

  it("lässt die Notiz unberührt, wenn der Inhalt nicht zu laden ist", async () => {
    const { convert, queryClient, navigated } = setup();
    queryClient.setQueryData(notesKey, [note]);
    const result = await convert.noteToTask("n-1");
    expect(result.ok).toBe(false);
    expect(queryClient.getQueryData<unknown[]>(notesKey)).toHaveLength(1);
    expect(navigated).toEqual([]);
  });
});
