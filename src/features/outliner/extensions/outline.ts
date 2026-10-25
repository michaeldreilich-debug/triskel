import {
  type Editor,
  Extension,
  getTextBetween,
  getTextSerializersFromSchema,
  type JSONContent,
} from "@tiptap/core";
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { newId } from "@/lib/id";
import type { NoteDirectory } from "../directory";
import * as cmd from "../model/commands";
import { expandCollapsedInSelection } from "../model/guard";
import { BLOCK } from "../model/names";
import { parseOutlineText } from "../model/paste";
import { outlineToMarkdown } from "../model/serializer";
import {
  blockAt,
  isHidden,
  nextVisibleBlock,
  paragraphEnd,
  paragraphStart,
  prevVisibleBlock,
} from "../model/tree";

export interface OutlineOptions {
  /** ID-Erzeuger für neue Blöcke (Standard: newId, UUID v4) */
  generateId: () => string;
  notes: NoteDirectory | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    outline: {
      splitOutlineBlock: () => ReturnType;
      indentBlock: () => ReturnType;
      outdentBlock: () => ReturnType;
      moveBlockUp: () => ReturnType;
      moveBlockDown: () => ReturnType;
      collapseBlock: () => ReturnType;
      expandBlock: () => ReturnType;
      toggleBlockCollapsed: (pos: number) => ReturnType;
      joinBlockBackward: () => ReturnType;
      joinBlockForward: () => ReturnType;
      insertOutlineBlocks: (blocks: JSONContent[]) => ReturnType;
      /** Mehrzeiligen Text wie beim Einfügen gliedern (Rechtsklick › Einfügen, O-5) */
      pasteOutlineText: (text: string) => ReturnType;
      /** Eingeklappte Blöcke in der Auswahl aufklappen statt löschen (V-11); false = keine */
      expandCollapsedSelection: () => ReturnType;
    };
  }
}

export const BLOCK_ID_PLUGIN = new PluginKey("outlineBlockId");

/**
 * Mehrzeiligen Klartext (Markdown-Liste, eingerückte Zeilen) als Gliederung einfügen – für ⌘V
 * und für Rechtsklick › Einfügen (dort gibt es kein clipboardData, O-5). false = einzeilig
 * bzw. nichts zu gliedern: dann fügt ProseMirror normal ein.
 */
export function insertOutlineText(
  tr: Transaction,
  text: string,
  notes: { findByTitle(title: string): string | undefined } | null,
): boolean {
  if (!text || !/\n/.test(text.trim())) return false;
  const blocks = parseOutlineText(text, {
    resolveNoteByTitle: (title) => notes?.findByTitle(title),
  });
  if (blocks.length === 0) return false;
  const schema = tr.doc.type.schema;
  if (
    !cmd.insertBlocks(
      tr,
      blocks.map((b) => schema.nodeFromJSON(b)),
    )
  )
    return false;
  tr.scrollIntoView();
  return true;
}

/**
 * Jeder Block bekommt eine eindeutige ID; fehlende oder doppelte werden neu vergeben. Eben
 * eingefügte Blöcke (`pasted`, V-9): Steht ihre ID sonst nirgends im Dokument, war es ein
 * Verschieben (Ausschneiden/Einfügen, Ziehen) – ID und Aufgaben-Verknüpfung bleiben; gibt es sie
 * noch einmal, war es eine Kopie – neue ID, keine Aufgabe (sonst hingen zwei Blöcke an einer).
 */
export function assignBlockIds(tr: Transaction, generateId: () => string): boolean {
  const count = new Map<string, number>();
  tr.doc.descendants((node) => {
    if (node.type.name !== BLOCK) return true;
    const id = node.attrs.id;
    if (typeof id === "string" && id.length > 0) count.set(id, (count.get(id) ?? 0) + 1);
    return true;
  });
  const seen = new Set<string>();
  let changed = false;
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== BLOCK) return true;
    const id = node.attrs.id;
    const valid = typeof id === "string" && id.length > 0;
    const pasted = node.attrs.pasted === true;
    const duplicate = valid && ((pasted && (count.get(id) ?? 0) > 1) || seen.has(id));
    if (!valid || duplicate) {
      const fresh = generateId();
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        id: fresh,
        pasted: false,
        // Kopie: keine zweite Bindung an dieselbe Aufgabe
        ...(pasted ? { taskId: null } : {}),
      });
      seen.add(fresh);
      changed = true;
    } else {
      seen.add(id);
      if (pasted) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, pasted: false });
        changed = true;
      }
    }
    return true;
  });
  return changed;
}

/** Eingefügte Blöcke markieren – das BlockId-Plugin entscheidet dann zwischen Kopie und Verschieben (V-9). */
function markPasted(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === BLOCK) {
      nodes.push(
        node.type.create({ ...node.attrs, pasted: true }, markPasted(node.content), node.marks),
      );
    } else if (node.content.size > 0) {
      nodes.push(node.copy(markPasted(node.content)));
    } else {
      nodes.push(node);
    }
  });
  return Fragment.fromArray(nodes);
}

function hasBlocks(fragment: Fragment): boolean {
  let found = false;
  fragment.forEach((node) => {
    if (node.type.name === BLOCK) found = true;
  });
  return found;
}

/**
 * Pfeiltasten überspringen eingeklappte Kinder: Läge der nächste Absatz in Leserichtung in
 * einem verborgenen Teilbaum, springt der Cursor zum nächsten sichtbaren Block.
 */
