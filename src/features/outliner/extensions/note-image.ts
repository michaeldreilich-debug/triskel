import { type Editor, mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { cursorAfterSelectedMedia } from "../model/commands";
import { clampWidth, stepWidth } from "../model/crop";
import { NOTE_IMAGE } from "../model/names";
import { type InsertAt, insertUploads, mediaDropPositions, updateNodeAttrs } from "./media-utils";

/** Speicher für Bilder einer Notiz (in der App: Supabase Storage, siehe notes/images.ts). */
export interface OutlineImages {
  /**
   * Datei verarbeiten und hochladen; liefert den Pfad, sobald er feststeht. `cancelled` fragt
   * nach dem Aufbereiten, ob der Editor noch da ist – dann null, ohne hochzuladen (O-3).
   */
  add(
    file: File,
    options?: { cancelled?: () => boolean },
  ): Promise<{ path: string; uploaded: Promise<void> } | null>;
  url(path: string): Promise<string>;
  accepts(file: File): boolean;
  onError(message: string): void;
  /** Zuschnitt wählen und als neue Datei hochladen (#28); liefert den neuen Pfad */
  crop?(path: string, alt: string): Promise<string | null>;
  /**
   * Großansicht im Fenster (#59): alle Bilder des Dokuments, beginnend bei `start`. Liefert
   * `{ edit }`, wenn am Handy „Bearbeiten“ gewählt wurde (Bild dann auswählen).
   */
  view?(
    items: Array<{ path: string; alt: string }>,
    start: number,
    options: { editable: boolean },
  ): Promise<{ edit: number } | null>;
}

/** Bilder des Dokuments in Reihenfolge (für das Blättern in der Großansicht). */
function imagesOf(editor: Editor): Array<{ path: string; alt: string; pos: number }> {
  const found: Array<{ path: string; alt: string; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === NOTE_IMAGE && node.attrs.path) {
      found.push({ path: node.attrs.path as string, alt: (node.attrs.alt as string) ?? "", pos });
    }
  });
  return found;
}

export interface NoteImageOptions {
  images: OutlineImages | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteImage: {
      /** Bilder an der Auswahl einfügen (verkleinern, hochladen, Vorschau sofort) */
      insertImages: (files: File[]) => ReturnType;
    };
  }
}

const altOf = (file: File) => file.name.replace(/\.[^.]+$/, "").slice(0, 120);

/** Bilder an der Auswahl bzw. Ablagestelle einfügen (verkleinern, hochladen, Vorschau sofort). */
export function insertImageFiles(
  view: EditorView,
  images: OutlineImages,
  files: File[],
  at?: InsertAt,
) {
  return insertUploads(
    view,
    {
      type: NOTE_IMAGE,
      onError: (message) => images.onError(message),
      reject: (file) =>
        images.accepts(file) ? null : `„${file.name}“ ist kein Bild (PNG, JPEG, WebP, GIF, HEIC).`,
      add: (file, cancelled) => images.add(file, { cancelled }),
      attrs: (file, path) => ({ path, alt: altOf(file) }),
      failed: "Bild konnte nicht eingefügt werden.",
    },
    files,
    at,
  );
}

/** Bild-Speicher des Editors (Option von NoteImage), z. B. für Einfügen/Ziehen in NoteFile. */
export function imageStoreOf(editor: Editor): OutlineImages | null {
  const extension = editor.extensionManager.extensions.find((e) => e.name === NOTE_IMAGE);
  return (extension?.options as NoteImageOptions | undefined)?.images ?? null;
}

/**
 * Bild als atomarer Knoten im Absatz eines Blocks: Pfad im privaten Bucket, Alternativtext.
 * Einfügen per Einfügen (⌘V) oder Ziehen (das übernimmt NoteFile für Bilder und Dateien); die
 * Ansicht lädt das Bild über die eigene Sitzung.
 */
