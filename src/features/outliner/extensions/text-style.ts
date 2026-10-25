import { Extension, InputRule, Mark, markInputRule, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { createBlock } from "../model/commands";
import { BLOCK, PARAGRAPH } from "../model/names";
import {
  type BlockKind,
  MARKER,
  type MarkerColor,
  parseBlockKind,
  parseMarkerColor,
  parseTextColor,
  TEXT_COLOR,
  type TextColor,
} from "../model/text-style";

/**
 * Mehr Formatierung (Rückmeldung #40): Absatzarten (Überschrift 1–3, Zitat, Hinweis-Kasten,
 * Trennlinie) als Attribut `kind` am Absatz, dazu Textfarbe und Marker als Markierungen.
 * Gemeinsam für Outliner, Aufgaben-Notiz und Projekt-Freitext.
 *
 * Tippen wie in Notion: „# “, „## “, „### “ am Zeilenanfang = Überschrift, „> “ = Zitat,
 * „---“ = Trennlinie, „==Text==“ = Marker. Rücktaste am Anfang macht wieder normalen Text.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockKinds: {
      /** Absatzart der markierten Absätze setzen (null = normaler Text) */
      setBlockKind: (kind: Exclude<BlockKind, "divider"> | null) => ReturnType;
      /** wie setBlockKind, aber gleiche Art schaltet zurück auf Text */
      toggleBlockKind: (kind: Exclude<BlockKind, "divider">) => ReturnType;
      /** Trennlinie: leerer Absatz wird zur Linie, sonst kommt sie hinter den Absatz */
      insertDivider: () => ReturnType;
    };
    textColor: {
      setTextColor: (color: TextColor) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    marker: {
      setMarker: (color: MarkerColor) => ReturnType;
      toggleMarker: (color?: MarkerColor) => ReturnType;
      unsetMarker: () => ReturnType;
    };
  }
}

const DIVIDER_KEY = new PluginKey("dividerGuard");

/** Leeren Absatz hinter dem Absatz bei `pos` einfügen (im Outliner als neuer Block) und Cursor hinein. */
function insertParagraphAfter(tr: Transaction, paragraphPos: number) {
  const $pos = tr.doc.resolve(paragraphPos + 1);
  const schema = tr.doc.type.schema;
  const paragraph = schema.nodes[PARAGRAPH] as NonNullable<(typeof schema.nodes)[string]>;
  const depth = $pos.depth;
  const parent = depth > 1 ? $pos.node(depth - 1) : null;
  if (parent?.type.name === BLOCK) {
    const insertAt = $pos.after(depth - 1);
    tr.insert(insertAt, createBlock(schema));
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 2));
  } else {
    const insertAt = $pos.after(depth);
    tr.insert(insertAt, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
  }
}

/** Absatz bei `pos` zur Trennlinie machen (Text fällt weg) und darunter weiterschreiben. */
function makeDivider(tr: Transaction, pos: number, node: PMNode) {
  if (node.content.size > 0) tr.delete(pos + 1, pos + 1 + node.content.size);
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, kind: "divider" });
  insertParagraphAfter(tr, pos);
}

/** Absätze in der Auswahl (bei leerer Auswahl der Absatz am Cursor). */
function selectedParagraphs(doc: PMNode, from: number, to: number) {
  const found: Array<{ node: PMNode; pos: number }> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === PARAGRAPH) {
      found.push({ node, pos });
      return false;
    }
    return true;
  });
  return found;
}