function skipHidden(editor: Editor, direction: "up" | "down" | "left" | "right"): boolean {
  const { state } = editor;
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  const ref = blockAt($from);
  if (!ref) return false;
  const forward = direction === "down" || direction === "right";

  let atBoundary: boolean;
  if (direction === "left") atBoundary = $from.parentOffset === 0;
  else if (direction === "right") atBoundary = $from.parentOffset === $from.parent.content.size;
  else {
    try {
      atBoundary = editor.view.endOfTextblock(direction);
    } catch {
      return false; // ohne Layout (headless) entscheidet der Browser
    }
  }
  if (!atBoundary) return false;

  const neighbour = Selection.findFrom(
    state.doc.resolve(forward ? $from.after() : $from.before()),
    forward ? 1 : -1,
    true,
  );
  const neighbourBlock = neighbour ? blockAt(neighbour.$from) : null;
  if (!neighbourBlock || !isHidden(state.doc, neighbourBlock)) return false;

  const target = forward ? nextVisibleBlock(state.doc, ref) : prevVisibleBlock(state.doc, ref);
  if (!target) return true;
  const pos = forward ? paragraphStart(target) : paragraphEnd(target);
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView(),
  );
  return true;
}

/** Outline-Befehle, Tastenkürzel, ID-Vergabe, Einfügen und Kopieren. */
export const Outline = Extension.create<OutlineOptions>({
  name: "outline",
  priority: 1000,

  addOptions() {
    return { generateId: newId, notes: null };
  },

  addCommands() {
    return {
      splitOutlineBlock:
        () =>
        ({ tr }) =>
          cmd.split(tr),
      indentBlock:
        () =>
        ({ tr }) =>
          cmd.indent(tr),
      outdentBlock:
        () =>
        ({ tr }) =>
          cmd.outdent(tr),
      moveBlockUp:
        () =>
        ({ tr }) =>
          cmd.move(tr, "up"),
      moveBlockDown:
        () =>
        ({ tr }) =>
          cmd.move(tr, "down"),
      collapseBlock:
        () =>
        ({ tr }) =>
          cmd.collapse(tr),
      expandBlock:
        () =>
        ({ tr }) =>
          cmd.expand(tr),
      toggleBlockCollapsed:
        (pos) =>
        ({ tr }) =>
          cmd.toggleCollapsedAt(tr, pos),
      joinBlockBackward:
        () =>
        ({ tr }) =>
          cmd.joinBackward(tr),
      joinBlockForward:
        () =>
        ({ tr }) =>
          cmd.joinForward(tr),
      pasteOutlineText:
        (text) =>
        ({ tr }) =>
          insertOutlineText(tr, text, this.options.notes),
      insertOutlineBlocks:
        (blocks) =>
        ({ tr, state }) =>
          cmd.insertBlocks(
            tr,
            blocks.map((b) => state.schema.nodeFromJSON(b)),
          ),
      expandCollapsedSelection:
        () =>
        ({ tr }) =>
          expandCollapsedInSelection(tr),
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitOutlineBlock(),
      Tab: () => this.editor.commands.indentBlock(),
      "Shift-Tab": () => this.editor.commands.outdentBlock(),
      // Auswahl über einen eingeklappten Block: erst aufklappen, dann löschen (V-11)
      Backspace: () =>
        this.editor.commands.expandCollapsedSelection() || this.editor.commands.joinBlockBackward(),
      Delete: () =>
        this.editor.commands.expandCollapsedSelection() || this.editor.commands.joinBlockForward(),
      "Alt-Shift-ArrowUp": () => this.editor.commands.moveBlockUp(),
      "Alt-Shift-ArrowDown": () => this.editor.commands.moveBlockDown(),
      "Mod-ArrowUp": () => this.editor.commands.collapseBlock(),
      "Mod-ArrowDown": () => this.editor.commands.expandBlock(),
      ArrowDown: () => skipHidden(this.editor, "down"),
      ArrowUp: () => skipHidden(this.editor, "up"),
      ArrowRight: () => skipHidden(this.editor, "right"),
      ArrowLeft: () => skipHidden(this.editor, "left"),
    };
  },

  onCreate() {
    const tr = this.editor.state.tr;
    if (assignBlockIds(tr, this.options.generateId)) {
      this.editor.view.dispatch(tr.setMeta("addToHistory", false));
    }
  },

  addProseMirrorPlugins() {
    const { generateId, notes } = this.options;
    const editor = this.editor;
    const textSerializers = getTextSerializersFromSchema(editor.schema);
    const resolveTitle = (id: string) => notes?.titleOf(id);

    return [
      new Plugin({
        key: BLOCK_ID_PLUGIN,
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = newState.tr;
          return assignBlockIds(tr, generateId) ? tr : null;
        },
        props: {
          transformPasted: (slice) =>
            new Slice(markPasted(slice.content), slice.openStart, slice.openEnd),

          // Ausschneiden über einen eingeklappten Block hinweg: erst aufklappen (V-11)
          handleDOMEvents: {
            cut(view) {
              const tr = view.state.tr;
              if (!expandCollapsedInSelection(tr)) return false;
              view.dispatch(tr);
              return true;
            },
          },

          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data) return false;
            // Kopie aus einem Outliner: ProseMirror fügt die Struktur selbst ein (IDs werden neu vergeben)
            if (data.getData("text/html").includes("data-pm-slice")) return false;
            const tr = view.state.tr;
            if (!insertOutlineText(tr, data.getData("text/plain"), notes)) return false;
            view.dispatch(tr);
            return true;
          },

          clipboardTextSerializer(slice) {
            if (hasBlocks(slice.content)) {
              const json = slice.content.toJSON() as JSONContent[];
              return outlineToMarkdown(json, { resolveTitle });
            }
            return getTextBetween(
              slice.content as unknown as PMNode,
              { from: 0, to: slice.content.size },
              { textSerializers },
            );
          },
        },
      }),
    ];
  },
});
