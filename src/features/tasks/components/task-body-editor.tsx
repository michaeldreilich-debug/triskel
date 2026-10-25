"use client";

import type { QueryKey } from "@tanstack/react-query";
import { type Editor, type Extensions, type JSONContent, wrappingInputRule } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ListChecks, Paperclip } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditorChrome } from "@/features/outliner/components/editor-chrome";
import { TouchPhotoButtons } from "@/features/outliner/components/media-picker";
import { type HelpSections, OutlinerHelp } from "@/features/outliner/components/outliner-help";
import { useSuggestionPopup } from "@/features/outliner/components/suggestion-popup";
import type { NoteDirectory } from "@/features/outliner/directory";
import { AutoLinks } from "@/features/outliner/extensions/auto-links";
import { LeaveEditor } from "@/features/outliner/extensions/leave";
import { NoteFile, type OutlineFiles } from "@/features/outliner/extensions/note-file";
import { NoteImage, type OutlineImages } from "@/features/outliner/extensions/note-image";
import { NoteLink } from "@/features/outliner/extensions/note-link";
import {
  OutlineSuggestions,
  type SuggestionRendererFactory,
} from "@/features/outliner/extensions/suggestions";
import { textStyleExtensions } from "@/features/outliner/extensions/text-style";
import { Timestamp } from "@/features/outliner/extensions/timestamp";
import { NOTE_LINK } from "@/features/outliner/model/names";
import { useRefreshOnReturn } from "@/lib/data/fresh";
import { sameJson } from "@/lib/same-json";
import { useSaveQueue } from "@/lib/save-queue/react";

declare global {
  interface Window {
    /** nur Entwicklung/Test: Editor der offenen Aufgaben-Notiz */
    __taskBodyEditor?: Editor | null;
  }
}

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/** Zeichen und Kürzel der Aufgaben-Notiz (Spickzettel, feedback.md #8). */
export const TASK_BODY_HELP: HelpSections = [
  {
    title: "Checkliste",
    rows: [
      ["Punkt hinzufügen", "Knopf unter der Notiz: neuer Checklisten-Punkt"],
      ["() oder []", "am Zeilenanfang: Checklisten-Punkt"],
      ["- ", "am Zeilenanfang: Aufzählung"],
      ["Enter", "nächster Punkt, zweimal Enter beendet die Liste"],
      ["Tab / ⇧ Tab", "Punkt einrücken / ausrücken"],
      ["Esc", "Notiz verlassen (danach geht Tab weiter)"],
    ],
  },
  {
    title: "Beim Tippen",
    rows: [
      ["((", "Notiz verlinken (Titel tippen, Enter)"],
      ["⌘ Enter", "am Notiz-Link: Notiz öffnen"],
      ["@jetzt / @heute", "+ Leertaste: Zeitstempel (17.10.2026 20:45) bzw. Datum"],
      ["**fett**", "fett"],
      ["*kursiv*", "kursiv"],
      ["~~weg~~", "durchgestrichen"],
      ["www.…", "Web-Adresse wird zum Link"],
      ["⌘ V / Ziehen", "Bild oder Datei (PDF …) einfügen – auch irgendwo auf die Aufgabe ziehen"],
    ],
  },
  {
    title: "Absatz und Farbe",
    rows: [
      ["# / ## / ###", "+ Leertaste am Anfang: Überschrift 1, 2, 3 (⌘ ⌥ 1–3)"],
      ["> ", "am Anfang: Zitat"],
      ["---", "am Anfang einer leeren Zeile: Trennlinie"],
      ["==Text==", "Marker (⌘ ⇧ H)"],
      ["Rücktaste", "am Anfang einer Überschrift: wieder normaler Text"],
      ["Rechtsklick", "Absatz (auch Hinweis-Kasten) und Farbe; am Handy „Aa“ in der Leiste"],
    ],
  },
  {
    title: "Text markieren",
    rows: [
      ["Rechtsklick", "Fett, Kursiv, Absatz, Farbe, Link, als Notiz verlinken, Checkliste"],
      ["Leiste", "am Handy: erscheint beim Markieren"],
      ["⌘ B / I / E", "fett / kursiv / Code"],
    ],
  },
];

/** Checklisten-Punkt: „[] “ (TipTap) und zusätzlich „() “ – ohne ⌥ auf der deutschen Tastatur. */
const ChecklistItem = TaskItem.extend({
  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      wrappingInputRule({
        find: /^\s*(\(( |x)?\))\s$/,
        type: this.type,
        getAttributes: (match) => ({ checked: match[match.length - 1] === "x" }),
      }),
    ];
  },
});

export interface TaskBodyExtensionOptions {
  notes?: NoteDirectory | null;
  /** Bilder und Dateien in der Aufgaben-Notiz (#27) */
  images?: OutlineImages | null;
  files?: OutlineFiles | null;
  onOpenNote?: (noteId: string) => void;
  suggestionRenderer?: SuggestionRendererFactory | null;
  placeholder?: string;
}

