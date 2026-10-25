// @vitest-environment jsdom
/**
 * Medien-Atome im Editor (Code-Review Oktober 2026, G5): ausgewähltes Bild bleibt bei Enter und
 * Einfügen erhalten (O-1), Einfügen nach dem Aufbereiten in einen geschlossenen Editor meldet sich
 * und die Ablagestelle wandert mit (O-3), „ans Ende“ heißt ans Ende des letzten sichtbaren Blocks
 * (O-4).
 */
import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateNodeAttrs } from "./extensions/media-utils";
import { insertImageFiles, type OutlineImages } from "./extensions/note-image";
import { BLOCK, NOTE_IMAGE } from "./model/names";
import { createTestEditor, cursor, outline, press, show, type } from "./test-utils";

let editor: Editor;
afterEach(() => {
  if (!editor?.isDestroyed) editor?.destroy();
  document.body.innerHTML = "";
});

/** Block „A“ mit Bild dahinter, darunter „B“ */
const withImage: JSONContent = {
  type: "doc",
  content: [
    {
      type: BLOCK,
      attrs: { id: "id-A", collapsed: false, taskId: null },
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A" },
            { type: NOTE_IMAGE, attrs: { path: "u/n/alt.png", alt: "alt" } },
          ],
        },
      ],
    },
    ...(outline(["B"]).content ?? []),
  ],
};

function selectImage(e: Editor) {
  let at = -1;
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === NOTE_IMAGE && at === -1) at = pos;
  });
  e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, at)));
}

const paths = (e: Editor) => {
  const found: string[] = [];
  e.state.doc.descendants((node) => {
    if (node.type.name === NOTE_IMAGE) found.push(node.attrs.path as string);
  });
  return found;
};

function imageStore(add?: OutlineImages["add"]) {
  const errors: string[] = [];
  const store: OutlineImages = {
    accepts: () => true,
    add: add ?? (async (file) => ({ path: `u/n/${file.name}`, uploaded: Promise.resolve() })),
    url: async () => "",
    onError: (message) => errors.push(message),
  };
  return { store, errors };
}

const png = (name: string) => new File(["x"], name, { type: "image/png" });

describe("ausgewähltes Bild (O-1)", () => {
  it("Enter löscht es nicht, sondern legt dahinter einen neuen Punkt an", () => {
    editor = createTestEditor(withImage);
    selectImage(editor);
    expect(press(editor, "Enter")).toBe(true);
    expect(paths(editor)).toEqual(["u/n/alt.png"]);
    expect(show(editor)).toBe("A<noteImage>\n|\nB");
  });

  it("Tippen ersetzt es nicht, der Text kommt dahinter", () => {
    editor = createTestEditor(withImage);
    selectImage(editor);
    type(editor, "x");
    expect(paths(editor)).toEqual(["u/n/alt.png"]);
    expect(show(editor)).toBe("A<noteImage>x|\nB");
  });

  it("Einfügen eines neuen Bilds ersetzt es nicht, das neue kommt dahinter", async () => {
    editor = createTestEditor(withImage);
    selectImage(editor);
    await insertImageFiles(editor.view, imageStore().store, [png("neu.png")]);
    expect(paths(editor)).toEqual(["u/n/alt.png", "u/n/neu.png"]);
  });
});

describe("Editor währenddessen geschlossen, Text verschoben (O-3)", () => {
  it("geschlossen vor dem Hochladen: nichts hochladen, Meldung", async () => {
    editor = createTestEditor(outline(["A"]));
    const add = vi.fn(async (file: File) => ({
      path: `u/n/${file.name}`,
      uploaded: Promise.resolve(),
    }));
    const { store, errors } = imageStore(add);
    const { view } = editor;
    editor.destroy();
    await insertImageFiles(view, store, [png("spaet.png")]);
    expect(add).not.toHaveBeenCalled();
    expect(errors).toEqual([
      "„spaet.png“ wurde nicht eingefügt – die Notiz war schon geschlossen.",
    ]);
  });

  it("geschlossen während des Aufbereitens: Meldung statt stillem Verlust", async () => {
    editor = createTestEditor(outline(["A"]));
    let finish!: () => void;
    const { store, errors } = imageStore(async (file) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { path: `u/n/${file.name}`, uploaded: Promise.resolve() };
    });
    cursor(editor, "A");
    const done = insertImageFiles(editor.view, store, [png("heic.png")]);
    editor.destroy();
    finish();
    await done;
    expect(errors).toEqual(["„heic.png“ wurde nicht eingefügt – die Notiz war schon geschlossen."]);
  });

  it("die Ablagestelle wandert mit, wenn währenddessen davor getippt wird", async () => {
    editor = createTestEditor(outline(["A", "Bild hier:"]));
    let finish!: () => void;
    const { store } = imageStore(async (file) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { path: `u/n/${file.name}`, uploaded: Promise.resolve() };
    });
    let dropAt = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "Bild hier:") dropAt = pos + node.nodeSize;
    });
    const done = insertImageFiles(editor.view, store, [png("foto.png")], dropAt);
    // während des Aufbereitens im ersten Punkt weitertippen
    cursor(editor, "A");
    type(editor, "bc");
    finish();
    await done;
    expect(show(editor)).toBe("Abc\nBild hier:<noteImage>|");
  });
});

