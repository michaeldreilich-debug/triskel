import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { NOTE_FILE } from "../model/names";
import { type InsertAt, insertUploads, updateNodeAttrs } from "./media-utils";
import { imageStoreOf, insertImageFiles, type OutlineImages } from "./note-image";

export interface FileAttrs {
  path: string;
  name: string;
  size: number;
  mime: string;
}

/** Speicher für Dateien einer Notiz oder Aufgabe (in der App: notes/attachments.ts). */
export interface OutlineFiles {
  /** prüfen und hochladen; liefert den Pfad, sobald er feststeht (Fehlertext als Exception) */
  add(file: File): Promise<{ path: string; uploaded: Promise<void> }>;
  /** läuft das Hochladen noch? */
  uploading(path: string): Promise<void> | undefined;
  /** PDF im neuen Tab öffnen */
  open(file: FileAttrs): void;
  download(file: FileAttrs): void;
  /** PDF im Fenster in Seitenhöhe zeichnen (#36); liefert die Aufräum-Funktion */
  mountPdf(
    container: HTMLElement,
    path: string,
    status: (text: string) => void,
    onPage?: (page: number, total: number) => void,
  ): () => void;
  /** Zeile unter dem Namen, z. B. „PDF · 2,4 MB“ */
  describe(file: FileAttrs): string;
  isPdf(file: Pick<FileAttrs, "mime" | "name">): boolean;
  onError(message: string): void;
}

export interface NoteFileOptions {
  files: OutlineFiles | null;
}

export type FileView = "tile" | "full";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteFile: {
      /** Bilder und Dateien einfügen (Bilder als Bild, alles andere als Datei) */
      insertMedia: (files: File[], at?: "end") => ReturnType;
    };
  }
}

function insertAttachmentFiles(view: EditorView, files: OutlineFiles, list: File[], at?: InsertAt) {
  return insertUploads(
    view,
    {
      type: NOTE_FILE,
      onError: (message) => files.onError(message),
      add: (file) => files.add(file),
      attrs: (file, path) => ({
        path,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        view: "tile",
      }),
      failed: "Datei konnte nicht eingefügt werden.",
    },
    list,
    at,
  );
}

