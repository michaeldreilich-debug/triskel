// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { collectFiles } from "@/features/notes/attachments";
import { collectImagePaths } from "@/features/notes/images";
import { createOutlineExtensions } from "@/features/outliner/extensions";
import { type BlockRow, docToRows, rowsToDoc } from "@/features/outliner/model/serializer";
import { counterIds } from "@/features/outliner/test-utils";
import { createTaskBodyExtensions } from "@/features/tasks/components/task-body-editor";
import type { TaskRow } from "@/features/tasks/types";
import {
  bodyTextOf,
  CHECK_DONE,
  CHECK_OPEN,
  lostByNoteToTask,
  lostByTaskToNote,
  lostSuffix,
  rowsToTaskBody,
  taskBodyToOutline,
  taskBodyToRows,
} from "./model";

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

const p = (text: string, marks?: JSONContent["marks"]): JSONContent =>
  text
    ? { type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] }
    : { type: "paragraph" };
const item = (text: string, extra: JSONContent[] = [], type = "listItem", checked?: boolean) => ({
  type,
  ...(checked === undefined ? {} : { attrs: { checked } }),
  content: [p(text), ...extra],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const image = (path: string): JSONContent => ({
  type: "noteImage",
  attrs: { path, alt: "Foto" },
});
const file = (path: string): JSONContent => ({
  type: "noteFile",
  attrs: { path, name: "Plan.pdf", size: 10, mime: "application/pdf", view: "tile" },
});

/** Der Editor nimmt das Dokument nur an, wenn es zum Schema passt (sonst Fehler/leer). */
function loadsInTask(content: JSONContent) {
  const element = document.createElement("div");
  document.body.append(element);
  const e = new Editor({
    element,
    extensions: createTaskBodyExtensions(),
    content,
    enableContentCheck: true,
    onContentError: ({ error }) => {
      throw error;
    },
  });
  editors.push(e);
  return e.getJSON();
}
function loadsInOutline(content: JSONContent) {
  const element = document.createElement("div");
  document.body.append(element);
  const e = new Editor({
    element,
    extensions: createOutlineExtensions(),
    content,
    enableContentCheck: true,
    onContentError: ({ error }) => {
      throw error;
    },
  });
  editors.push(e);
  return e.getJSON();
}

const texts = (rows: BlockRow[]) => rows.map((r) => `${r.parent_id ? "  " : ""}${r.content_text}`);

describe("Aufgabe → Notiz", () => {
  it("Absätze werden Blöcke, Listen verschachtelt, Checkliste mit Häkchen-Zeichen", () => {
    const body = doc(
      p("Einkauf"),
      {
        type: "taskList",
        content: [
          item("Milch", [], "taskItem", true),
          item(
            "Brot",
            [item("Vollkorn", [], "taskItem", false)].length
              ? [{ type: "taskList", content: [item("Vollkorn", [], "taskItem", false)] }]
              : [],
            "taskItem",
            false,
          ),
        ],
      },
      {
        type: "bulletList",
        content: [item("Notiz A", [{ type: "bulletList", content: [item("tiefer")] }])],
      },
      { type: "orderedList", attrs: { start: 1 }, content: [item("eins"), item("zwei")] },
    );
    const rows = taskBodyToRows(body, counterIds("b"));
    expect(texts(rows)).toEqual([
      "Einkauf",
      `${CHECK_DONE}Milch`,
      `${CHECK_OPEN}Brot`,
      `  ${CHECK_OPEN}Vollkorn`,
      "Notiz A",
      "  tiefer",
      "1. eins",
      "2. zwei",
    ]);
    // gültiges Outline-Dokument: der Editor lädt es unverändert
    const outline = rowsToDoc(rows);
    expect(loadsInOutline(outline).content).toHaveLength(6);
  });

  it("nimmt Bilder und Dateien mit denselben Pfaden mit (nichts wird neu hochgeladen)", () => {
    const body = doc(
      { type: "paragraph", content: [{ type: "text", text: "Beleg " }, image("u/t1/a.png")] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [file("u/t1/plan.pdf")] }] },
        ],
      },
    );
    const rows = taskBodyToRows(body, counterIds());
    const content = rows.map((r) => r.content);
    expect(collectImagePaths(content)).toEqual(["u/t1/a.png"]);
    expect(collectFiles(content).map((f) => f.path)).toEqual(["u/t1/plan.pdf"]);
  });

  it("behält Notiz-Links, Formatierung und Überschriften", () => {
    const body = doc(
      {
        type: "paragraph",
        attrs: { kind: "h2" },
        content: [{ type: "text", text: "Titel", marks: [{ type: "bold" }] }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "siehe " },
          { type: "noteLink", attrs: { noteId: "n-1" } },
          { type: "text", text: " ok", marks: [{ type: "unbekannt" }, { type: "italic" }] },
        ],
      },
    );
    const [first, second] = taskBodyToRows(body, counterIds());
    expect(first?.content.attrs?.kind).toBe("h2");
    expect(second?.content.content?.[1]).toEqual({ type: "noteLink", attrs: { noteId: "n-1" } });
    expect(second?.content.content?.[2]?.marks).toEqual([{ type: "italic" }]);
  });

  it("leere Aufgaben-Notiz ergibt keine Zeilen; leere Absätze fallen weg", () => {
    expect(taskBodyToRows(null, counterIds())).toEqual([]);
    expect(taskBodyToRows(doc(p("")), counterIds())).toEqual([]);
    expect(texts(taskBodyToRows(doc(p("a"), p(""), p("b")), counterIds()))).toEqual(["a", "b"]);
  });

  it("vergibt eindeutige IDs", () => {
    const rows = taskBodyToRows(doc(p("a"), p("b"), p("c")), counterIds("x"));
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(taskBodyToOutline(null, counterIds()).content).toHaveLength(1);
  });

  it("nennt, was nicht mitgeht", () => {
    const task = {
      due_date: "2026-10-20",
      priority: 1,
      status: "in_arbeit",
      recurrence: "FREQ=DAILY",
      scheduled_at: null,
      milestone_id: "m",
    } as unknown as TaskRow;
    expect(lostByTaskToNote(task)).toEqual([
      expect.stringContaining("fällig"),
      "Priorität Hoch",
      "Status In Arbeit",
      "Wiederholung",
      "Meilenstein",
    ]);
    expect(lostByTaskToNote({ status: "offen" } as unknown as TaskRow)).toEqual([]);
    // Verknüpfungen (V-8): Termine und Abhängigkeiten gehen nicht mit und werden genannt
    expect(
      lostByTaskToNote({ status: "offen" } as unknown as TaskRow, {
        eventLinks: 2,
        dependencies: 1,
      }),
    ).toEqual(["2 Termin-Verknüpfungen", "1 Abhängigkeit (Blockiert durch)"]);
    expect(lostSuffix(["Tags"])).toBe(" · Tags gehen nicht mit");
    expect(lostSuffix([])).toBe("");
  });
});

