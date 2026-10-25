import type { Extensions } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { newId } from "@/lib/id";
import type { NoteDirectory, TagDirectory, TaskDirectory } from "../directory";
import { PARAGRAPH } from "../model/names";
import { AutoLinks } from "./auto-links";
import { Block } from "./block";
import { BlockTask } from "./block-task";
import { LeaveEditor } from "./leave";
import { Mermaid } from "./mermaid";
import { NoteFile, type OutlineFiles } from "./note-file";
import { NoteImage, type OutlineImages } from "./note-image";
import { NoteLink } from "./note-link";
import { Outline } from "./outline";
import { OutlineDocument } from "./outline-document";
import { OutlineSuggestions, type SuggestionRendererFactory } from "./suggestions";
import { Tag } from "./tag";
import { textStyleExtensions } from "./text-style";
import { Timestamp } from "./timestamp";

export interface OutlineExtensionOptions {
  generateId?: () => string;
  notes?: NoteDirectory | null;
  tags?: TagDirectory | null;
  tasks?: TaskDirectory | null;
  onOpenNote?: (noteId: string) => void;
  suggestionRenderer?: SuggestionRendererFactory | null;
  placeholder?: string;
  /** Bilder in Notizen (E24); ohne: Einfügen von Bildern bleibt aus */
  images?: OutlineImages | null;
  /** Dateien (PDF und beliebige, #27); ohne: nur Bilder */
  files?: OutlineFiles | null;
  /** Mermaid zeichnen (lädt die Bibliothek nach); ohne: nur der Code */
  renderMermaid?: ((code: string) => Promise<string>) | null;
}

/** Alle Extensions des Outliners (Editor in der App, Spielwiese und Headless-Tests). */
export function createOutlineExtensions(options: OutlineExtensionOptions = {}): Extensions {
  const notes = options.notes ?? null;
  return [
    OutlineDocument,
    Block.configure({ tasks: options.tasks ?? null }),
    BlockTask.configure({ tasks: options.tasks ?? null }),
    StarterKit.configure({
      document: false,
      heading: false,
      blockquote: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      horizontalRule: false,
      underline: false,
      trailingNode: false,
      dropcursor: false,
      gapcursor: false,
      // Klick öffnet Web-Links im neuen Tab (wie Notiz-Links und in Notion); bearbeiten über die Leiste
      link: { openOnClick: true, autolink: true, defaultProtocol: "https" },
    }),
    Placeholder.configure({
      includeChildren: true,
      showOnlyCurrent: true,
      placeholder: ({ editor, node }) =>
        node.type.name === PARAGRAPH &&
        editor.state.doc.childCount === 1 &&
        editor.state.doc.firstChild?.childCount === 1
          ? (options.placeholder ?? "Tippen … (( verlinken · # Tag")
          : "",
    }),
    // Adressen ohne Link-Markierung klickbar (#93), nur Darstellung
    AutoLinks,
    NoteLink.configure({ notes, onOpenNote: options.onOpenNote }),
    LeaveEditor,
    NoteImage.configure({ images: options.images ?? null }),
    NoteFile.configure({ files: options.files ?? null }),
    Mermaid.configure({ render: options.renderMermaid ?? null }),
    Tag,
    // mehr Formatierung (#40): Überschriften, Zitat, Hinweis, Linie, Textfarbe, Marker
    ...textStyleExtensions(),
    // „@jetzt“ / „@heute“ = Zeitstempel
    Timestamp,
    Outline.configure({ generateId: options.generateId ?? newId, notes }),
    OutlineSuggestions.configure({
      notes,
      tags: options.tags ?? null,
      renderer: options.suggestionRenderer ?? null,
    }),
  ];
}