/** Bilder an den Bild-Knoten, alles andere als Datei; ohne Dateispeicher bleibt es beim Bild. */
function routeFiles(
  view: EditorView,
  images: OutlineImages | null,
  files: OutlineFiles | null,
  list: File[],
  at?: InsertAt,
): boolean {
  if (list.length === 0 || (!images && !files)) return false;
  const pictures = images ? list.filter((f) => images.accepts(f)) : [];
  const others = list.filter((f) => !pictures.includes(f));
  void (async () => {
    if (images && pictures.length) await insertImageFiles(view, images, pictures, at);
    if (others.length) {
      // Bilder stehen schon an der Ablagestelle, die Dateien folgen dahinter
      const next = pictures.length ? undefined : at;
      if (files) await insertAttachmentFiles(view, files, others, next);
      else if (images) await insertImageFiles(view, images, others, next);
    }
  })();
  return true;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Datei-Symbol (lucide „file-text“), ohne React im NodeView. */
function fileIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ol-file-icon");
  for (const d of [
    "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M16 13H8",
    "M16 17H8",
    "M10 9H8",
  ]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const button = (label: string, className = "ol-media-button") => {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = label;
  return el;
};

/**
 * Datei als atomarer Knoten im Absatz (Rückmeldung #27): Kachel mit Name, Art und Größe.
 * PDFs wahlweise als Kachel oder komplett angezeigt (Attribut `view`, je Datei gespeichert);
 * Öffnen zeigt ein PDF im neuen Tab, andere Dateien werden heruntergeladen.
 * Übernimmt auch Einfügen (⌘V) und Ziehen von Bildern (an NoteImage) und Dateien.
 */
export const NoteFile = Node.create<NoteFileOptions>({
  name: NOTE_FILE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  // vor dem Outline-Einfügen (Priorität 1000), das mehrzeiligen Text in Blöcke zerlegt
  priority: 1050,

  addOptions() {
    return { files: null };
  },

  addAttributes() {
    return {
      path: { default: null },
      name: { default: "Datei" },
      size: { default: 0 },
      mime: { default: "application/octet-stream" },
      view: { default: "tile" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="note-file"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes({ "data-type": "note-file", "data-path": node.attrs.path }, HTMLAttributes),
      `[Datei: ${node.attrs.name}]`,
    ];
  },

  renderText({ node }) {
    return `[Datei: ${node.attrs.name}]`;
  },

  addCommands() {
    return {
      insertMedia:
        (list, at) =>
        ({ view, editor }) =>
          routeFiles(view, imageStoreOf(editor), this.options.files, list, at),
    };
  },

  addNodeView() {
    const { files } = this.options;
    return ({ node: initialNode, getPos, editor }) => {
      let node: PMNode = initialNode;
      let unmount: (() => void) | null = null;
      let mountedPath: string | null = null;

      const dom = document.createElement("span");
      dom.className = "ol-media ol-file";
      dom.dataset.type = "note-file";
      dom.contentEditable = "false";

      const head = document.createElement("span");
      head.className = "ol-file-head";
      const title = document.createElement("span");
      title.className = "ol-file-title";
      const name = button("", "ol-file-name");
      const meta = document.createElement("span");
      meta.className = "ol-file-meta";
      title.append(name, meta);
      const actions = document.createElement("span");
      actions.className = "ol-file-actions";
      const toggle = button("");
      const download = button("Herunterladen");
      actions.append(toggle, download);
      head.append(fileIcon(), title, actions);
      const status = document.createElement("span");
      status.className = "ol-media-status";
      const pages = document.createElement("span");
      pages.className = "ol-pdf";
      // „Seite 3 von 12“ unter dem Fenster (#36)
      const counter = document.createElement("span");
      counter.className = "ol-pdf-counter";
      dom.append(head, status, pages, counter);

      const attrs = (): FileAttrs => ({
        path: node.attrs.path,
        name: node.attrs.name,
        size: node.attrs.size,
        mime: node.attrs.mime,
      });
      const pdf = () => files?.isPdf(attrs()) ?? false;

      const setView = (next: FileView) =>
        updateNodeAttrs(editor.view, getPos, NOTE_FILE, { view: next });

      const render = () => {
        const file = attrs();
        const full = pdf() && node.attrs.view === "full";
        dom.dataset.path = file.path ?? "";
        dom.dataset.view = full ? "full" : "tile";
        name.textContent = file.name;
        name.setAttribute(
          "aria-label",
          pdf() ? `„${file.name}“ öffnen` : `„${file.name}“ herunterladen`,
        );
        name.title = pdf() ? "Im neuen Tab öffnen" : "Herunterladen";
        download.setAttribute("aria-label", `„${file.name}“ herunterladen`);
        toggle.hidden = !pdf();
        toggle.textContent = full ? "Als Kachel" : "Ganz anzeigen";
        toggle.setAttribute(
          "aria-label",
          full ? `„${file.name}“ als Kachel zeigen` : `„${file.name}“ ganz anzeigen`,
        );
        const pending = file.path ? files?.uploading(file.path) : undefined;
        const describe = files?.describe(file) ?? file.name;
        meta.textContent = pending ? `${describe} · wird hochgeladen …` : describe;
        pending?.then(
          () => render(),
          () => {},
        );
        if (!files || !file.path) {
          dom.classList.add("is-missing");
          status.textContent = "Datei nicht verfügbar";
        }
        // komplette Ansicht ein- bzw. aushängen
        if (full && files && file.path && mountedPath !== file.path) {
          unmount?.();
          mountedPath = file.path;
          // eigenes Scroll-Fenster: mit der Tastatur erreichbar (Pfeile, Bild ↑/↓)
          pages.tabIndex = 0;
          pages.setAttribute("role", "region");
          pages.setAttribute("aria-label", `PDF „${file.name}“`);
          unmount = files.mountPdf(
            pages,
            file.path,
            (text) => {
              status.textContent = text;
            },
            (current, total) => {
              counter.textContent = `Seite ${current} von ${total}`;
            },
          );
        } else if (!full && unmount) {
          unmount();
          unmount = null;
          mountedPath = null;
          status.textContent = "";
          counter.textContent = "";
          pages.removeAttribute("tabindex");
          pages.removeAttribute("role");
          pages.removeAttribute("aria-label");
        }
      };

      name.addEventListener("click", () => {
        if (!files) return;
        if (pdf()) files.open(attrs());
        else files.download(attrs());
      });
      download.addEventListener("click", () => files?.download(attrs()));
      toggle.addEventListener("click", () => setView(node.attrs.view === "full" ? "tile" : "full"));

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
        // Klicks auf die Knöpfe gehören der Datei, nicht dem Editor
        stopEvent: (event) =>
          event.target instanceof Element && event.target.closest("button") !== null,
        ignoreMutation: () => true,
        destroy: () => unmount?.(),
      };
    };
  },

  addProseMirrorPlugins() {
    const { files } = this.options;
    const editor = this.editor;
    const images = () => imageStoreOf(editor);
    return [
      new Plugin({
        key: new PluginKey("noteFilePaste"),
        props: {
          handlePaste(view, event) {
            const list = [...(event.clipboardData?.files ?? [])];
            if (!routeFiles(view, images(), files, list)) return false;
            event.preventDefault();
            return true;
          },
          handleDrop(view, event) {
            const list = [...((event as DragEvent).dataTransfer?.files ?? [])];
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (!routeFiles(view, images(), files, list, at)) return false;
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});
