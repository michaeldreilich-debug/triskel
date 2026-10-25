"use client";

import type { ChainedCommands, Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  ClipboardPaste,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  ImagePlus,
  Link2,
  List,
  ListChecks,
  Paperclip,
  RemoveFormatting,
  Scissors,
  SquareCheck,
  Unlink,
  Workflow,
} from "lucide-react";
import { useMemo, useRef } from "react";
import {
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import type { TaskDirectory } from "../directory";
import { blockTaskIdAt } from "../extensions/block-task";
import { noteLinkAt } from "../extensions/note-link";
import { NOTE_LINK } from "../model/names";
import { formatState, runFocused } from "./format-state";
import { FORMAT_MARKS, linkSelectionAsNote } from "./format-toolbar";
import { TextStyleSubmenus } from "./text-style-menu";

/**
 * Rechtsklick-Menü im Outliner (Desktop, Rückmeldung 11.10.2026): alle Formatierungen (auch Absatz
 * und Farbe, #40), Links,
 * Ausschneiden/Kopieren/Einfügen. ⇧ + Rechtsklick öffnet weiter das Systemmenü
 * (z. B. Rechtschreibvorschläge).
 */
export function FormatContextMenu({
  editor,
  tasks = null,
  lists = false,
  at,
  onClose,
  onLink,
  onInsertImage,
  onInsertFile,
}: {
  editor: Editor;
  /** „Block → Aufgabe“: umwandeln, öffnen, Verknüpfung lösen */
  tasks?: TaskDirectory | null;
  /** Checkliste und Aufzählung umschalten (Notiz einer Aufgabe) */
  lists?: boolean;
  at: { x: number; y: number };
  onClose: () => void;
  /** Link-Eingabe in der Leiste an der Markierung öffnen */
  onLink: () => void;
  /** Dateiauswahl für Bilder öffnen */
  onInsertImage?: () => void;
  /** Dateiauswahl für Dateien (PDF und beliebige, #27) öffnen */
  onInsertFile?: () => void;
}) {
  // Nach „Web-Link …“ bekommt das Adressfeld den Fokus, nicht der Editor
  const keepFocusAway = useRef(false);
  // Notiz-Link an der Stelle des Rechtsklicks oder der Auswahl (O-10)
  const linkedNote = useMemo(() => {
    const coords = editor.view.posAtCoords({ left: at.x, top: at.y });
    return (coords ? noteLinkAt(editor.state, coords.pos) : null) ?? noteLinkAt(editor.state);
  }, [editor, at]);
  const openNote = editor.extensionManager.extensions.find((e) => e.name === NOTE_LINK)?.options
    .onOpenNote as ((noteId: string) => void) | undefined;
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      ...formatState(e),
      empty: e.state.selection.empty,
      taskId: blockTaskIdAt(e.state),
      // nur abfragen, wenn das Schema Listen kennt (sonst passt isActive auf jeden Knoten)
      taskList: lists && e.isActive("taskList"),
      bulletList: lists && e.isActive("bulletList"),
    }),
  });

  const run = (command: (chain: ChainedCommands) => ChainedCommands) => runFocused(editor, command);
  const clipboard = (command: "copy" | "cut") => {
    // Auswahl zurück ins DOM, dann übernimmt ProseMirror Kopieren/Ausschneiden (Outline-Struktur)
    editor.view.focus();
    document.execCommand(command);
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      editor.view.focus();
      // mehrzeilig wie ⌘V gliedern (pasteText hat kein clipboardData, O-5)
      if (!editor.commands.pasteOutlineText?.(text)) editor.view.pasteText(text);
    } catch {
      toast("Einfügen über das Menü ist hier nicht erlaubt – bitte ⌘V benutzen.");
    }
  };

  return (
    // nicht modal: kein Fokus-Gefängnis, die Seite bleibt für Screenreader erreichbar
    <MenuRoot open modal={false} onOpenChange={(open) => !open && onClose()}>
      <MenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={{ left: at.x, top: at.y }}
        />
      </MenuTrigger>
      <MenuContent
        align="start"
        sideOffset={2}
        aria-label="Formatieren"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // nur wenn der Fokus verloren ist (Escape): Radix ruft das zeitversetzt auf – ein
          // inzwischen neu geöffnetes Menü darf es nicht wieder schließen
          const active = document.activeElement;
          if (!keepFocusAway.current && (!active || active === document.body)) {
            editor.view.focus();
          }
        }}
      >
        {FORMAT_MARKS.map(({ mark, label, keys, Icon }) => (
          <MenuCheckboxItem
            key={mark}
            shortcut={keys}
            checked={state[mark]}
            onCheckedChange={() => run((c) => c.toggleMark(mark))}
          >
            <Icon aria-hidden />
            {label}
          </MenuCheckboxItem>
        ))}
        <MenuItem onSelect={() => run((c) => c.unsetAllMarks())} disabled={state.empty}>
          <RemoveFormatting aria-hidden />
          Formatierung entfernen
        </MenuItem>
        {/* Überschriften, Zitat, Hinweis, Linie, Textfarbe, Marker (#40) */}
        <TextStyleSubmenus editor={editor} run={run} />
        {editor.can().insertTimestamp?.() ? (
          <MenuItem shortcut="@jetzt" onSelect={() => run((c) => c.insertTimestamp())}>
            <Clock aria-hidden />
            Zeitstempel einfügen
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem
          disabled={state.empty && !state.link}
          onSelect={() => {
            keepFocusAway.current = true;
            onLink();
          }}
        >
          <Link2 aria-hidden />
          {state.link ? "Web-Link bearbeiten …" : "Web-Link …"}
        </MenuItem>
        {state.link ? (
          <MenuItem onSelect={() => run((c) => c.extendMarkRange("link").unsetLink())}>
            <Unlink aria-hidden />
            Link entfernen
          </MenuItem>
        ) : null}
        <MenuItem
          shortcut="(("
          disabled={!state.noteTitle}
          onSelect={() => linkSelectionAsNote(editor)}
        >
          <FileText aria-hidden />
          Als Notiz verlinken
        </MenuItem>
        {linkedNote && openNote ? (
          <MenuItem shortcut="⌘ Enter" onSelect={() => openNote(linkedNote)}>
            <ExternalLink aria-hidden />
            Notiz öffnen
          </MenuItem>
        ) : null}
        {lists ? (
          <>
            <MenuSeparator />
            <MenuCheckboxItem
              shortcut="()"
              checked={state.taskList}
              onCheckedChange={() => run((c) => c.toggleTaskList())}
            >
              <ListChecks aria-hidden />
              Checkliste
            </MenuCheckboxItem>
            <MenuCheckboxItem
              shortcut="-"
              checked={state.bulletList}
              onCheckedChange={() => run((c) => c.toggleBulletList())}
            >
              <List aria-hidden />
              Aufzählung
            </MenuCheckboxItem>
          </>
        ) : null}
        {onInsertImage || onInsertFile || editor.schema.nodes.mermaid ? (
          <>
            <MenuSeparator />
            {onInsertImage ? (
              <MenuItem onSelect={onInsertImage}>
                <ImagePlus aria-hidden />
                Bild einfügen …
              </MenuItem>
            ) : null}
            {onInsertFile ? (
              <MenuItem onSelect={onInsertFile}>
                <Paperclip aria-hidden />
                Datei einfügen …
              </MenuItem>
            ) : null}
            {editor.schema.nodes.mermaid ? (
              <MenuItem shortcut="```mermaid" onSelect={() => run((c) => c.insertMermaid())}>
                <Workflow aria-hidden />
                Diagramm (Mermaid)
              </MenuItem>
            ) : null}
          </>
        ) : null}
        {tasks ? (
          <>
            <MenuSeparator />
            {state.taskId ? (
              <>
                <MenuItem onSelect={() => tasks.open(state.taskId as string)}>
                  <ExternalLink aria-hidden />
                  Aufgabe öffnen
                </MenuItem>
                <MenuItem onSelect={() => tasks.toggle(state.taskId as string)}>
                  <SquareCheck aria-hidden />
                  {tasks.get(state.taskId)?.done ? "Aufgabe wieder öffnen" : "Aufgabe erledigen"}
                </MenuItem>
                <MenuItem onSelect={() => run((c) => c.unlinkBlockTask())}>
                  <Unlink aria-hidden />
                  Verknüpfung zur Aufgabe lösen
                </MenuItem>
              </>
            ) : (
              <MenuItem shortcut="()" onSelect={() => run((c) => c.convertBlockToTask())}>
                <ListChecks aria-hidden />
                In Aufgabe umwandeln
              </MenuItem>
            )}
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem shortcut="⌘X" disabled={state.empty} onSelect={() => clipboard("cut")}>
          <Scissors aria-hidden />
          Ausschneiden
        </MenuItem>
        <MenuItem shortcut="⌘C" disabled={state.empty} onSelect={() => clipboard("copy")}>
          <Copy aria-hidden />
          Kopieren
        </MenuItem>
        <MenuItem shortcut="⌘V" onSelect={() => void paste()}>
          <ClipboardPaste aria-hidden />
          Einfügen
        </MenuItem>
        <MenuSeparator />
        <p className="px-2 py-1.5 text-meta text-muted">⇧ + Rechtsklick: Systemmenü</p>
      </MenuContent>
    </MenuRoot>
  );
}
