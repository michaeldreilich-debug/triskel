// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";
import { writeTaskTitles } from "./model/guard";
import { forEachBlock, paragraphOf } from "./model/tree";
import {
  blockIds,
  createTestEditor,
  cursor,
  outline,
  press,
  selectBetween,
  show,
  type,
} from "./test-utils";

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  document.body.innerHTML = "";
});

/** Position und Größe des Blocks mit diesem Text. */
function blockRange(e: Editor, text: string): { from: number; to: number } {
  let range: { from: number; to: number } | null = null;
  forEachBlock(e.state.doc, (ref) => {
    if (!range && paragraphOf(ref.node).textContent === text) {
      range = { from: ref.pos, to: ref.pos + ref.node.nodeSize };
    }
  });
  if (!range) throw new Error(`Block „${text}“ nicht gefunden`);
  return range;
}

function setTaskId(e: Editor, text: string, taskId: string) {
  const { from } = blockRange(e, text);
  const node = e.state.doc.nodeAt(from);
  if (!node) throw new Error("kein Block");
  e.view.dispatch(e.state.tr.setNodeMarkup(from, undefined, { ...node.attrs, taskId }));
}

const taskIdOf = (e: Editor, text: string) =>
  e.state.doc.nodeAt(blockRange(e, text).from)?.attrs.taskId ?? null;

/** Wie ⌘V aus dem Outliner: ProseMirror wendet transformPasted an und fügt die Struktur ein. */
function pasteSlice(e: Editor, slice: Slice) {
  const transformed =
    e.view.someProp("transformPasted", (fn) => (fn as (s: Slice) => Slice)(slice)) ?? slice;
  e.view.dispatch(e.state.tr.replaceSelection(transformed));
}

describe("Verschieben behält die Aufgabe, Kopieren nicht (Review Teil B, V-9)", () => {
  it("Ausschneiden + Einfügen: ID und taskId bleiben", () => {
    editor = createTestEditor(outline(["A", "B", "C"]));
    setTaskId(editor, "B", "task-b");
    const range = blockRange(editor, "B");
    const slice = editor.state.doc.slice(range.from, range.to);
    editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
    cursor(editor, "C");
    pasteSlice(editor, slice);
    // (ProseMirror hängt den Block hinter dem Cursor als Kind an – hier zählt nur, was er behält)
    expect(show(editor).replace("|", "").replace(/\n\s+/g, "\n")).toBe("A\nC\nB");
    expect(blockIds(editor)).toEqual(["id-A", "id-C", "id-B"]);
    expect(taskIdOf(editor, "B")).toBe("task-b");
  });

  it("Kopieren + Einfügen: die Kopie bekommt eine neue ID und keine Aufgabe, das Original behält beides", () => {
    editor = createTestEditor(outline(["A", "B"]));
    setTaskId(editor, "B", "task-b");
    const range = blockRange(editor, "B");
    const slice = editor.state.doc.slice(range.from, range.to);
    cursor(editor, "A");
    pasteSlice(editor, slice);
    const texts: string[] = [];
    const ids: Array<[string, string | null]> = [];
    forEachBlock(editor.state.doc, (ref) => {
      texts.push(paragraphOf(ref.node).textContent);
      ids.push([ref.node.attrs.id, ref.node.attrs.taskId]);
    });
    expect(texts).toEqual(["A", "B", "B"]);
    const copy = ids.find(([id]) => id !== "id-A" && id !== "id-B");
    expect(copy?.[1]).toBeNull();
    expect(ids).toContainEqual(["id-B", "task-b"]);
    expect(new Set(ids.map(([id]) => id)).size).toBe(3);
    // die Marke „eingefügt“ bleibt nicht im Dokument
    editor.state.doc.descendants((node) => {
      if (node.type.name === "block") expect(node.attrs.pasted).toBe(false);
    });
  });
});

describe("Löschen über einen eingeklappten Block (Review Teil B, V-11)", () => {
  it("Backspace klappt erst auf, der zweite Druck löscht sichtbar", () => {
    editor = createTestEditor(outline([["A", ["A1", "A2"], { collapsed: true }], "B"]));
    expect(show(editor).replace("|", "")).toBe("▸ A\n  A1\n  A2\nB");
    selectBetween(editor, "A", "B");
    expect(press(editor, "Backspace")).toBe(true);
    // nichts gelöscht, A ist aufgeklappt, die Auswahl steht noch
    expect(show(editor).replace("|", "")).toBe("A\n  A1\n  A2\nB");
    expect(editor.state.selection.empty).toBe(false);
    press(editor, "Backspace");
    expect(show(editor)).not.toContain("A1");
  });

  it("Entf und Ausschneiden ebenso; ohne eingeklappten Block wie bisher", () => {
    editor = createTestEditor(outline([["A", ["A1"], { collapsed: true }], "B"]));
    selectBetween(editor, "A", "B");
    expect(press(editor, "Delete")).toBe(true);
    expect(show(editor).replace("|", "")).toBe("A\n  A1\nB");
    editor.commands.collapseBlock();
    cursor(editor, "A", "start");
    editor.commands.collapseBlock();
    selectBetween(editor, "A", "B");
    editor.view.dom.dispatchEvent(new Event("cut", { bubbles: true, cancelable: true }));
    expect(show(editor).replace("|", "")).toBe("A\n  A1\nB");
    // aufgeklappt: Backspace löscht die Auswahl
    selectBetween(editor, "A", "B");
    press(editor, "Backspace");
    expect(show(editor)).not.toContain("A1");
  });
});

describe("Umbenannte Aufgabe kommt in den Block zurück (Review Teil B, V-3)", () => {
  it("nur reine Textblöcke werden ersetzt; Blöcke mit Tag oder Verweis bleiben", () => {
    editor = createTestEditor(outline(["Alt", "Mit "]));
    setTaskId(editor, "Alt", "t1");
    cursor(editor, "Mit ");
    type(editor, "#wichtig ");
    // zweiter Block (mit Tag-Knoten): per Position, der Text enthält den Tag nicht
    const second = editor.state.doc.child(1);
    const secondPos = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(secondPos, undefined, { ...second.attrs, taskId: "t2" }),
    );
    const tr = editor.state.tr;
    const written = writeTaskTitles(
      tr,
      new Map([
        ["t1", "Neu aus dem Panel"],
        ["t2", "egal"],
        ["t3", "unbekannt"],
      ]),
    );
    editor.view.dispatch(tr.setMeta("addToHistory", false));
    expect(written).toEqual(["t1"]);
    expect(show(editor).replace("|", "").split("\n")[0]).toBe("Neu aus dem Panel");
    expect(editor.state.doc.child(1).textContent).toContain("Mit ");
    expect(taskIdOf(editor, "Neu aus dem Panel")).toBe("t1");
    // gleicher Titel: nichts zu tun
    expect(writeTaskTitles(editor.state.tr, new Map([["t1", "Neu aus dem Panel"]]))).toEqual([]);
  });
});