export const NoteImage = Node.create<NoteImageOptions>({
  name: NOTE_IMAGE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  // vor dem Outline-Einfügen (Priorität 1000), das mehrzeiligen Text in Blöcke zerlegt
  priority: 1050,

  addOptions() {
    return { images: null };
  },

  addAttributes() {
    return {
      path: { default: null },
      alt: { default: "" },
      /** Breite in Prozent der Zeile (#28); leer = natürliche Größe bis zur vollen Breite */
      width: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="note-image"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes({ "data-type": "note-image", "data-path": node.attrs.path }, HTMLAttributes),
      `[Bild${node.attrs.alt ? `: ${node.attrs.alt}` : ""}]`,
    ];
  },

  renderText({ node }) {
    return `[Bild${node.attrs.alt ? `: ${node.attrs.alt}` : ""}]`;
  },

  addProseMirrorPlugins() {
    return [
      mediaDropPositions,
      // Ausgewähltes Bild, Datei oder Diagramm (O-1): Enter, Tippen und Einfügen gehen dahinter
      new Plugin({
        key: new PluginKey("mediaSelectionGuard"),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Enter" || event.isComposing) return false;
            const tr = view.state.tr;
            if (cursorAfterSelectedMedia(tr)) view.dispatch(tr);
            return false;
          },
          handleTextInput(view, _from, _to, text) {
            const tr = view.state.tr;
            if (!cursorAfterSelectedMedia(tr)) return false;
            view.dispatch(tr.insertText(text));
            return true;
          },
          handlePaste(view) {
            const tr = view.state.tr;
            if (cursorAfterSelectedMedia(tr)) view.dispatch(tr);
            return false;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertImages:
        (files) =>
        ({ view }) => {
          const { images } = this.options;
          if (!images || files.length === 0) return false;
          void insertImageFiles(view, images, files);
          return true;
        },
    };
  },

  addNodeView() {
    const { images } = this.options;
    return ({ node: initialNode, getPos, editor }) => {
      let node: PMNode = initialNode;
      const dom = document.createElement("span");
      dom.className = "ol-media ol-image";
      dom.dataset.type = "note-image";
      dom.contentEditable = "false";
      const img = document.createElement("img");
      img.decoding = "async";
      const status = document.createElement("span");
      status.className = "ol-media-status";
      dom.append(img, status);

      // Bild bleibt ausgewählt: Werkzeuge und Griff bleiben am Handy sichtbar
      const setAttrs = (attrs: Record<string, unknown>) =>
        updateNodeAttrs(editor.view, getPos, NOTE_IMAGE, attrs, { select: true });

      // Werkzeuge (#28): kleiner, größer, zuschneiden; Ziehen an der Ecke ändert die Breite
      const tools = document.createElement("span");
      tools.className = "ol-image-tools";
      const tool = (text: string, label: string, onClick: () => void) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ol-image-tool";
        button.textContent = text;
        button.setAttribute("aria-label", label);
        button.title = label;
        button.addEventListener("click", onClick);
        tools.append(button);
        return button;
      };
      const handle = document.createElement("span");
      handle.className = "ol-image-handle";
      handle.setAttribute("aria-hidden", "true");
      if (images) {
        tool("−", "Bild kleiner", () => setAttrs({ width: stepWidth(node.attrs.width, -1) }));
        tool("+", "Bild größer", () => {
          const next = stepWidth(node.attrs.width, 1);
          setAttrs({ width: next >= 100 ? null : next });
        });
        if (images.view) {
          tool("⤢", "Bild vergrößern", () => openViewer());
        }
        if (images.crop) {
          const crop = images.crop;
          tool("Zuschneiden", "Bild zuschneiden", () => {
            const path = node.attrs.path as string | null;
            if (!path) return;
            crop(path, node.attrs.alt ?? "")
              .then((next) => {
                if (next) setAttrs({ path: next });
              })
              .catch(() => images.onError("Bild konnte nicht zugeschnitten werden."));
          });
        }
        dom.append(tools, handle);
      }

      const select = (pos: number | undefined) => {
        if (typeof pos === "number" && editor.isEditable) editor.commands.setNodeSelection(pos);
      };
      // Großansicht (#59); am Handy wählt „Bearbeiten“ das zuletzt gezeigte Bild aus
      function openViewer() {
        if (!images?.view || !node.attrs.path) return;
        const all = imagesOf(editor);
        const pos = typeof getPos === "function" ? getPos() : undefined;
        const start = Math.max(
          0,
          all.findIndex((item) => item.pos === pos),
        );
        const path = node.attrs.path as string;
        void images.view(all, start, { editable: editor.isEditable }).then((result) => {
          if (editor.isDestroyed || !editor.isEditable) return;
          // „Bearbeiten“: das zuletzt gezeigte Bild, sonst das angeklickte – ausgewählt und mit
          // Fokus (Return schreibt darunter weiter). Am Handy ohne „Bearbeiten“ kein Fokus, sonst
          // klappte die Tastatur auf.
          const picked = result ? all[result.edit] : undefined;
          if (!picked && window.matchMedia("(pointer: coarse)").matches) return;
          const target = imagesOf(editor).find((item) => item.path === (picked?.path ?? path));
          if (target) editor.chain().focus().setNodeSelection(target.pos).run();
        });
      }
      if (images?.view) dom.classList.add("has-viewer");
      // Klick aufs Bild öffnet die Großansicht (#59); ohne sie wählt Antippen das Bild aus (am Handy
      // setzte der Tipp sonst nur den Cursor daneben, und die Werkzeuge blieben verborgen)
      img.addEventListener("click", () => {
        if (images?.view && dom.dataset.path) return openViewer();
        select(typeof getPos === "function" ? getPos() : undefined);
      });

      let resizing: { x: number; start: number; line: number; preview: number } | null = null;
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const line = dom.parentElement?.clientWidth || dom.clientWidth;
        const start = dom.getBoundingClientRect().width;
        resizing = { x: event.clientX, start, line, preview: (start / line) * 100 };
        handle.setPointerCapture(event.pointerId);
        dom.classList.add("is-resizing");
      });
      handle.addEventListener("pointermove", (event) => {
        if (!resizing) return;
        resizing.preview = clampWidth(
          ((resizing.start + event.clientX - resizing.x) / resizing.line) * 100,
        );
        dom.style.width = `${resizing.preview}%`;
      });
      const stopResize = (commit: boolean) => {
        if (!resizing) return;
        const { preview } = resizing;
        resizing = null;
        dom.classList.remove("is-resizing");
        if (commit) setAttrs({ width: preview >= 100 ? null : preview });
        else applyWidth();
      };
      handle.addEventListener("pointerup", () => stopResize(true));
      handle.addEventListener("pointercancel", () => stopResize(false));

      const applyWidth = () => {
        const width = node.attrs.width as number | null;
        dom.style.width = width ? `${width}%` : "";
        dom.classList.toggle("is-sized", Boolean(width));
      };

      let shown: string | null = null;
      const render = () => {
        img.alt = node.attrs.alt || "Bild";
        dom.dataset.path = node.attrs.path ?? "";
        applyWidth();
        if (shown === node.attrs.path) return;
        shown = node.attrs.path;
        dom.classList.remove("is-missing");
        status.textContent = "Bild wird geladen …";
        img.removeAttribute("src");
        if (!images || !node.attrs.path) {
          dom.classList.add("is-missing");
          status.textContent = "Bild nicht verfügbar";
          return;
        }
        const path = node.attrs.path as string;
        images
          .url(path)
          .then((url) => {
            if (shown !== path) return;
            img.src = url;
            status.textContent = "";
          })
          .catch(() => {
            if (shown !== path) return;
            dom.classList.add("is-missing");
            status.textContent = "Bild nicht gefunden";
          });
      };
      render();
      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          render();
          return true;
        },
        selectNode: () => dom.classList.add("is-selected"),
        deselectNode: () => dom.classList.remove("is-selected"),
        // Knöpfe und Ziehen an der Ecke gehören dem Bild, nicht dem Editor
        stopEvent: (event) =>
          event.target instanceof Element &&
          (event.target.closest("button") !== null || event.target === handle),
        ignoreMutation: () => true,
      };
    };
  },
});
