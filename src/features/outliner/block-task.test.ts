// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalTaskDirectory } from "./directory";
import { blockTaskIdAt } from "./extensions/block-task";
import { docToRows } from "./model/serializer";
import { counterIds, createTestEditor, cursor, outline, type } from "./test-utils";

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  document.body.innerHTML = "";
});

const checkbox = (blockId: string) =>
  document.querySelector<HTMLElement>(
    `.ol-block[data-block-id="${blockId}"] > .ol-gutter > .ol-check`,
  );

describe("Block → Aufgabe (B5)", () => {
  it("nur Blöcke mit Aufgabe hören auf den Aufgaben-Cache (O-15)", () => {
    const tasks = createLocalTaskDirectory({ generateId: counterIds("task") });
    let listeners = 0;
    const subscribe = tasks.subscribe.bind(tasks);
    tasks.subscribe = (listener) => {
      listeners += 1;
      const off = subscribe(listener);
      return () => {
        listeners -= 1;
        off();
      };
    };
    editor = createTestEditor(outline(["Eins", "Zwei", "Drei"]), { tasks });
    expect(listeners).toBe(0);
    cursor(editor, "Zwei", "start");
    type(editor, "[] ");
    expect(listeners).toBe(1);
  });

  it("„[] “ am Blockanfang legt eine Aufgabe mit dem Blocktext an und setzt taskId", () => {
    const tasks = createLocalTaskDirectory({ generateId: counterIds("task") });
    editor = createTestEditor(outline(["Angebot einholen", "Zweiter"]), { tasks });
    cursor(editor, "Angebot einholen", "start");
    type(editor, "[] ");
    expect(tasks.all()).toEqual([{ id: "task-1", title: "Angebot einholen", done: false }]);
    const rows = docToRows(editor.getJSON(), []);
    expect(rows[0]).toMatchObject({ content_text: "Angebot einholen", task_id: "task-1" });
    expect(rows[1]?.task_id).toBeNull();
    expect(blockTaskIdAt(editor.state)).toBe("task-1");
  });

  it("„() “ geht genauso (deutsche Tastatur ohne ⌥), auch „( ) “", () => {
    const tasks = createLocalTaskDirectory({ generateId: counterIds("task") });
    editor = createTestEditor(outline(["Leiter prüfen", "Schlauch"]), { tasks });
    cursor(editor, "Leiter prüfen", "start");
    type(editor, "() ");
    cursor(editor, "Schlauch", "start");
    type(editor, "( ) ");
    expect(tasks.all().map((t) => t.title)).toEqual(["Leiter prüfen", "Schlauch"]);
    const rows = docToRows(editor.getJSON(), []);
    expect(rows.map((r) => r.content_text)).toEqual(["Leiter prüfen", "Schlauch"]);
  });

  it("„[ ] “ in einem leeren Block; mitten im Text passiert nichts", () => {
    const tasks = createLocalTaskDirectory({ generateId: counterIds("task") });
    editor = createTestEditor(outline(["", "Text"]), { tasks });
    cursor(editor, "", "start");
    type(editor, "[ ] ");
    expect(tasks.all()).toHaveLength(1);
    cursor(editor, "Text", "end");
    type(editor, " [] ");
    expect(tasks.all()).toHaveLength(1);
    expect(docToRows(editor.getJSON(), [])[1]?.content_text).toBe("Text [] ");
  });

  it("Checkbox zeigt den Status und hakt die Aufgabe ab (synchron in beide Richtungen)", () => {
    const tasks = createLocalTaskDirectory({ generateId: counterIds("task") });
    editor = createTestEditor(outline(["Punkt"]), { tasks });
    cursor(editor, "Punkt", "start");
    type(editor, "[] ");
    const box = checkbox("id-Punkt");
    expect(box?.hidden).toBe(false);
    expect(box?.getAttribute("aria-checked")).toBe("false");
    box?.click();
    expect(tasks.get("task-1")?.done).toBe(true);
    expect(box?.getAttribute("aria-checked")).toBe("true");
    // Aufgabe woanders wieder geöffnet → Block zeigt es sofort
    tasks.toggle("task-1");
    expect(box?.getAttribute("aria-checked")).toBe("false");
  });

  it("Befehle: umwandeln und Verknüpfung lösen", () => {
    const tasks = createLocalTaskDirectory({ generateId: counterIds("task") });
    editor = createTestEditor(outline(["Rückruf"]), { tasks });
    cursor(editor, "Rückruf", "end");
    expect(editor.commands.convertBlockToTask()).toBe(true);
    expect(tasks.get("task-1")?.title).toBe("Rückruf");
    expect(editor.can().convertBlockToTask()).toBe(false);
    expect(editor.commands.unlinkBlockTask()).toBe(true);
    expect(blockTaskIdAt(editor.state)).toBeNull();
    expect(tasks.all()).toHaveLength(1);
  });

  it("ohne Aufgaben-Verzeichnis bleibt „[] “ normaler Text", () => {
    editor = createTestEditor(outline(["X"]));
    cursor(editor, "X", "start");
    type(editor, "[] ");
    expect(docToRows(editor.getJSON(), [])[0]?.content_text).toBe("[] X");
  });
});

describe("taskBlockTexts", () => {
  it("liefert den Klartext je Aufgaben-Block (auch verschachtelt, Zeilenumbruch als Leerzeichen)", async () => {
    const { taskBlockTexts } = await import("./model/serializer");
    const doc = outline(["Oben", ["Eltern", ["Kind"]]]);
    const blocks = doc.content as Array<{ attrs: Record<string, unknown>; content: unknown[] }>;
    (blocks[0] as { attrs: Record<string, unknown> }).attrs.taskId = "t1";
    const parent = blocks[1] as { content: Array<{ attrs: Record<string, unknown> }> };
    (parent.content[1] as { attrs: Record<string, unknown> }).attrs.taskId = "t2";
    expect([...taskBlockTexts(doc)]).toEqual([
      ["t1", "Oben"],
      ["t2", "Kind"],
    ]);
  });
});
