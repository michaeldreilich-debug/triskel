// @vitest-environment jsdom
import type { Editor, JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalNoteDirectory, createLocalTagDirectory } from "./directory";
import {
  type AnyItem,
  noteItems,
  type OutlineSuggestionProps,
  tagItems,
} from "./extensions/suggestions";
import {
  blockIds,
  counterIds,
  createTestEditor,
  cursor,
  outline,
  paste,
  press,
  show,
  type,
} from "./test-utils";

let editor: Editor;
// Das Autocomplete lädt seine Einträge asynchron
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => {
  editor?.destroy();
  document.body.innerHTML = "";
});

const notes = () =>
  createLocalNoteDirectory(
    [
      { id: "n-wartung", title: "Wartungsplan PA" },
      { id: "n-protokoll", title: "Besprechung Werkstatt 09/26" },
    ],
    { generateId: counterIds("note") },
  );

describe("Einfügen", () => {
  it("mehrzeiliger Text und Markdown-Listen werden zu Blöcken mit eindeutigen IDs", () => {
    editor = createTestEditor(outline(["Start", ""]));
    cursor(editor, "");
    const handled = paste(editor, {
      text: "- Erster\n  - Unterpunkt **fett**\n- Zweiter\n\n- Dritter",
    });
    expect(handled).toBe(true);
    expect(show(editor)).toBe(
      ["Start", "Erster", "  Unterpunkt fett", "Zweiter", "Dritter|"].join("\n"),
    );
    const ids = blockIds(editor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("hinter einem nicht leeren Block landen die Blöcke als Geschwister", () => {
    editor = createTestEditor(outline(["Start"]));
    cursor(editor, "Start");
    paste(editor, { text: "eins\nzwei" });
    expect(show(editor)).toBe("Start\neins\nzwei|");
  });

  it("einzeilige Texte und Kopien aus dem Outliner fügt ProseMirror selbst ein", () => {
    editor = createTestEditor(outline(["Start"]));
    cursor(editor, "Start");
    expect(paste(editor, { text: "nur eine Zeile" })).toBeFalsy();
    expect(
      paste(editor, { text: "a\nb", html: '<div data-pm-slice="1 1 []">…</div>' }),
    ).toBeFalsy();
  });

  it("eingefügte Blöcke tragen die Marke „pasted“ – ob Kopie oder Verschieben entscheidet das ID-Plugin (V-9)", () => {
    editor = createTestEditor(outline(["A"]));
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    const transformed = editor.view.someProp("transformPasted", (fn) =>
      (fn as (s: typeof slice) => typeof slice)(slice),
    );
    transformed?.content.forEach((node) => {
      expect(node.attrs.pasted).toBe(true);
      expect(node.attrs.id).toBe("id-A");
    });
  });

  it("Kopieren liefert eine Markdown-Liste", () => {
    editor = createTestEditor(outline([["A", ["B"]], "C"]));
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    const text = editor.view.someProp("clipboardTextSerializer", (fn) =>
      (fn as (s: typeof slice) => string)(slice),
    );
    expect(text).toBe("- A\n  - B\n- C");
  });
});

describe("Tags", () => {
  it("„#name“ + Leerzeichen wird zum Tag-Knoten", () => {
    editor = createTestEditor(outline([""]));
    cursor(editor, "");
    type(editor, "Prüfen #prüfung ");
    expect(show(editor)).toBe("Prüfen <tag> |");
    expect((editor.getJSON() as JSONContent).content?.[0]?.content?.[0]?.content?.[1]).toEqual({
      type: "tag",
      attrs: { name: "prüfung" },
    });
  });

  it("Tag-Vorschläge: vorhandene zuerst, sonst neu anlegen", () => {
    const tags = createLocalTagDirectory(["prüfung", "pa", "wartung"]);
    expect(tagItems(tags, "p")).toEqual([
      { kind: "tag", name: "pa", isNew: false },
      { kind: "tag", name: "prüfung", isNew: false },
      { kind: "tag", name: "p", isNew: true },
    ]);
    expect(tagItems(tags, "pa")).toEqual([{ kind: "tag", name: "pa", isNew: false }]);
    expect(tagItems(tags, "a b")).toEqual([]);
  });
});

describe("[[Links]]", () => {
  it("Vorschläge: passende Notizen, sonst „Neue Notiz anlegen“", () => {
    const dir = notes();
    expect(noteItems(dir, "wart")).toEqual([
      { kind: "note", id: "n-wartung", title: "Wartungsplan PA" },
      { kind: "create", title: "wart" },
    ]);
    expect(noteItems(dir, "Wartungsplan PA")).toEqual([
      { kind: "note", id: "n-wartung", title: "Wartungsplan PA" },
    ]);
    expect(noteItems(dir, "Neue Idee]]").at(-1)).toEqual({ kind: "create", title: "Neue Idee" });
    expect(noteItems(dir, "Neue Idee))").at(-1)).toEqual({ kind: "create", title: "Neue Idee" });
  });

  it("(( funktioniert wie [[ (deutsche Tastatur ohne ⌥), ein getipptes „))“ verschwindet", async () => {
    const dir = notes();
    let props: OutlineSuggestionProps | null = null;
    const renderer = () => ({
      onStart: (p: OutlineSuggestionProps) => {
        props = p;
      },
      onUpdate: (p: OutlineSuggestionProps) => {
        props = p;
      },
      onExit: () => {
        props = null;
      },
    });
    editor = createTestEditor(outline([""]), { notes: dir, suggestionRenderer: renderer });
    cursor(editor, "");
    type(editor, "Siehe ((Wartungsplan PA))");
    await tick();
    const current = props as OutlineSuggestionProps | null;
    expect(current?.query).toBe("Wartungsplan PA))");
    current?.command(current.items[0] as AnyItem);
    const paragraph = (editor.getJSON() as JSONContent).content?.[0]?.content?.[0];
    expect(paragraph?.content).toEqual([
      { type: "text", text: "Siehe " },
      { type: "noteLink", attrs: { noteId: "n-wartung" } },
      { type: "text", text: " " },
    ]);
  });

  it("[[ öffnet das Autocomplete; Auswahl fügt einen Link mit Notiz-ID ein", async () => {
    const dir = notes();
    let props: OutlineSuggestionProps | null = null;
    const renderer = () => ({
      onStart: (p: OutlineSuggestionProps) => {
        props = p;
      },
      onUpdate: (p: OutlineSuggestionProps) => {
        props = p;
      },
      onExit: () => {
        props = null;
      },
    });
    editor = createTestEditor(outline([""]), { notes: dir, suggestionRenderer: renderer });
    cursor(editor, "");
    type(editor, "Siehe [[Wart");
    await tick();
    const current = props as OutlineSuggestionProps | null;
    expect(current?.query).toBe("Wart");
    expect(current?.items[0]).toEqual({ kind: "note", id: "n-wartung", title: "Wartungsplan PA" });
    current?.command(current.items[0] as AnyItem);
    const paragraph = (editor.getJSON() as JSONContent).content?.[0]?.content?.[0];
    expect(paragraph?.content?.[1]).toEqual({ type: "noteLink", attrs: { noteId: "n-wartung" } });
    // Node-View zeigt den aktuellen Titel und folgt einer Umbenennung
    const link = editor.view.dom.querySelector(".ol-note-link") as HTMLElement;
    expect(link.textContent).toBe("Wartungsplan PA");
    dir.rename("n-wartung", "Wartungsplan Pressluftatmer");
    expect(link.textContent).toBe("Wartungsplan Pressluftatmer");
  });

  it("„Neue Notiz anlegen“ legt die Notiz an und verlinkt sie", async () => {
    const dir = notes();
    let props: OutlineSuggestionProps | null = null;
    const renderer = () => ({
      onStart: (p: OutlineSuggestionProps) => {
        props = p;
      },
      onUpdate: (p: OutlineSuggestionProps) => {
        props = p;
      },
    });
    editor = createTestEditor(outline([""]), { notes: dir, suggestionRenderer: renderer });
    cursor(editor, "");
    type(editor, "[[Neue Idee");
    await tick();
    const current = props as OutlineSuggestionProps | null;
    const create = current?.items.at(-1) as AnyItem;
    expect(create).toEqual({ kind: "create", title: "Neue Idee" });
    current?.command(create);
    expect(dir.findByTitle("Neue Idee")).toBe("note-1");
    expect((editor.getJSON() as JSONContent).content?.[0]?.content?.[0]?.content?.[0]).toEqual({
      type: "noteLink",
      attrs: { noteId: "note-1" },
    });
  });
});

describe("Node-View", () => {
  it("zeigt Pfeil nur bei Kindern; Klick klappt ein und Kinder bleiben im Dokument", () => {
    editor = createTestEditor(outline([["A", ["A1"]], "B"]));
    const blocks = editor.view.dom.querySelectorAll<HTMLElement>(".ol-block");
    const [a, , b] = [...blocks];
    const toggle = a?.querySelector<HTMLButtonElement>(".ol-toggle");
    expect(toggle?.hidden).toBe(false);
    expect(b?.querySelector<HTMLButtonElement>(".ol-toggle")?.hidden).toBe(true);
    expect(toggle?.getAttribute("aria-label")).toBe("Einklappen");

    toggle?.click();
    expect(a?.dataset.collapsed).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("Ausklappen");
    expect(a?.querySelector<HTMLElement>(".ol-body")?.dataset.hiddenLabel).toBe("1 eingeklappt");
    expect(show(editor).replace("|", "")).toBe("▸ A\n  A1\nB");
  });

  it("Einklappen per Klick holt den Cursor aus den verborgenen Kindern", () => {
    editor = createTestEditor(outline([["A", ["A1"]]]));
    cursor(editor, "A1");
    editor.view.dom.querySelector<HTMLButtonElement>(".ol-toggle")?.click();
    expect(show(editor)).toBe("▸ A|\n  A1");
    press(editor, "Mod-ArrowDown");
    expect(show(editor)).toBe("A|\n  A1");
  });
});