export const BlockKinds = Extension.create({
  name: "blockKinds",
  // vor Outline (1000): Rücktaste am Anfang einer Überschrift entfernt erst die Art (O-2) –
  // höhere Priorität läuft in TipTap zuerst; Vorschläge (1100) und Medien (1050) bleiben davor
  priority: 1010,

  addGlobalAttributes() {
    return [
      {
        types: [PARAGRAPH],
        attributes: {
          kind: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => parseBlockKind(el.getAttribute("data-kind")),
            renderHTML: (attrs) => (attrs.kind ? { "data-kind": attrs.kind } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBlockKind:
        (kind) =>
        ({ tr, state, dispatch }) => {
          const paragraphs = selectedParagraphs(
            state.doc,
            state.selection.from,
            state.selection.to,
          );
          if (paragraphs.length === 0) return false;
          if (dispatch) {
            for (const { node, pos } of paragraphs) {
              if ((node.attrs.kind ?? null) !== kind)
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, kind });
            }
          }
          return true;
        },
      toggleBlockKind:
        (kind) =>
        ({ state, commands }) => {
          const paragraphs = selectedParagraphs(
            state.doc,
            state.selection.from,
            state.selection.to,
          );
          const all = paragraphs.length > 0 && paragraphs.every((p) => p.node.attrs.kind === kind);
          return commands.setBlockKind(all ? null : kind);
        },
      insertDivider:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from } = state.selection;
          if ($from.parent.type.name !== PARAGRAPH) return false;
          if (!dispatch) return true;
          const pos = $from.before();
          if ($from.parent.content.size === 0) {
            makeDivider(tr, pos, $from.parent);
            return true;
          }
          // hinter den Absatz (im Outliner: hinter den Block) eine Linie, Cursor bleibt
          const keep = state.selection.from;
          insertParagraphAfter(tr, pos);
          const linePos = tr.selection.$from.before();
          tr.setNodeMarkup(linePos, undefined, {
            ...(tr.doc.nodeAt(linePos)?.attrs ?? {}),
            kind: "divider",
          });
          tr.setSelection(TextSelection.create(tr.doc, keep));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-0": () => this.editor.commands.setBlockKind(null),
      "Mod-Alt-1": () => this.editor.commands.toggleBlockKind("h1"),
      "Mod-Alt-2": () => this.editor.commands.toggleBlockKind("h2"),
      "Mod-Alt-3": () => this.editor.commands.toggleBlockKind("h3"),
      // Rücktaste am Anfang einer Überschrift/eines Zitats: zuerst wieder normaler Text
      Backspace: () => {
        const { selection } = this.editor.state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parent.type.name !== PARAGRAPH || $from.parentOffset !== 0) return false;
        if (!$from.parent.attrs.kind) return false;
        return this.editor.commands.command(({ tr }) => {
          tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, kind: null });
          return true;
        });
      },
    };
  },

  addInputRules() {
    const kindRule = (find: RegExp, kindOf: (match: RegExpMatchArray) => BlockKind) =>
      new InputRule({
        find,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== PARAGRAPH) return null;
          const { tr } = state;
          tr.delete(range.from, range.to);
          tr.setNodeMarkup($from.before(), undefined, {
            ...$from.parent.attrs,
            kind: kindOf(match),
          });
        },
      });
    return [
      kindRule(/^(#{1,3})\s$/, (match) => `h${(match[1] as string).length}` as BlockKind),
      kindRule(/^>\s$/, () => "quote"),
      new InputRule({
        find: /^(?:---|\*\*\*|___)$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== PARAGRAPH) return null;
          // nur, wenn sonst nichts im Absatz steht (im Absatz steht „--“, das dritte Zeichen
          // kommt gerade) – Text hinter dem Cursor ginge sonst verloren
          if ($from.parent.content.size !== range.to - range.from) return null;
          const { tr } = state;
          tr.delete(range.from, range.to);
          makeDivider(tr, $from.before(), tr.doc.nodeAt($from.before()) as PMNode);
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      // Text in einer Trennlinie (z. B. hineingeklickt und getippt): wieder normaler Absatz
      new Plugin({
        key: DIVIDER_KEY,
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const { $from } = state.selection;
          const paragraph = $from.parent;
          if (
            paragraph.type.name !== PARAGRAPH ||
            paragraph.attrs.kind !== "divider" ||
            paragraph.content.size === 0
          )
            return null;
          return state.tr.setNodeMarkup($from.before(), undefined, {
            ...paragraph.attrs,
            kind: null,
          });
        },
      }),
    ];
  },
});

export const TextColorMark = Mark.create({
  name: TEXT_COLOR,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => parseTextColor(el.getAttribute("data-color")),
        renderHTML: (attrs) => (attrs.color ? { "data-color": attrs.color } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-color]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "tx-color" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const MarkerMark = Mark.create({
  name: MARKER,

  addAttributes() {
    return {
      color: {
        default: "gelb",
        parseHTML: (el) => parseMarkerColor(el.getAttribute("data-marker")) ?? "gelb",
        renderHTML: (attrs) => ({ "data-marker": attrs.color ?? "gelb" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes({ class: "tx-marker" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setMarker:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      toggleMarker:
        (color = "gelb") =>
        ({ commands }) =>
          commands.toggleMark(this.name, { color }),
      unsetMarker:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMarker() };
  },

  addInputRules() {
    // „==Text==“ wie in Obsidian
    return [
      markInputRule({
        find: /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))$/,
        type: this.type,
        getAttributes: () => ({ color: "gelb" }),
      }),
    ];
  },
});

/** Alle Erweiterungen für mehr Formatierung (#40). */
export const textStyleExtensions = () => [BlockKinds, TextColorMark, MarkerMark];
