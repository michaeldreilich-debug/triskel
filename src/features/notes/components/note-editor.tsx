"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Editor, JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OutlineEditor } from "@/features/outliner/components/outline-editor";
import { writeTaskTitles } from "@/features/outliner/model/guard";
import { type BlockRow, rowsToDoc, taskBlockTexts } from "@/features/outliner/model/serializer";
import { OutlineSync } from "@/features/outliner/sync";
import { tasksKey, useTaskActions, useTasks } from "@/features/tasks/api";
import { createQueryTaskDirectory } from "@/features/tasks/directory";
import { useTaskPeek } from "@/features/tasks/peek";
import type { TaskRow } from "@/features/tasks/types";
import { isEmptyDoc } from "@/features/templates/model";
import { useRefreshOnReturn } from "@/lib/data/fresh";
import { hasUnconfirmed } from "@/lib/data/unconfirmed";
import { sameJson } from "@/lib/same-json";
import { useSaveQueue } from "@/lib/save-queue/react";
import { noteBlocksKey, useNoteActions } from "../api";
import { createQueryNoteDirectory, createQueryTagDirectory } from "../directory";
import { useOutlineMedia } from "../media";
import type { NoteRow } from "../types";

declare global {
  interface Window {
    /** nur Entwicklung/Test: Editor der geöffneten Notiz (Cursor setzen in E2E-Tests) */
    __noteEditor?: Editor | null;
  }
}

const exposeEditor =
  process.env.NODE_ENV === "production"
    ? undefined
    : (editor: Editor | null) => {
        window.__noteEditor = editor;
      };

/** Namen aller Inline-Tags (#tag) im Dokument. */
export function collectTags(doc: JSONContent, into: Set<string> = new Set()): Set<string> {
  if (doc.type === "tag" && typeof doc.attrs?.name === "string") into.add(doc.attrs.name);
  for (const child of doc.content ?? []) collectTags(child, into);
  return into;
}

/**
 * Outliner einer Notiz mit echter Persistenz: Editor → OutlineSync (Diff je Block) →
 * Speicher-Warteschlange → Supabase. Wird je Notiz neu eingehängt (key = Notiz-ID).
 */
