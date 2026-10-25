// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeHref, selectionAsNoteTitle } from "./model/format";
import { paragraphStart } from "./model/tree";
import { createTestEditor, outline, selectBetween } from "./test-utils";

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  document.body.innerHTML = "";
});

/** Auswahl über die Zeichen [start, end) im ersten Block. */
function selectInFirst(start: number, end: number) {
  const base = paragraphStart({ node: editor.state.doc.child(0), pos: 0 });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, base + start, base + end)),
  );
}

describe("normalizeHref", () => {
  it("ergänzt https:// nur ohne Schema", () => {
    expect(normalizeHref("example.com/pfad")).toBe("https://example.com/pfad");
    expect(normalizeHref("  www.beispiel.de ")).toBe("https://www.beispiel.de");
    expect(normalizeHref("https://example.com")).toBe("https://example.com");
    expect(normalizeHref("mailto:team@example.com")).toBe("mailto:team@example.com");
    expect(normalizeHref("   ")).toBe("");
  });
});

describe("Formatierung", () => {
  it("Fett und Link wirken auf die Auswahl; javascript:-Links werden abgelehnt", () => {
    editor = createTestEditor(outline(["Prüffristen beachten"]));
    selectInFirst(0, 11);
    editor.chain().toggleMark("bold").run();
    expect(editor.isActive("bold")).toBe(true);

    expect(
      editor
        .chain()
        .setLink({ href: normalizeHref("javascript:alert(1)") })
        .run(),
    ).toBe(false);
    expect(editor.isActive("link")).toBe(false);
    expect(
      editor
        .chain()
        .setLink({ href: normalizeHref("example.com") })
        .run(),
    ).toBe(true);
    expect(editor.getAttributes("link").href).toBe("https://example.com");
  });
});

describe("selectionAsNoteTitle", () => {
  it("liefert den markierten Text eines Blocks (Leerraum zusammengefasst)", () => {
    editor = createTestEditor(outline(["Siehe Wartungsplan  PA morgen"]));
    selectInFirst(6, 22);
    expect(selectionAsNoteTitle(editor.state)).toBe("Wartungsplan PA");
  });

  it("nichts bei leerer Auswahl, über mehrere Blöcke oder mit Tag in der Auswahl", () => {
    editor = createTestEditor(outline(["Erster", "Zweiter"]));
    selectInFirst(2, 2);
    expect(selectionAsNoteTitle(editor.state)).toBeNull();
    selectBetween(editor, "Erster", "Zweiter");
    expect(selectionAsNoteTitle(editor.state)).toBeNull();

    editor.destroy();
    editor = createTestEditor({
      type: "doc",
      content: [
        {
          type: "block",
          attrs: { id: "b1", collapsed: false, taskId: null },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Prüfen " },
                { type: "tag", attrs: { name: "pa" } },
                { type: "text", text: " heute" },
              ],
            },
          ],
        },
      ],
    });
    selectInFirst(0, 12);
    expect(selectionAsNoteTitle(editor.state)).toBeNull();
  });
});
