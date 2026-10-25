// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalNoteDirectory } from "./directory";
import { createTestEditor, cursor, outline, press, show, type } from "./test-utils";

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  document.body.innerHTML = "";
});

const kinds = (e: Editor) => {
  const found: Array<string | null> = [];
  e.state.doc.descendants((node) => {
    if (node.type.name === "paragraph") found.push(node.attrs.kind ?? null);
  });
  return found;
};

describe("Outliner-Tastatur (G11)", () => {
  it("Rücktaste am Anfang einer Überschrift: erst wieder normaler Text, kein Zusammenführen (O-2)", () => {
    editor = createTestEditor(outline(["A", "B"]));
    cursor(editor, "B", "start");
    type(editor, "## ");
    expect(kinds(editor)).toEqual([null, "h2"]);
    cursor(editor, "B", "start");
    expect(press(editor, "Backspace")).toBe(true);
    expect(kinds(editor)).toEqual([null, null]);
    expect(show(editor)).toContain("B");
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("… auch im ersten Block der Notiz (O-2)", () => {
    editor = createTestEditor(outline(["A"]));
    cursor(editor, "A", "start");
    type(editor, "# ");
    expect(kinds(editor)).toEqual(["h1"]);
    cursor(editor, "A", "start");
    press(editor, "Backspace");
    expect(kinds(editor)).toEqual([null]);
  });

  it("Escape verlässt den Editor zum nächsten Bedienelement (O-6)", () => {
    editor = createTestEditor(outline(["A"]));
    const after = document.createElement("button");
    after.textContent = "danach";
    document.body.append(after);
    editor.view.focus();
    expect(press(editor, "Escape")).toBe(true);
    expect(document.activeElement).toBe(after);
  });

  it("⌘Enter öffnet einen ausgewählten oder angrenzenden Notiz-Link (O-10)", () => {
    const notes = createLocalNoteDirectory([{ id: "n1", title: "Wartung" }]);
    const onOpenNote = vi.fn();
    editor = createTestEditor(
      {
        type: "doc",
        content: [
          {
            type: "block",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Siehe " },
                  { type: "noteLink", attrs: { noteId: "n1" } },
                ],
              },
            ],
          },
        ],
      },
      { notes, onOpenNote },
    );
    // Cursor direkt hinter dem Link
    editor.commands.focus("end");
    expect(press(editor, "Mod-Enter")).toBe(true);
    expect(onOpenNote).toHaveBeenCalledWith("n1");
    // ausgewählt
    let linkPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "noteLink") linkPos = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, linkPos)),
    );
    press(editor, "Mod-Enter");
    expect(onOpenNote).toHaveBeenCalledTimes(2);
  });

  it("Einfügen über das Menü gliedert mehrzeiligen Text wie ⌘V (O-5)", () => {
    editor = createTestEditor(outline(["X"]));
    cursor(editor, "X");
    expect(editor.commands.pasteOutlineText("- A\n  - B\n- C")).toBe(true);
    expect(show(editor)).not.toContain("- A");
    const texts: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph") texts.push(node.textContent);
    });
    expect(texts).toEqual(["X", "A", "B", "C"]);
    // einzeilig: nichts zu gliedern
    expect(editor.commands.pasteOutlineText("nur eine Zeile")).toBe(false);
  });
});
