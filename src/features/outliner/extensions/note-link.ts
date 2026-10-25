import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, NodeSelection } from "@tiptap/pm/state";
import type { NoteDirectory } from "../directory";
import { NOTE_LINK } from "../model/names";

export interface NoteLinkOptions {
  notes: NoteDirectory | null;
  onOpenNote?: (noteId: string) => void;
}

/**
 * Notiz-Link an einer Stelle: ausgewählt (NodeSelection) oder direkt neben dem Cursor bzw. der
 * Position `pos` (Rechtsklick). Für ⌘Enter und „Notiz öffnen“ im Menü (O-10).
 */
export function noteLinkAt(state: EditorState, pos?: number): string | null {
  const { selection } = state;
  if (pos === undefined && selection instanceof NodeSelection) {
    return selection.node.type.name === NOTE_LINK ? (selection.node.attrs.noteId ?? null) : null;
  }
  if (pos === undefined && !selection.empty) return null;
  const $pos = state.doc.resolve(pos ?? selection.from);
  for (const node of [$pos.nodeAfter, $pos.nodeBefore]) {
    if (node?.type.name === NOTE_LINK) return node.attrs.noteId ?? null;
  }
  return null;
}

/**
 * [[Link]] als atomarer Inline-Knoten mit Notiz-ID (E7). Der Titel wird beim Anzeigen
 * aufgelöst – Umbenennen bricht nichts.
 */
export const NoteLink = Node.create<NoteLinkOptions>({
  name: NOTE_LINK,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { notes: null, onOpenNote: undefined };
  },

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-note-id"),
        renderHTML: (attrs) => ({ "data-note-id": attrs.noteId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="note-link"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = this.options.notes?.titleOf(node.attrs.noteId) ?? "";
    return [
      "span",
      mergeAttributes({ "data-type": "note-link", class: "ol-note-link" }, HTMLAttributes),
      `[[${title}]]`,
    ];
  },

  renderText({ node }) {
    return `[[${this.options.notes?.titleOf(node.attrs.noteId) ?? ""}]]`;
  },

  addKeyboardShortcuts() {
    return {
      // per Tastatur öffnen (O-10): Link ausgewählt oder Cursor direkt daneben
      "Mod-Enter": () => {
        const noteId = noteLinkAt(this.editor.state);
        if (!noteId || !this.options.onOpenNote) return false;
        this.options.onOpenNote(noteId);
        return true;
      },
    };
  },

  addNodeView() {
    const { notes, onOpenNote } = this.options;
    return ({ node: initialNode }) => {
      let node: PMNode = initialNode;
      const dom = document.createElement("span");
      dom.className = "ol-note-link";
      dom.dataset.type = "note-link";
      dom.setAttribute("role", "link");
      const render = () => {
        const title = notes?.titleOf(node.attrs.noteId);
        dom.dataset.noteId = node.attrs.noteId ?? "";
        dom.textContent = title === undefined ? "Unbekannte Notiz" : title.trim() || "Ohne Titel";
        dom.classList.toggle("is-missing", title === undefined);
      };
      render();
      const unsubscribe = notes?.subscribe(render);
      dom.addEventListener("click", () => {
        if (node.attrs.noteId) onOpenNote?.(node.attrs.noteId);
      });
      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          render();
          return true;
        },
        ignoreMutation: () => true,
        destroy: () => unsubscribe?.(),
      };
    };
  },
});
