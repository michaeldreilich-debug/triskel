// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { ensureBlockIds } from "./model/ids";
import {
  blockIds,
  counterIds,
  createTestEditor,
  cursor,
  outline,
  press,
  selectBetween,
  show,
} from "./test-utils";

let editor: Editor;
afterEach(() => editor?.destroy());

const tree = (lines: string) =>
  lines
    .replace(/^\n/, "")
    .replace(/\n\s*$/, "")
    .split("\n")
    .map((l) => l.replace(/^ {6}/, ""))
    .join("\n");

describe("Enter / Shift+Enter", () => {
  it("teilt den Block am Cursor; der alte Block behält ID, der neue bekommt eine neue", () => {
    editor = createTestEditor(outline(["Hallo Welt"]));
    cursor(editor, "Hallo Welt", 5);
    expect(press(editor, "Enter")).toBe(true);
    expect(show(editor)).toBe(
      tree(`
      Hallo
      | Welt
    `),
    );
    expect(blockIds(editor)).toEqual(["id-Hallo Welt", "neu-1"]);
  });

  it("am Ende eines aufgeklappten Elternblocks entsteht das erste Kind", () => {
    editor = createTestEditor(outline([["Eltern", ["Kind"]]]));
    cursor(editor, "Eltern");
    press(editor, "Enter");
    expect(show(editor)).toBe(
      tree(`
      Eltern
        |
        Kind
    `),
    );
  });

  it("am Ende eines eingeklappten Blocks entsteht ein Geschwister hinter dem Teilbaum", () => {
    editor = createTestEditor(outline([["Eltern", ["Kind"], { collapsed: true }], "Danach"]));
    cursor(editor, "Eltern");
    press(editor, "Enter");
    expect(show(editor)).toBe(
      tree(`
      ▸ Eltern
        Kind
      |
      Danach
    `),
    );
  });

  it("am Anfang eines Blocks entsteht ein leerer Block davor, der Cursor bleibt", () => {
    editor = createTestEditor(outline(["Text"]));
    cursor(editor, "Text", "start");
    press(editor, "Enter");
    expect(show(editor)).toBe(
      tree(`
      
      |Text
    `),
    );
    expect(blockIds(editor)).toEqual(["neu-1", "id-Text"]);
  });

  it("leerer eingerückter Block: Enter rückt aus", () => {
    editor = createTestEditor(outline([["A", ["", "B"]]]));
    cursor(editor, "");
    press(editor, "Enter");
    expect(show(editor)).toBe(
      tree(`
      A
        B
      |
    `),
    );
  });

  it("Shift+Enter fügt einen Zeilenumbruch im Block ein", () => {
    editor = createTestEditor(outline(["Zeile"]));
    cursor(editor, "Zeile");
    press(editor, "Shift-Enter");
    expect(show(editor)).toBe("Zeile⏎|");
  });
});

describe("Tab / Shift+Tab", () => {
  it("Tab macht den Block (mit Kindern) zum letzten Kind des vorherigen Geschwisters", () => {
    editor = createTestEditor(
      outline([
        ["A", ["A1"]],
        ["B", ["B1"]],
      ]),
    );
    cursor(editor, "B", 1);
    expect(press(editor, "Tab")).toBe(true);
    expect(show(editor)).toBe(
      tree(`
      A
        A1
        B|
          B1
    `),
    );
  });

  it("Tab ohne vorheriges Geschwister ändert nichts, bleibt aber im Editor", () => {
    editor = createTestEditor(outline(["A"]));
    cursor(editor, "A");
    expect(press(editor, "Tab")).toBe(true);
    expect(show(editor)).toBe("A|");
  });

  it("Tab klappt ein eingeklapptes Ziel auf", () => {
    editor = createTestEditor(outline([["A", ["A1"], { collapsed: true }], "B"]));
    cursor(editor, "B");
    press(editor, "Tab");
    expect(show(editor)).toBe(
      tree(`
      A
        A1
        B|
    `),
    );
  });

  it("Shift+Tab setzt den Block hinter den Elternblock; folgende Geschwister bleiben", () => {
    editor = createTestEditor(outline([["A", ["A1", "A2", "A3"]], "B"]));
    cursor(editor, "A2");
    expect(press(editor, "Shift-Tab")).toBe(true);
    expect(show(editor)).toBe(
      tree(`
      A
        A1
        A3
      A2|
      B
    `),
    );
  });

  it("Shift+Tab auf oberster Ebene ändert nichts", () => {
    editor = createTestEditor(outline(["A"]));
    cursor(editor, "A");
    expect(press(editor, "Shift-Tab")).toBe(true);
    expect(show(editor)).toBe("A|");
  });

  it("mehrere markierte Geschwister werden gemeinsam ein- und ausgerückt", () => {
    editor = createTestEditor(outline(["A", "B", "C", "D"]));
    selectBetween(editor, "B", "C");
    press(editor, "Tab");
    expect(show(editor).replace("|", "")).toBe(
      tree(`
      A
        B
        C
      D
    `),
    );
    press(editor, "Shift-Tab");
    expect(show(editor).replace("|", "")).toBe("A\nB\nC\nD");
  });
});