export function NoteEditor({
  note,
  initialRows,
  rows,
  onOpenNote,
  onTaskIdsChange,
  onEmptyChange,
  editorRef,
}: {
  note: NoteRow;
  initialRows: BlockRow[];
  /** aktueller Serverstand (frisch geladen bei Fokus/Reconnect, V-6) – übernommen, solange nichts ungespeichert ist */
  rows?: BlockRow[];
  onOpenNote: (noteId: string) => void;
  /** Aufgaben der Blöcke („Block → Aufgabe“) für die Liste unter der Notiz */
  onTaskIdsChange?: (taskIds: string[]) => void;
  /** Notiz leer (höchstens ein leerer Block)? – für das Angebot der Vorlagen (B11) */
  onEmptyChange?: (empty: boolean) => void;
  editorRef?: React.RefObject<Editor | null>;
}) {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  // Bilder und Dateien dieser Notiz (private Buckets, Ordner je Nutzer und Notiz)
  const { images, files } = useOutlineMedia(note.id);
  const actions = useNoteActions();
  const taskActions = useTaskActions();
  const peek = useTaskPeek();
  // Aufgaben-Cache laden, damit Aufgaben-Blöcke ihren Status zeigen (und Titel zurückschreiben, V-3)
  const taskQuery = useTasks();
  // neue Notizen aus [[ landen im Bereich und Thema der aktuellen Notiz, neue Aufgaben aus „[] “
  // im Bereich und Projekt der Notiz
  const context = useRef({
    areaId: note.area_id,
    topicId: note.topic_id,
    projectId: note.project_id,
  });
  context.current = { areaId: note.area_id, topicId: note.topic_id, projectId: note.project_id };
  const openTask = useRef(peek.open);
  openTask.current = peek.open;
  const taskIdsCallback = useRef(onTaskIdsChange);
  taskIdsCallback.current = onTaskIdsChange;
  const emptyCallback = useRef(onEmptyChange);
  emptyCallback.current = onEmptyChange;

  const directory = useMemo(
    () =>
      createQueryNoteDirectory(queryClient, {
        create: (title) =>
          actions.create({
            title,
            area_id: context.current.areaId,
            topic_id: context.current.topicId,
          }).id,
      }),
    [queryClient, actions],
  );
  const tags = useMemo(() => createQueryTagDirectory(queryClient), [queryClient]);
  const tasks = useMemo(
    () =>
      createQueryTaskDirectory(queryClient, taskActions, {
        context: () => ({
          areaId: context.current.areaId,
          projectId: context.current.projectId,
        }),
        open: (taskId) => openTask.current(taskId),
      }),
    [queryClient, taskActions],
  );
  const taskTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDoc = useRef<JSONContent | null>(null);
  const lastTaskIds = useRef("");
  /** Blocktext je Aufgabe beim letzten Abgleich – nur Geändertes schreibt den Titel (V-3) */
  const lastTexts = useRef<Map<string, string> | null>(null);
  /** Block → Aufgabe: geänderter Blocktext wird Titel der Aufgabe; Liste der Aufgaben melden */
  const syncTasks = useCallback(
    (doc: JSONContent) => {
      const texts = taskBlockTexts(doc, { resolveTitle: (id) => directory.titleOf(id) });
      const known = queryClient.getQueryData<TaskRow[]>(tasksKey) ?? [];
      const previous = lastTexts.current;
      for (const [taskId, text] of texts) {
        const task = known.find((t) => t.id === taskId);
        if (!task || task.title === text) continue;
        // unveränderter Blocktext überschreibt keinen anderswo (Panel, Tabelle, KI) geänderten Titel
        if (previous?.has(taskId) && previous.get(taskId) === text) continue;
        taskActions.update(taskId, { title: text });
      }
      lastTexts.current = texts;
      const ids = [...texts.keys()];
      const key = ids.join(",");
      if (key !== lastTaskIds.current) {
        lastTaskIds.current = key;
        taskIdsCallback.current?.(ids);
      }
    },
    [directory, queryClient, taskActions],
  );

  const [sync] = useState(
    () =>
      new OutlineSync(queue, {
        initialRows,
        extra: { note_id: note.id },
        delayMs: 400,
        serialize: { resolveTitle: (id) => directory.titleOf(id) },
      }),
  );
  const [initialDoc] = useState(() => rowsToDoc(initialRows));
  // „zuletzt bearbeitet“ in der Liste (Sortierung „Neueste zuerst“)
  const lastTouch = useRef(0);
  const editorInstance = useRef<Editor | null>(null);
  const onEditorReady = useCallback(
    (editor: Editor | null) => {
      editorInstance.current = editor;
      if (editorRef) editorRef.current = editor;
      exposeEditor?.(editor);
    },
    [editorRef],
  );

  /** Nichts ungespeichert: weder entprellte Eingabe noch wartende Blöcke dieser Notiz */
  const isClean = useCallback(() => {
    if (sync.hasPending()) return false;
    const ids = new Set(sync.rows().map((row) => row.id));
    return (
      hasUnconfirmed(
        queue,
        "note_blocks",
        (op) => op.values.note_id === note.id || ids.has(op.id),
      ) === 0
    );
  }, [queue, sync, note.id]);

  // Zurück am Fenster (Fokus, Netz, sichtbar): Blöcke frisch laden, solange hier nichts
  // ungespeichert ist (V-6) – die Abfrage lädt sonst nur beim Öffnen
  useRefreshOnReturn(noteBlocksKey(note.id), () => !isClean());

  // frischer Serverstand (anderer Tab, iPhone, KI): übernehmen, solange hier nichts ungespeichert
  // ist – ohne Eintrag in der Rückgängig-Liste, Cursor bleibt (V-6)
  useEffect(() => {
    const editor = editorInstance.current;
    if (!rows || rows === initialRows || !editor || editor.isDestroyed) return;
    if (!isClean()) return;
    if (!sync.reset(rows)) return;
    const doc = rowsToDoc(rows);
    if (sameJson(doc, editor.getJSON())) return;
    const { from, to } = editor.state.selection;
    editor.chain().setMeta("addToHistory", false).setContent(doc, { emitUpdate: false }).run();
    if (editor.isFocused) {
      const size = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) });
    }
    const texts = taskBlockTexts(doc, { resolveTitle: (id) => directory.titleOf(id) });
    lastTexts.current = texts;
    taskIdsCallback.current?.([...texts.keys()]);
    emptyCallback.current?.(isEmptyDoc(doc));
  }, [rows, initialRows, isClean, sync, directory]);

  // Aufgabe anderswo umbenannt (Panel, Tabelle, KI): Titel in den Block zurück, solange der
  // Blocktext seit dem letzten Abgleich unverändert und reiner Text ist (V-3)
  useEffect(() => {
    const editor = editorInstance.current;
    const known = taskQuery.data;
    const previous = lastTexts.current;
    if (!editor || editor.isDestroyed || !known || !previous || pendingDoc.current) return;
    const changed = new Map<string, string>();
    for (const [taskId, text] of previous) {
      const task = known.find((t) => t.id === taskId);
      if (task && task.title.trim() !== text) changed.set(taskId, task.title);
    }
    if (changed.size === 0) return;
    const tr = editor.state.tr;
    const written = writeTaskTitles(tr, changed);
    if (written.length === 0) return;
    editor.view.dispatch(tr.setMeta("addToHistory", false));
    for (const taskId of written) previous.set(taskId, changed.get(taskId) ?? "");
  }, [taskQuery.data]);

  const flushTasks = useCallback(() => {
    if (taskTimer.current) clearTimeout(taskTimer.current);
    taskTimer.current = null;
    const doc = pendingDoc.current;
    pendingDoc.current = null;
    if (doc) syncTasks(doc);
  }, [syncTasks]);

  // Aufgaben-Liste unter der Notiz beim Öffnen füllen; Ausgangsstand der Blocktexte (V-3)
  useEffect(() => {
    const texts = taskBlockTexts(initialDoc, { resolveTitle: (id) => directory.titleOf(id) });
    lastTexts.current = texts;
    taskIdsCallback.current?.([...texts.keys()]);
    emptyCallback.current?.(isEmptyDoc(initialDoc));
  }, [initialDoc, directory]);

  useEffect(() => {
    // vor jedem Flush der Warteschlange (auch pagehide/hidden) den entprellten Stand übernehmen –
    // die Warteschlange ruft das selbst zuerst auf, egal wer seinen Listener zuerst anhängte (D-6)
    const commit = () => {
      sync.commit();
      flushTasks();
    };
    const off = queue.onBeforeFlush(commit);
    return () => {
      off();
      commit();
    };
  }, [queue, sync, flushTasks]);

  return (
    <OutlineEditor
      initialContent={initialDoc}
      notes={directory}
      tags={tags}
      tasks={tasks}
      ariaLabel={`Inhalt: ${note.title || "Ohne Titel"}`}
      images={images}
      files={files}
      onChange={(doc) => {
        sync.change(doc);
        emptyCallback.current?.(isEmptyDoc(doc));
        if (taskTimer.current) clearTimeout(taskTimer.current);
        pendingDoc.current = doc;
        taskTimer.current = setTimeout(flushTasks, 400);
        actions.mergeInlineTags(note.id, [...collectTags(doc)]);
        const now = Date.now();
        if (now - lastTouch.current > 10_000) {
          lastTouch.current = now;
          actions.touch(note.id);
        }
      }}
      onBlur={() => {
        sync.commit();
        flushTasks();
      }}
      onOpenNote={(id) => {
        sync.commit();
        onOpenNote(id);
      }}
      onEditorReady={onEditorReady}
    />
  );
}
