"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { notifyWithUndo, toast } from "@/components/ui/toast";
import { useAreas } from "@/features/areas/api";
import { eventLinksKey } from "@/features/calendar/links-api";
import type { NoteBlocksResult } from "@/features/notes/api";
import {
  loadNoteBlocks,
  type NoteActions,
  noteBlocksKey,
  notesKey,
  useNoteActions,
} from "@/features/notes/api";
import { useNoteTypes } from "@/features/notes/note-types";
import {
  DEFAULT_NOTE_TYPE,
  type NoteRow,
  noteTitle,
  preferredNoteType,
} from "@/features/notes/types";
import { diffRows } from "@/features/outliner/model/serializer";
import { diffToOps } from "@/features/outliner/sync";
import type { ProjectRow } from "@/features/projects/types";
import { noteSharesKey } from "@/features/share/api";
import {
  dependenciesKey,
  projectsKey,
  type TaskActions,
  tasksKey,
  useTaskActions,
} from "@/features/tasks/api";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { useSupabase } from "@/lib/data/provider";
import { overlayUnconfirmed } from "@/lib/data/unconfirmed";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import type { Supabase } from "@/lib/supabase/client";
import { useUi } from "@/lib/ui-store";
import {
  bodyTextOf,
  lostByNoteToTask,
  lostByTaskToNote,
  lostSuffix,
  rowsToTaskBody,
  snippetOf,
  taskBodyToRows,
} from "./model";

export interface ConvertDeps {
  queue: SaveQueue;
  queryClient: QueryClient;
  getSupabase: () => Supabase;
  taskActions: TaskActions;
  noteActions: NoteActions;
  /** Bereich, wenn die Aufgabe keinen hat (Inbox): der gewählte, sonst der erste */
  fallbackAreaId: () => string | null;
  /** Typ für neue Notizen (Standard „Idee“, hat der Nutzer ihn gelöscht: der Standard) */
  noteType: string;
  /** zum neuen Eintrag springen bzw. zurück */
  navigate: (href: string) => void;
  /** aktuelle Adresse (nach Rückgängig nur zurückspringen, wenn man noch dort ist) */
  currentHref: () => string;
}

export type ConvertResult = { ok: true; id: string } | { ok: false };

/**
 * Aufgabe ↔ Notiz umwandeln (#65, E36): neues Element anlegen, Original in den Papierkorb,
 * zum neuen springen, Meldung mit „Rückgängig“ (auch ⌘Z) – das holt das Original zurück und legt
 * das neue in den Papierkorb. Alles über die Speicher-Warteschlange (optimistisch): Notiz und
 * Blöcke bzw. Aufgabe werden vor dem Papierkorb-Vermerk des Originals eingetragen, in der
 * Warteschlange bleibt die Reihenfolge erhalten (Notiz vor Blöcken) – bricht die Verbindung ab,
 * existieren im schlimmsten Fall beide, nie keines.
 */
