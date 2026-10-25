"use client";

import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/id";
import type { NoteDirectory, TagDirectory, TaskDirectory } from "../directory";
import { createOutlineExtensions } from "../extensions";
import type { OutlineFiles } from "../extensions/note-file";
import type { OutlineImages } from "../extensions/note-image";
import { renderMermaid } from "../mermaid-render";
import { ensureBlockIds } from "../model/ids";
import { useEditorChrome } from "./editor-chrome";
import { useSuggestionPopup } from "./suggestion-popup";

export interface OutlineEditorProps {
  initialContent: JSONContent;
  notes: NoteDirectory;
  tags: TagDirectory;
  /** Aufgaben für „Block → Aufgabe“ (ohne: „[] “ bleibt Text) */
  tasks?: TaskDirectory | null;
  onChange?: (doc: JSONContent) => void;
  onBlur?: () => void;
  onOpenNote?: (noteId: string) => void;
  /** Zugriff auf die Editor-Instanz (z. B. für die Spielwiese) */
  onEditorReady?: (editor: Editor | null) => void;
  generateId?: () => string;
  ariaLabel?: string;
  className?: string;
  /** Bilder einfügen und anzeigen (Notizen, E24) */
  images?: OutlineImages | null;
  /** Dateien einfügen und anzeigen (PDF und beliebige, #27) */
  files?: OutlineFiles | null;
}

const defaultId = newId;

/** TipTap-Outliner (WYSIWYG, F1) mit ((Link))- und #Tag-Autocomplete und Formatierungsleiste. */
export function OutlineEditor({
  initialContent,
  notes,
  tags,
  tasks = null,
  onChange,
  onBlur,
  onOpenNote,
  onEditorReady,
  generateId = defaultId,
  ariaLabel = "Notiz",
  className,
  images = null,
  files = null,
}: OutlineEditorProps) {
  const suggestions = useSuggestionPopup();
  const callbacks = useRef({ onChange, onBlur, onOpenNote });
  callbacks.current = { onChange, onBlur, onOpenNote };

  // Extensions nur einmal erzeugen; Rückrufe laufen über Refs
  // biome-ignore lint/correctness/useExhaustiveDependencies: bewusst stabil
  const extensions = useMemo(
    () =>
      createOutlineExtensions({
        notes,
        tags,
        tasks,
        generateId,
        onOpenNote: (id) => callbacks.current.onOpenNote?.(id),
        suggestionRenderer: suggestions.renderer,
        images,
        files,
        renderMermaid,
      }),
    [],
  );

  const editor = useEditor({
    extensions,
    content: ensureBlockIds(initialContent, generateId),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "outline-editor",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: e }) => callbacks.current.onChange?.(e.getJSON()),
    onBlur: () => callbacks.current.onBlur?.(),
  });
  const chrome = useEditorChrome(editor, { images, files, tasks });

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  return (
    <>
      <EditorContent
        editor={editor}
        className={cn("min-h-40", className)}
        data-testid="outline-editor"
        onContextMenu={chrome.onContextMenu}
      />
      {chrome.toolbar}
      {chrome.menu}
      {suggestions.popup}
      {chrome.inputs}
    </>
  );
}
