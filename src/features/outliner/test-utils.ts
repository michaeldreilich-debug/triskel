/**
 * Hilfen für Headless-Tests des Outliners (Vitest + jsdom).
 * Kurzschreibweise: "A" = Block mit Text A; ["B", [...Kinder]] ; ["C", [...], { collapsed: true }]
 * Darstellung: eine Zeile je Block, 2 Leerzeichen je Ebene, „▸“ = eingeklappt, „|“ = Cursor.
 */
import { Editor, type JSONContent } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { NoteDirectory, TagDirectory, TaskDirectory } from "./directory";
import { createOutlineExtensions } from "./extensions";
import type { SuggestionRendererFactory } from "./extensions/suggestions";
import { BLOCK } from "./model/names";
import { forEachBlock, paragraphEnd, paragraphOf, paragraphStart } from "./model/tree";

export type SpecAttrs = { collapsed?: boolean; id?: string };
export type Spec = string | SpecTuple;
export interface SpecTuple extends Array<string | Spec[] | SpecAttrs | undefined> {
  0: string;
  1?: Spec[];
  2?: SpecAttrs;
}

export function outline(specs: Spec[]): JSONContent {
  const toBlock = (spec: Spec): JSONContent => {
    const text = typeof spec === "string" ? spec : spec[0];
    const children = typeof spec === "string" ? [] : (spec[1] ?? []);
    const attrs: SpecAttrs = typeof spec === "string" ? {} : (spec[2] ?? {});
    return {
      type: BLOCK,
      attrs: { id: attrs.id ?? `id-${text}`, collapsed: attrs.collapsed ?? false, taskId: null },
      content: [
        text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" },
        ...children.map(toBlock),
      ],
    };
  };
  return { type: "doc", content: specs.map(toBlock) };
}

export function counterIds(prefix = "neu") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export interface TestEditorOptions {
  notes?: NoteDirectory;
  tags?: TagDirectory;
  tasks?: TaskDirectory;
  suggestionRenderer?: SuggestionRendererFactory;
  onOpenNote?: (noteId: string) => void;
  renderMermaid?: (code: string) => Promise<string>;
}

export function createTestEditor(content: JSONContent, options: TestEditorOptions = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({
    element,
    content,
    extensions: createOutlineExtensions({
      generateId: counterIds(),
      notes: options.notes ?? null,
      tags: options.tags ?? null,
      tasks: options.tasks ?? null,
      suggestionRenderer: options.suggestionRenderer ?? null,
      onOpenNote: options.onOpenNote,
      renderMermaid: options.renderMermaid,
    }),
  });
}

/** Baum als Text, mit Cursor-Markierung „|“. */
export function show(editor: Editor): string {
  const { from } = editor.state.selection;
  const lines: string[] = [];
  forEachBlock(editor.state.doc, (ref, depth) => {
    const paragraph = paragraphOf(ref.node);
    let text = "";
    const start = paragraphStart(ref);
    paragraph.forEach((child, offset) => {
      const label = child.isText
        ? (child.text ?? "")
        : child.type.name === "hardBreak"
          ? "⏎"
          : `<${child.type.name}>`;
      const pos = start + offset;
      if (from > pos && from < pos + child.nodeSize && child.isText) {
        text += `${label.slice(0, from - pos)}|${label.slice(from - pos)}`;
      } else {
        text += (from === pos ? "|" : "") + label;
      }
    });
    if (from === paragraphEnd(ref) && !text.endsWith("|")) text += "|";
    const marker = ref.node.attrs.collapsed && ref.node.childCount > 1 ? "▸ " : "";
    lines.push(`${"  ".repeat(depth)}${marker}${text}`);
  });
  return lines.join("\n");
}

export function blockIds(editor: Editor): string[] {
  const ids: string[] = [];
  forEachBlock(editor.state.doc, (ref) => ids.push(ref.node.attrs.id));
  return ids;
}

/** Cursor in den Block mit diesem Text setzen (Ende, Anfang oder Versatz). */
export function cursor(editor: Editor, text: string, at: "start" | "end" | number = "end") {
  let target: number | null = null;
  forEachBlock(editor.state.doc, (ref) => {
    if (target === null && paragraphOf(ref.node).textContent === text) {
      target =
        at === "start"
          ? paragraphStart(ref)
          : at === "end"
            ? paragraphEnd(ref)
            : paragraphStart(ref) + at;
    }
  });
  if (target === null) throw new Error(`Block „${text}“ nicht gefunden`);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)),
  );
}

/** Auswahl vom Anfang von Block a bis zum Ende von Block b. */
export function selectBetween(editor: Editor, a: string, b: string) {
  let from = -1;
  let to = -1;
  forEachBlock(editor.state.doc, (ref) => {
    const text = paragraphOf(ref.node).textContent;
    if (text === a && from === -1) from = paragraphStart(ref);
    if (text === b) to = paragraphEnd(ref);
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
}

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Taste über die Keymaps des Editors auslösen. Rückgabe: wurde sie behandelt? */
export function press(editor: Editor, combo: string): boolean {
  const parts = combo.split("-");
  const key = parts.pop() as string;
  const mods = new Set(parts);
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey: mods.has("Shift"),
    altKey: mods.has("Alt"),
    metaKey: mods.has("Meta") || (mods.has("Mod") && isMac),
    ctrlKey: mods.has("Ctrl") || (mods.has("Mod") && !isMac),
    bubbles: true,
    cancelable: true,
  });
  return Boolean(editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event)));
}

/** Text tippen (löst Eingaberegeln und Autocomplete aus). */
export function type(editor: Editor, text: string) {
  for (const char of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, char, deflt),
    );
    if (!handled) view.dispatch(deflt());
  }
}

/** Einfügen aus der Zwischenablage simulieren. */
export function paste(editor: Editor, data: { text?: string; html?: string }) {
  const event = {
    clipboardData: {
      getData: (kind: string) => (kind === "text/plain" ? (data.text ?? "") : (data.html ?? "")),
    },
    preventDefault() {},
  } as unknown as ClipboardEvent;
  return editor.view.someProp("handlePaste", (handler) => handler(editor.view, event, Slice.empty));
}