/** Extensions der Aufgaben-Notiz und des Projekt-Freitexts (App und Headless-Tests). */
export function createTaskBodyExtensions(options: TaskBodyExtensionOptions = {}): Extensions {
  const notes = options.notes ?? null;
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      underline: false,
      dropcursor: false,
      gapcursor: false,
      link: { openOnClick: true, autolink: true, defaultProtocol: "https" },
    }),
    TaskList,
    ChecklistItem.configure({
      nested: true,
      HTMLAttributes: { "data-type": "taskItem" },
      a11y: {
        checkboxLabel: (node, checked) =>
          `Punkt „${node.textContent || "leer"}“ ${checked ? "erledigt" : "offen"}`,
      },
    }),
    Placeholder.configure({ placeholder: options.placeholder ?? "Notiz oder Checkliste …" }),
    // Adressen ohne Link-Markierung klickbar (#93), nur Darstellung
    AutoLinks,
    NoteLink.configure({ notes, onOpenNote: options.onOpenNote }),
    LeaveEditor,
    NoteImage.configure({ images: options.images ?? null }),
    NoteFile.configure({ files: options.files ?? null }),
    // mehr Formatierung wie in den Notizen (#40, #15)
    ...textStyleExtensions(),
    Timestamp,
    OutlineSuggestions.configure({
      notes,
      tags: null,
      renderer: options.suggestionRenderer ?? null,
    }),
  ];
}

const emptyItem = { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] };

/**
 * Neuer Checklisten-Punkt am Ende (Knopf „Punkt hinzufügen“, ohne Klammern tippen zu müssen):
 * hängt an eine Checkliste am Ende an, macht einen leeren letzten Absatz zum Punkt oder beginnt
 * eine neue Checkliste. Ein leerer letzter Punkt bekommt nur den Cursor.
 */
export function addChecklistItem(editor: Editor) {
  const { doc } = editor.state;
  let index = doc.childCount - 1;
  // TipTap hält einen leeren Absatz hinter einer Liste am Ende – die Liste davor zählt als „letzte“
  const trailing = doc.child(index);
  if (
    index > 0 &&
    trailing.type.name === "paragraph" &&
    trailing.content.size === 0 &&
    doc.child(index - 1).type.name === "taskList"
  ) {
    index -= 1;
  }
  const last = doc.child(index);
  let end = 0;
  for (let i = 0; i <= index; i++) end += doc.child(i).nodeSize;
  const chain = editor.chain();
  if (last.type.name === "taskList") {
    const lastItem = last.lastChild;
    if (lastItem && lastItem.childCount === 1 && lastItem.textContent === "") {
      chain.setTextSelection(end - 3);
    } else {
      chain.insertContentAt(end - 1, emptyItem).setTextSelection(end + 1);
    }
  } else if (last.type.name === "paragraph" && last.content.size === 0) {
    chain.setTextSelection(end - 1).toggleTaskList();
  } else {
    chain
      .insertContentAt(end, { type: "taskList", content: [emptyItem] })
      .setTextSelection(end + 3);
  }
  chain.scrollIntoView().run();
  editor.view.focus();
}

const NO_REFRESH: QueryKey = ["task-body-editor", "kein-refresh"];

/**
 * Notiz/Checkliste einer Aufgabe (tasks.body als TipTap-JSON mit TaskList). Bedient sich wie der
 * Notiz-Editor (Rückmeldung 12.10.2026): Rechtsklick formatiert, am Handy erscheint die Leiste beim
 * Markieren, „((“ verlinkt Notizen. Checklisten-Punkte per Knopf, „() “ oder „[] “.
 * Unkontrolliert: Inhalt nur beim Einhängen (key = Aufgaben-ID), Änderungen gehen per onChange
 * in die Speicher-Warteschlange (entprellt).
 */
