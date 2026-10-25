// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Fremder Stand im Editor (D-7) ohne Eintrag in der Rückgängig-Liste (Review Teil B, V-7): Der
 * Aufgaben-Editor übernimmt neue Inhalte über `chain().setMeta("addToHistory", false).setContent`.
 * Hier das Muster an einem schlanken Editor: so übernommen → ⌘Z hat nichts zurückzunehmen.
 */
let editor: Editor;
afterEach(() => editor?.destroy());

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("Übernommener Stand ohne Rückgängig-Eintrag (V-7)", () => {
  it("setContent mit addToHistory: false lässt sich nicht per ⌘Z zurückdrehen", () => {
    editor = new Editor({ extensions: [StarterKit], content: doc("eigener Text") });
    editor
      .chain()
      .setMeta("addToHistory", false)
      .setContent(doc("von der KI"), { emitUpdate: false })
      .run();
    expect(editor.getText()).toBe("von der KI");
    expect(editor.can().undo()).toBe(false);
    // zum Vergleich: ein gewöhnliches setContent landet in der Liste
    editor.commands.setContent(doc("noch einmal"), { emitUpdate: false });
    expect(editor.can().undo()).toBe(true);
  });
});