const row = (
  id: string,
  text: string,
  parent: string | null,
  sort: string,
  extra: Partial<BlockRow> = {},
): BlockRow => ({
  id,
  parent_id: parent,
  sort,
  content: text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" },
  content_text: text,
  collapsed: false,
  task_id: null,
  ...extra,
});

describe("Notiz → Aufgabe", () => {
  it("einfache Blöcke werden Absätze, Unterpunkte Listenpunkte, Checkboxen eine Checkliste", () => {
    const rows = [
      row("a", "Überblick", null, "a0"),
      row("b", "Detail 1", "a", "a0"),
      row("c", "Detail 2", "a", "a1"),
      row("d", `${CHECK_OPEN}Milch`, null, "a1"),
      row("e", `${CHECK_DONE}Brot`, null, "a2"),
      row("f", "Danach", null, "a3"),
    ];
    const body = rowsToTaskBody(rows) as JSONContent;
    expect(loadsInTask(body)).toBeTruthy();
    expect(body.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "bulletList",
      "taskList",
      "paragraph",
    ]);
    const list = body.content?.[2]?.content;
    expect(list?.map((i) => [i.attrs?.checked, i.content?.[0]?.content?.[0]?.text])).toEqual([
      [false, "Milch"],
      [true, "Brot"],
    ]);
    expect(bodyTextOf(body)).toBe("Überblick\nDetail 1\nDetail 2\nMilch\nBrot\nDanach");
  });

  it("Aufgaben-Blöcke werden Punkte der Checkliste mit dem Status der Aufgabe", () => {
    const rows = [
      row("a", "Anrufen", null, "a0", { task_id: "t-1" }),
      row("b", "Mail", null, "a1", { task_id: "t-2" }),
    ];
    const body = rowsToTaskBody(rows, { taskDone: (id) => id === "t-2" }) as JSONContent;
    expect(loadsInTask(body)).toBeTruthy();
    expect(body.content?.[0]?.content?.map((i) => i.attrs?.checked)).toEqual([false, true]);
  });

  it("sehr tief verschachtelte und lange Notizen werden vollständig übernommen", () => {
    const rows: BlockRow[] = [];
    let parent: string | null = null;
    for (let depth = 0; depth < 12; depth++) {
      const id = `d${depth}`;
      rows.push(row(id, `Ebene ${depth}`, parent, "a0"));
      parent = id;
    }
    for (let i = 0; i < 300; i++)
      rows.push(row(`l${i}`, `Zeile ${i}`, null, `b${String(i).padStart(3, "0")}`));
    const body = rowsToTaskBody(rows) as JSONContent;
    expect(loadsInTask(body)).toBeTruthy();
    const text = bodyTextOf(body);
    for (let depth = 0; depth < 12; depth++) expect(text).toContain(`Ebene ${depth}`);
    expect(text).toContain("Zeile 299");
    expect(text.split("\n")).toHaveLength(12 + 300);
  });

  it("Tags werden Text, Diagramme Code-Text, Bilder/Dateien/Links bleiben", () => {
    const rows = [
      row("a", "", null, "a0", {
        content: {
          type: "paragraph",
          content: [
            { type: "text", text: "Idee " },
            { type: "tag", attrs: { name: "arbeit" } },
            { type: "noteImage", attrs: { path: "u/n1/a.png", alt: "" } },
            { type: "noteLink", attrs: { noteId: "n-9" } },
          ],
        },
        content_text: "Idee #arbeit",
      }),
      row("b", "", null, "a1", {
        content: {
          type: "paragraph",
          content: [{ type: "mermaid", attrs: { code: "graph TD\nA-->B" } }],
        },
      }),
      row("c", "", null, "a2", {
        content: { type: "paragraph", content: [file("u/n1/p.pdf")] },
      }),
    ];
    const body = rowsToTaskBody(rows) as JSONContent;
    expect(loadsInTask(body)).toBeTruthy();
    expect(collectImagePaths([body])).toEqual(["u/n1/a.png"]);
    expect(collectFiles([body]).map((f) => f.path)).toEqual(["u/n1/p.pdf"]);
    const text = bodyTextOf(body, { resolveTitle: (id) => (id === "n-9" ? "Andere" : undefined) });
    expect(text).toContain("Idee #arbeit");
    expect(text).toContain("Andere");
    expect(text).toContain("A-->B");
  });

  it("leere Notiz ergibt keinen Inhalt; gelöschte Zeilen zählen nicht", () => {
    expect(rowsToTaskBody([])).toBeNull();
    expect(rowsToTaskBody([row("a", "", null, "a0")])).toBeNull();
    const body = rowsToTaskBody([
      row("a", "weg", null, "a0", { deleted_at: "x" }),
      row("b", "da", null, "a1"),
    ]);
    expect(bodyTextOf(body)).toBe("da");
  });

  it("nennt, was nicht mitgeht", () => {
    expect(lostByNoteToTask({ tags: ["a"], topic_id: "t", type: "wissen" }, "idee")).toEqual([
      "Typ",
      "Thema",
      "Tags",
    ]);
    expect(lostByNoteToTask({ tags: [], topic_id: null, type: "idee" }, "idee")).toEqual([]);
    expect(
      lostByNoteToTask({ tags: [], topic_id: null, type: "idee" }, "idee", {
        eventLinks: 1,
        shared: true,
      }),
    ).toEqual(["1 Termin-Verknüpfung", "öffentliche Freigabe (ruht im Papierkorb)"]);
  });

  it("Hin und zurück verliert keinen Text (Absätze, Unterpunkte, Checkliste)", () => {
    const body = doc(
      p("Plan"),
      {
        type: "bulletList",
        content: [item("A", [{ type: "bulletList", content: [item("A1")] }]), item("B")],
      },
      { type: "taskList", content: [item("x", [], "taskItem", true)] },
    );
    const rows = taskBodyToRows(body, counterIds());
    const back = rowsToTaskBody(rows) as JSONContent;
    expect(bodyTextOf(back).split("\n")).toEqual(["Plan", "A", "A1", "B", "x"]);
    expect(back.content?.at(-1)?.content?.[0]?.attrs?.checked).toBe(true);
    expect(docToRows(rowsToDoc(rows)).map((r) => r.content_text)).toEqual(
      rows.map((r) => r.content_text),
    );
  });
});