export function TaskBodyEditor({
  initialContent,
  onChange,
  notes = null,
  onOpenNote,
  ariaLabel = "Notiz oder Checkliste",
  images = null,
  files = null,
  editorRef,
  placeholder,
  testId = "task-body",
  autoFocus = false,
  refreshKey,
}: {
  initialContent: JSONContent | null;
  onChange: (body: JSONContent | null, text: string) => void;
  notes?: NoteDirectory | null;
  onOpenNote?: (noteId: string) => void;
  ariaLabel?: string;
  images?: OutlineImages | null;
  files?: OutlineFiles | null;
  /** Zugriff von außen (Ablegen irgendwo auf der Aufgabe) */
  editorRef?: React.RefObject<Editor | null>;
  placeholder?: string;
  /** data-testid des Textfelds (Projekt-Freitext: „project-body“) */
  testId?: string;
  /** beim Einhängen fokussieren (Enter im Titel, bevor die Notiz geladen war) */
  autoFocus?: boolean;
  /** Abfrage, die bei Rückkehr ans Fenster frisch geladen wird, solange nichts ungespeichert ist (V-2) */
  refreshKey?: QueryKey;
}) {
  const callbacks = useRef({ onChange, onOpenNote, notes });
  callbacks.current = { onChange, onOpenNote, notes };
  const queue = useSaveQueue();
  const queueRef = useRef(queue);
  queueRef.current = queue;
  /** ungespeicherte Eingabe (entprellt wie im Outliner, O-7) */
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** zuletzt bekannter Stand (eigene Eingabe oder übernommener Serverstand, D-7) */
  const known = useRef<JSONContent | null>(initialContent);
  const suggestions = useSuggestionPopup();

  // Extensions nur einmal erzeugen; Rückrufe laufen über Refs
  // biome-ignore lint/correctness/useExhaustiveDependencies: bewusst stabil
  const extensions = useMemo(
    () =>
      createTaskBodyExtensions({
        notes,
        images,
        files,
        onOpenNote: (id) => callbacks.current.onOpenNote?.(id),
        suggestionRenderer: suggestions.renderer,
        placeholder,
      }),
    [],
  );

  const editor = useEditor({
    extensions,
    content: initialContent ?? EMPTY_DOC,
    immediatelyRender: false,
    autofocus: autoFocus ? "start" : false,
    editorProps: {
      attributes: {
        class: "task-body",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        spellcheck: "true",
      },
    },
    onUpdate: () => {
      // nicht je Taste die ganze Spalte schreiben: 400 ms Ruhe, Verlassen oder Flush (O-7)
      dirty.current = true;
      queueRef.current.markDirty(dirty, true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => commitRef.current(), 400);
    },
    onBlur: () => commitRef.current(),
  });

  const current = useRef(editor);
  current.current = editor;

  /** Entprellte Eingabe übernehmen: Klartext für Suche und Vorschau, Notiz-Links als Titel. */
  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const e = current.current;
    if (!dirty.current) return;
    dirty.current = false;
    queueRef.current.markDirty(dirty, false);
    if (!e || e.isDestroyed) return;
    const text = e
      .getText({
        blockSeparator: "\n",
        textSerializers: {
          [NOTE_LINK]: ({ node }) => callbacks.current.notes?.titleOf(node.attrs.noteId) ?? "",
        },
      })
      .trim();
    const body = e.isEmpty ? null : e.getJSON();
    known.current = body;
    callbacks.current.onChange(body, text);
  }, []);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // vor jedem Flush (auch beim Verlassen der Seite) und beim Schließen übernehmen (D-6)
  useEffect(() => {
    const off = queue.onBeforeFlush(commit);
    return () => {
      off();
      commit();
    };
  }, [queue, commit]);

  // Zurück am Fenster (Fokus, Netz, sichtbar): frisch laden, solange hier nichts ungespeichert
  // ist (V-2) – TanStack allein lädt erst nach 30 s Stale-Zeit
  useRefreshOnReturn(refreshKey ?? NO_REFRESH, () => !refreshKey || dirty.current);

  // Neuerer Stand von anderswo (KI hängt ein PDF an, Häkchen am iPhone): übernehmen, solange
  // hier nichts ungespeichert ist – sonst schickte die nächste Eingabe den alten Stand (D-7)
  useEffect(() => {
    if (!editor || editor.isDestroyed || dirty.current) return;
    if (sameJson(initialContent, known.current)) return;
    known.current = initialContent;
    // steht schon so im Editor (z. B. eigener Stand nach dem Neuladen): Cursor nicht anfassen
    if (sameJson(initialContent ?? EMPTY_DOC, editor.getJSON())) return;
    const { from, to } = editor.state.selection;
    // fremder Stand ohne Eintrag in der Rückgängig-Liste (V-7): ⌘Z macht sonst die Änderung der
    // KI bzw. des iPhones rückgängig und speichert das
    editor
      .chain()
      .setMeta("addToHistory", false)
      .setContent(initialContent ?? EMPTY_DOC, { emitUpdate: false })
      .run();
    if (editor.isFocused) {
      const size = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) });
    }
  }, [editor, initialContent]);
  const chrome = useEditorChrome(editor, { images, files, lists: true });
  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || testId !== "task-body") return;
    window.__taskBodyEditor = editor;
    return () => {
      if (window.__taskBodyEditor === editor) window.__taskBodyEditor = null;
    };
  }, [editor, testId]);

  return (
    <div className="flex flex-col gap-1">
      <EditorContent editor={editor} data-testid={testId} onContextMenu={chrome.onContextMenu} />
      <div className="-ml-1 flex flex-wrap items-center justify-between gap-x-3">
        <button
          type="button"
          aria-label="Checklisten-Punkt hinzufügen"
          onClick={() => editor && addChecklistItem(editor)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-ui-sm text-faint hover:text-fg md:min-h-8"
        >
          <ListChecks size={14} strokeWidth={1.5} aria-hidden />
          Punkt hinzufügen
        </button>
        {images ? <TouchPhotoButtons picker={chrome.picker} /> : null}
        {files ? (
          <button
            type="button"
            onClick={chrome.picker.pickFile}
            className="mr-auto inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-ui-sm text-faint hover:text-fg md:min-h-8"
          >
            <Paperclip size={14} strokeWidth={1.5} aria-hidden />
            Datei anhängen
          </button>
        ) : null}
        <OutlinerHelp sections={TASK_BODY_HELP} />
      </div>
      {chrome.inputs}
      {chrome.toolbar}
      {chrome.menu}
      {suggestions.popup}
    </div>
  );
}