describe("„ans Ende“ (O-4)", () => {
  it("bei eingeklapptem letzten Punkt ans Ende des sichtbaren Punkts, nicht in die Kinder", async () => {
    editor = createTestEditor(outline(["A", ["B", ["B1", "B2"], { collapsed: true }]]));
    await insertImageFiles(editor.view, imageStore().store, [png("neu.png")], "end");
    expect(show(editor)).toBe("A\n▸ B<noteImage>|\n  B1\n  B2");
  });

  it("aufgeklappt: ans Ende des letzten Kinds", async () => {
    editor = createTestEditor(outline(["A", ["B", ["B1", "B2"]]]));
    await insertImageFiles(editor.view, imageStore().store, [png("neu.png")], "end");
    expect(show(editor)).toBe("A\nB\n  B1\n  B2<noteImage>|");
  });
});

describe("gemeinsame Medien-Hilfen (O-19)", () => {
  it("Hochladen scheitert später ohne Antwort: Bild bleibt, Meldung nennt den nächsten Versuch (V-1)", async () => {
    editor = createTestEditor(outline(["A"]));
    let fail: (error: Error) => void = () => {};
    const uploaded = new Promise<void>((_, reject) => {
      fail = reject;
    });
    const { store, errors } = imageStore(async (file) => ({ path: `u/n/${file.name}`, uploaded }));
    await insertImageFiles(editor.view, store, [png("bleibt.png")]);
    expect(paths(editor)).toEqual(["u/n/bleibt.png"]);
    fail(new Error("offline"));
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(paths(editor)).toEqual(["u/n/bleibt.png"]);
    expect(errors[0]).toBe(
      "„bleibt.png“ kam nicht beim Speicher an – die Verbindung brach unterwegs ab (Netzwerk, Firmen-Proxy oder Sicherheitssoftware?). Die Datei bleibt in der Notiz und wird hochgeladen, sobald die Verbindung wieder da ist.",
    );
  });

  it("Speicher lehnt endgültig ab (zu groß): Bild verschwindet wieder, Meldung", async () => {
    editor = createTestEditor(outline(["A"]));
    let fail: (error: Error) => void = () => {};
    const uploaded = new Promise<void>((_, reject) => {
      fail = reject;
    });
    const { store, errors } = imageStore(async (file) => ({ path: `u/n/${file.name}`, uploaded }));
    await insertImageFiles(editor.view, store, [png("weg.png")]);
    fail(Object.assign(new Error("zu groß"), { status: 413 }));
    await vi.waitFor(() => expect(paths(editor)).toEqual([]));
    expect(errors).toEqual([
      "„weg.png“ konnte nicht hochgeladen werden – der Speicher lehnte ab (413: zu groß).",
    ]);
  });

  it("kein Bild: Meldung, nichts hochgeladen", async () => {
    editor = createTestEditor(outline(["A"]));
    const add = vi.fn();
    const { store, errors } = imageStore(add);
    store.accepts = () => false;
    await insertImageFiles(editor.view, store, [new File(["x"], "text.txt")]);
    expect(add).not.toHaveBeenCalled();
    expect(errors).toEqual(["„text.txt“ ist kein Bild (PNG, JPEG, WebP, GIF, HEIC)."]);
  });

  it("Attribute nur setzen, wenn an der Stelle noch der Knoten steht; auf Wunsch ausgewählt", () => {
    editor = createTestEditor(withImage);
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === NOTE_IMAGE) at = pos;
    });
    expect(
      updateNodeAttrs(editor.view, () => at, NOTE_IMAGE, { width: 40 }, { select: true }),
    ).toBe(true);
    expect(editor.state.doc.nodeAt(at)?.attrs).toMatchObject({ path: "u/n/alt.png", width: 40 });
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    // an Position 0 steht ein Block, kein Bild → nichts ändern
    expect(updateNodeAttrs(editor.view, () => 0, NOTE_IMAGE, { width: 10 })).toBe(false);
    expect(updateNodeAttrs(editor.view, () => undefined, NOTE_IMAGE, { width: 10 })).toBe(false);
    expect(editor.state.doc.nodeAt(at)?.attrs.width).toBe(40);
  });
});