describe("Verschieben ⌥⇧↑/↓", () => {
  it("verschiebt den Block samt Kindern unter den Geschwistern", () => {
    editor = createTestEditor(outline(["A", ["B", ["B1"]], "C"]));
    cursor(editor, "B");
    expect(press(editor, "Alt-Shift-ArrowUp")).toBe(true);
    expect(show(editor)).toBe(
      tree(`
      B|
        B1
      A
      C
    `),
    );
    press(editor, "Alt-Shift-ArrowDown");
    press(editor, "Alt-Shift-ArrowDown");
    expect(show(editor)).toBe(
      tree(`
      A
      C
      B|
        B1
    `),
    );
  });

  it("an der Grenze passiert nichts", () => {
    editor = createTestEditor(outline(["A", "B"]));
    cursor(editor, "A");
    expect(press(editor, "Alt-Shift-ArrowUp")).toBe(true);
    expect(show(editor)).toBe("A|\nB");
  });
});

describe("Ein-/Ausklappen ⌘↑/⌘↓", () => {
  it("klappt ein und aus; nicht Teil der Rückgängig-Historie", () => {
    editor = createTestEditor(outline([["A", ["A1"]]]));
    cursor(editor, "A");
    expect(press(editor, "Mod-ArrowUp")).toBe(true);
    expect(show(editor)).toBe("▸ A|\n  A1");
    editor.commands.undo();
    expect(show(editor)).toBe("▸ A|\n  A1");
    press(editor, "Mod-ArrowDown");
    expect(show(editor)).toBe("A|\n  A1");
  });

  it("in einem Block ohne Kinder klappt ⌘↑ den Elternblock ein und setzt den Cursor dorthin", () => {
    editor = createTestEditor(outline([["A", ["A1"]]]));
    cursor(editor, "A1", "start");
    press(editor, "Mod-ArrowUp");
    expect(show(editor)).toBe("▸ A|\n  A1");
  });

  it("Pfeiltaste nach rechts am Ende überspringt eingeklappte Kinder", () => {
    editor = createTestEditor(outline([["A", ["A1"], { collapsed: true }], "B"]));
    cursor(editor, "A");
    expect(press(editor, "ArrowRight")).toBe(true);
    expect(show(editor)).toBe("▸ A\n  A1\n|B");
  });

  it("Pfeiltaste nach links am Anfang überspringt eingeklappte Kinder des Vorgängers", () => {
    editor = createTestEditor(outline([["A", ["A1"], { collapsed: true }], "B"]));
    cursor(editor, "B", "start");
    expect(press(editor, "ArrowLeft")).toBe(true);
    expect(show(editor)).toBe("▸ A|\n  A1\nB");
  });

  it("ohne verborgene Nachbarn entscheidet der Browser (Taste nicht behandelt)", () => {
    editor = createTestEditor(outline(["A", "B"]));
    cursor(editor, "A");
    expect(press(editor, "ArrowRight")).toBe(false);
  });
});