export function createConvertActions(deps: ConvertDeps) {
  const { queue, queryClient, taskActions, noteActions } = deps;
  const tasks = () => queryClient.getQueryData<TaskRow[]>(tasksKey) ?? [];
  const notes = () => queryClient.getQueryData<NoteRow[]>(notesKey) ?? [];
  const projects = () => queryClient.getQueryData<ProjectRow[]>(projectsKey) ?? [];
  // was nicht mitgeht und genannt wird (V-8): Termin-Verknüpfungen, Abhängigkeiten, Freigabe
  type Linked = { task_id: string | null; note_id: string | null; deleted_at: string | null };
  const eventLinksOf = (field: "task_id" | "note_id", id: string) =>
    (queryClient.getQueryData<Linked[]>(eventLinksKey) ?? []).filter(
      (l) => l[field] === id && !l.deleted_at,
    ).length;
  type Dependency = { task_id: string; blocked_by_task_id: string; deleted_at?: string | null };
  const dependenciesOf = (taskId: string) =>
    (queryClient.getQueryData<Dependency[]>(dependenciesKey) ?? []).filter(
      (d) => (d.task_id === taskId || d.blocked_by_task_id === taskId) && !d.deleted_at,
    ).length;
  type Share = { note_id: string; revoked_at: string | null; deleted_at: string | null };
  const isShared = (noteId: string) =>
    (queryClient.getQueryData<Share[]>(noteSharesKey) ?? []).some(
      (s) => s.note_id === noteId && !s.revoked_at && !s.deleted_at,
    );

  /** Editoren übernehmen ihren entprellten Stand (Aufgaben-Notiz, Outliner), bevor gelesen wird. */
  const commitEditors = () => {
    void queue.flush().catch(() => {});
  };

  /** Blöcke der Notiz: frisch vom Server samt lokalem Stand; offline der Stand vom Öffnen. */
  async function readBlocks(noteId: string) {
    try {
      return (await loadNoteBlocks(queue, deps.getSupabase(), noteId)).rows;
    } catch (error) {
      const cached = queryClient.getQueryData<NoteBlocksResult>(noteBlocksKey(noteId));
      if (!cached) throw error;
      return overlayUnconfirmed(
        queue,
        "note_blocks",
        cached.rows as Array<NoteBlocksResult["rows"][number] & { note_id?: string }>,
        { include: (row) => row.note_id === noteId },
      );
    }
  }

  const finish = (opts: {
    message: string;
    newHref: string;
    oldHref: string;
    undo: () => void;
  }) => {
    notifyWithUndo(opts.message, () => {
      opts.undo();
      if (deps.currentHref() === opts.newHref) deps.navigate(opts.oldHref);
    });
    deps.navigate(opts.newHref);
  };

  return {
    /** Aufgabe → Notiz (Typ Idee, Bereich/Projekt der Aufgabe, Inhalt als Blöcke) */
    taskToNote(taskId: string): ConvertResult {
      commitEditors();
      const task = tasks().find((t) => t.id === taskId);
      if (!task) return { ok: false };
      const areaId =
        task.area_id ??
        projects().find((p) => p.id === task.project_id)?.area_id ??
        deps.fallbackAreaId() ??
        null;
      if (!areaId) {
        toast.error("Kein Bereich gefunden – die Aufgabe bleibt, wie sie ist.");
        return { ok: false };
      }
      const rows = taskBodyToRows(task.body, newId);
      const note = noteActions.create({
        title: task.title,
        area_id: areaId,
        project_id: task.project_id,
        type: deps.noteType,
      });
      for (const op of diffToOps(diffRows([], rows), {
        table: "note_blocks",
        extra: { note_id: note.id },
      })) {
        queue.enqueue(op);
      }
      queryClient.setQueryData<NoteRow[]>(notesKey, (old) =>
        old?.map((n) => (n.id === note.id ? { ...n, snippet: snippetOf(rows) } : n)),
      );
      const restoreTask = taskActions.trashQuietly(taskId);
      finish({
        message: `„${taskTitle(task)}“ ist jetzt eine Notiz${lostSuffix(
          lostByTaskToNote(task, {
            eventLinks: eventLinksOf("task_id", taskId),
            dependencies: dependenciesOf(taskId),
          }),
        )}`,
        newHref: appPath.note(note.id),
        oldHref: appPath.task(taskId),
        undo: () => {
          restoreTask?.();
          noteActions.trashQuietly(note.id);
        },
      });
      return { ok: true, id: note.id };
    },

    /** Notiz → Aufgabe (Bereich/Projekt der Notiz, Inhalt als Notiz und Checkliste der Aufgabe) */
    async noteToTask(noteId: string): Promise<ConvertResult> {
      commitEditors();
      const note = notes().find((n) => n.id === noteId);
      if (!note) return { ok: false };
      let rows: Awaited<ReturnType<typeof readBlocks>>;
      try {
        rows = await readBlocks(noteId);
      } catch {
        toast.error(
          "Der Inhalt der Notiz ließ sich nicht laden – bitte mit Verbindung erneut versuchen. Die Notiz bleibt, wie sie ist.",
        );
        return { ok: false };
      }
      const taskDone = (id: string) => {
        const status = tasks().find((t) => t.id === id)?.status;
        return status === undefined ? undefined : status === "erledigt";
      };
      const resolveTitle = (id: string) => notes().find((n) => n.id === id)?.title;
      const body = rowsToTaskBody(rows, { taskDone, resolveTitle });
      const task = taskActions.create({
        title: note.title,
        body,
        body_text: bodyTextOf(body, { resolveTitle }),
        area_id: note.area_id,
        project_id: note.project_id,
      });
      const restoreNote = noteActions.trashQuietly(noteId);
      finish({
        message: `„${noteTitle(note)}“ ist jetzt eine Aufgabe${lostSuffix(
          lostByNoteToTask(note, DEFAULT_NOTE_TYPE, {
            eventLinks: eventLinksOf("note_id", noteId),
            shared: isShared(noteId),
          }),
        )}`,
        newHref: appPath.task(task.id),
        oldHref: appPath.note(noteId),
        undo: () => {
          restoreNote?.();
          taskActions.trashQuietly(task.id);
        },
      });
      return { ok: true, id: task.id };
    },
  };
}

export type ConvertActions = ReturnType<typeof createConvertActions>;

/** Umwandeln für Menüs und Knöpfe: `taskToNote(id)` / `noteToTask(id)`. */
export function useConvert(): ConvertActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  const getSupabase = useSupabase();
  const taskActions = useTaskActions();
  const noteActions = useNoteActions();
  const noteTypes = useNoteTypes();
  const router = useRouter();
  const areas = useAreas().data;
  const activeArea = useUi((s) => s.area);
  return useMemo(
    () =>
      createConvertActions({
        queue,
        queryClient,
        getSupabase,
        taskActions,
        noteActions,
        fallbackAreaId: () => (areas?.find((a) => a.id === activeArea) ?? areas?.[0])?.id ?? null,
        noteType: preferredNoteType(DEFAULT_NOTE_TYPE, noteTypes.types),
        navigate: (href) => router.push(href),
        currentHref: () => `${window.location.pathname}${window.location.search}`,
      }),
    [
      queue,
      queryClient,
      getSupabase,
      taskActions,
      noteActions,
      noteTypes.types,
      router,
      areas,
      activeArea,
    ],
  );
}
