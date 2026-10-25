"use client";

import type { Editor } from "@tiptap/core";
import { useRef, useState } from "react";
import type { TaskDirectory } from "../directory";
import type { OutlineFiles } from "../extensions/note-file";
import type { OutlineImages } from "../extensions/note-image";
import { FormatContextMenu } from "./format-context-menu";
import { FormatToolbar, isTouchDevice } from "./format-toolbar";
import { useMediaPicker } from "./media-picker";

/**
 * Das Drumherum jedes Editors mit Inhalt (O-21, Rückmeldung #15: „genau so wie in den Notizen“):
 * Rechtsklick-Menü am Desktop, Leiste an der Markierung, Link-Eingabe, Bild-/Dateiauswahl.
 * Die Teile kommen einzeln zurück, damit jeder Editor sie an seiner Stelle einhängt.
 */
export function useEditorChrome(
  editor: Editor | null,
  options: {
    images: OutlineImages | null;
    files: OutlineFiles | null;
    /** „Block → Aufgabe“ im Menü (Outliner) */
    tasks?: TaskDirectory | null;
    /** Checkliste und Aufzählung im Menü (Notiz einer Aufgabe) */
    lists?: boolean;
  },
) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [linkRequest, setLinkRequest] = useState(0);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const picker = useMediaPicker(() => editorRef.current);
  const { images, files, tasks, lists } = options;

  return {
    picker,
    /** Desktop: eigenes Formatierungsmenü; ⇧ + Rechtsklick und Touch: Systemmenü */
    onContextMenu: (event: React.MouseEvent) => {
      if (!editor || event.shiftKey || isTouchDevice()) return;
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    toolbar: editor ? <FormatToolbar editor={editor} linkRequest={linkRequest} /> : null,
    menu:
      editor && contextMenu ? (
        <FormatContextMenu
          editor={editor}
          tasks={tasks}
          lists={lists}
          at={contextMenu}
          onClose={() => setContextMenu(null)}
          onLink={() => setLinkRequest((n) => n + 1)}
          onInsertImage={images ? picker.pickImage : undefined}
          onInsertFile={files ? picker.pickFile : undefined}
        />
      ) : null,
    /** versteckte Dateiauswahl (nur mit Bild- oder Dateispeicher) */
    inputs: images || files ? picker.inputs : null,
  };
}