describe("Rücktaste am Blockanfang / Entf am Ende", () => {
  it("führt mit dem vorherigen Block zusammen; Kinder wandern mit", () => {
    editor = createTestEditor(outline(["Hallo", ["Welt", ["Kind"]]]));
    cursor(editor, "Welt", "start");
    expect(press(editor, "Backspace")).toBe(true);
    expect(show(editor)).toBe(
      tree(`
      Hallo|Welt
        Kind
    `),
    );
    expect(blockIds(editor)).toEqual(["id-Hallo", "id-Kind"]);
  });

  it("führt mit dem letzten sichtbaren Nachfahren des Vorgängers zusammen", () => {
    editor = createTestEditor(outline([["A", ["A1", ["A2", ["A2x"], { collapsed: true }]]], "B"]));
    cursor(editor, "B", "start");
    press(editor, "Backspace");
    expect(show(editor)).toBe(
      tree(`
      A
        A1
        ▸ A2|B
          A2x
    `),
    );
  });

  it("löscht einen leeren Block ohne Kinder", () => {
    editor = createTestEditor(outline(["A", ""]));
    cursor(editor, "", "start");
    press(editor, "Backspace");
    expect(show(editor)).toBe("A|");
  });

  it("am ersten Kind rückt die Rücktaste aus", () => {
    editor = createTestEditor(outline([["A", ["A1", "A2"]]]));
    cursor(editor, "A1", "start");
    press(editor, "Backspace");
    expect(show(editor)).toBe(
      tree(`
      A
        A2
      |A1
    `),
    );
  });

  it("im Text verhält sich die Rücktaste normal", () => {
    editor = createTestEditor(outline(["Abc"]));
    cursor(editor, "Abc");
    expect(press(editor, "Backspace")).toBe(false);
  });

  it("Entf am Ende holt den nächsten Block heran (auch das erste Kind)", () => {
    editor = createTestEditor(outline([["A", [["B", ["B1"]]]], "C"]));
    cursor(editor, "A");
    expect(press(editor, "Delete")).toBe(true);
    expect(show(editor)).toBe(
      tree(`
      A|B
        B1
      C
    `),
    );
    cursor(editor, "B1");
    press(editor, "Delete");
    expect(show(editor)).toBe(
      tree(`
      AB
        B1|C
    `),
    );
  });
});

describe("Rückgängig / Wiederholen", () => {
  it("⌘Z und ⌘⇧Z stellen Text und Struktur wieder her", () => {
    editor = createTestEditor(outline(["A", "B"]));
    cursor(editor, "B");
    press(editor, "Tab");
    expect(show(editor)).toBe("A\n  B|");
    expect(press(editor, "Mod-z")).toBe(true);
    expect(show(editor)).toBe("A\nB|");
    expect(press(editor, "Mod-Shift-z")).toBe(true);
    expect(show(editor)).toBe("A\n  B|");
  });
});

describe("Block-IDs", () => {
  const withDuplicates = () => {
    const doc = outline(["A", "B", "C"]);
    const blocks = doc.content ?? [];
    (blocks[1] as { attrs: { id: string | null } }).attrs.id = "id-A";
    (blocks[2] as { attrs: { id: string | null } }).attrs.id = null;
    return doc;
  };

  it("ensureBlockIds normalisiert Inhalt vor dem Laden", () => {
    const ids = counterIds("x");
    const doc = ensureBlockIds(withDuplicates(), ids);
    expect(doc.content?.map((b) => b.attrs?.id)).toEqual(["id-A", "x-1", "x-2"]);
  });

  it("der Editor vergibt fehlende und doppelte IDs nach dem Erzeugen und bei setContent", async () => {
    editor = createTestEditor(withDuplicates());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(blockIds(editor)).toEqual(["id-A", "neu-1", "neu-2"]);
    editor.commands.setContent(withDuplicates());
    const ids = blockIds(editor);
    expect(ids[0]).toBe("id-A");
    expect(new Set(ids).size).toBe(3);
  });

  it("IDs bleiben nach vielen Bearbeitungen eindeutig", () => {
    editor = createTestEditor(outline(["A"]));
    cursor(editor, "A");
    for (let i = 0; i < 5; i++) press(editor, "Enter");
    press(editor, "Tab");
    press(editor, "Tab");
    const ids = blockIds(editor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });
});
