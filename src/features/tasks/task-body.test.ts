// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalNoteDirectory } from "@/features/outliner/directory";
import { type } from "@/features/outliner/test-utils";
import { addChecklistItem, createTaskBodyExtensions } from "./components/task-body-editor";

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  document.body.innerHTML = "";
});

const create = (content: JSONContent) => {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: createTaskBodyExtensions(), content });
  return editor;
};
const paragraph = (text: string): JSONContent =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
const item = (text: string, checked = false): JSONContent => ({
  type: "taskItem",
  attrs: { checked },
  content: [paragraph(text)],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const items = (e: Editor) => {
  const result: Array<{ text: string; checked: boolean }> = [];
  e.state.doc.descendants((node) => {
    if (node.type.name === "taskItem") {
      result.push({ text: node.textContent, checked: Boolean(node.attrs.checked) });
    }
  });
  return result;
};

describe("Aufgaben-Notiz: Checkliste ohne eckige Klammern (Rückmeldung 12.10.2026)", () => {
  it("„Punkt hinzufügen“ macht aus einem leeren Feld den ersten Punkt", () => {
    create(doc(paragraph("")));
    addChecklistItem(editor);
    type(editor, "Milch");
    expect(items(editor)).toEqual([{ text: "Milch", checked: false }]);
    expect(editor.state.doc.firstChild?.type.name).toBe("taskList");
  });

  it("hängt an eine Checkliste am Ende an; ein leerer letzter Punkt bekommt nur den Cursor", () => {
    create(doc(paragraph("Einkauf"), { type: "taskList", content: [item("Milch", true)] }));
    addChecklistItem(editor);
    type(editor, "Brot");
    addChecklistItem(editor);
    addChecklistItem(editor);
    type(editor, "Käse");
    expect(items(editor)).toEqual([
      { text: "Milch", checked: true },
      { text: "Brot", checked: false },
      { text: "Käse", checked: false },
    ]);
    expect(editor.state.doc.firstChild?.textContent).toBe("Einkauf");
    // eine Liste, kein zweiter Listenanfang hinter dem leeren Absatz am Ende
    let lists = 0;
    editor.state.doc.forEach((node) => {
      if (node.type.name === "taskList") lists += 1;
    });
    expect(lists).toBe(1);
  });

  it("nach Text beginnt eine neue Checkliste unter dem Text", () => {
    create(doc(paragraph("Vorher klären")));
    addChecklistItem(editor);
    type(editor, "Termin");
    expect(editor.state.doc.firstChild?.textContent).toBe("Vorher klären");
    expect(items(editor)).toEqual([{ text: "Termin", checked: false }]);
  });

  it("„() “ und „[] “ am Zeilenanfang ergeben einen Punkt, „(x) “ einen erledigten", () => {
    create(doc(paragraph("")));
    editor.commands.setTextSelection(1);
    type(editor, "() Leiter");
    editor.commands.enter();
    type(editor, "Schlauch");
    expect(items(editor)).toEqual([
      { text: "Leiter", checked: false },
      { text: "Schlauch", checked: false },
    ]);

    create(doc(paragraph("")));
    editor.commands.setTextSelection(1);
    type(editor, "(x) Erledigt");
    expect(items(editor)).toEqual([{ text: "Erledigt", checked: true }]);
  });

  it("„((“ verlinkt eine Notiz; der Link speichert die ID, nicht den Titel", () => {
    const notes = createLocalNoteDirectory([{ id: "n1", title: "Atemschutz" }]);
    const element = document.createElement("div");
    document.body.append(element);
    editor = new Editor({
      element,
      extensions: createTaskBodyExtensions({ notes }),
      content: doc(paragraph("")),
    });
    editor.commands.setTextSelection(1);
    editor
      .chain()
      .insertContent([
        { type: "noteLink", attrs: { noteId: "n1" } },
        { type: "text", text: " " },
      ])
      .run();
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"noteId":"n1"');
    expect(json).not.toContain("Atemschutz");
  });
});
