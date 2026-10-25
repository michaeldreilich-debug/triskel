"use client";

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";
import { useMemo } from "react";
import type { BlockRow } from "@/features/outliner/model/serializer";
import { useSupabase } from "@/lib/data/provider";
import { fetchWithOverlay, overlayUnconfirmed } from "@/lib/data/unconfirmed";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import { restoreDeleted, softDelete, trashWithUndo } from "@/lib/save-queue/soft-delete";
import type { Supabase } from "@/lib/supabase/client";
import {
  fetchBacklinks,
  fetchNoteBlocks,
  fetchNotes,
  fetchTaskBacklinks,
  fetchTopics,
  type ServerNote,
} from "./queries";
import {
  type NoteRow,
  type NoteWrite,
  normalizeTags,
  noteTitle,
  parseNoteType,
  type TopicRow,
} from "./types";

export const notesKey = ["notes"] as const;
export const topicsKey = ["topics"] as const;
export const noteBlocksKey = (noteId: string) => ["note-blocks", noteId] as const;
export const backlinksKey = (noteId: string) => ["backlinks", noteId] as const;

/** Datensatz aus Server oder Warteschlange in eine vollständige Zeile bringen. */
function toNote(row: Partial<ServerNote> & { id: string }): NoteRow {
  const now = new Date().toISOString();
  return {
    id: row.id,
    title: row.title ?? "",
    type: parseNoteType(row.type),
    area_id: row.area_id ?? "",
    topic_id: row.topic_id ?? null,
    project_id: row.project_id ?? null,
    task_id: row.task_id ?? null,
    tags: row.tags ?? [],
    reviewed_at: row.reviewed_at ?? null,
    archived_at: row.archived_at ?? null,
    created_at: row.created_at ?? now,
    updated_at: row.updated_at ?? now,
    deleted_at: row.deleted_at ?? null,
    edited_at: row.edited_at ?? row.updated_at ?? now,
    snippet: row.snippet ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Lesen                                                              */
/* ------------------------------------------------------------------ */

/**
 * Alle Notizen des Nutzers (ohne Papierkorb) – eine Quelle für Liste, [[-Autocomplete,
 * Titel-Auflösung und Rückverweise. Gefiltert wird im Client (Bereich, Thema, Typ).
 */
export function useNotes() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: notesKey,
    queryFn: async () => {
      const notes = (
        await fetchWithOverlay(queue, "notes", () => fetchNotes(getSupabase()), {
          include: () => true,
        })
      ).map(toNote);
      return withUnconfirmedEdits(notes, queue.unconfirmedOps());
    },
  });
}

/**
 * Noch nicht gespeicherte Text-Änderungen (z. B. nach dem Neuladen aus dem lokalen Speicher
 * wiederhergestellt) zählen als „zuletzt bearbeitet = jetzt“ – sonst stünde die Notiz in
 * „Neueste zuerst“ zu weit unten, bis die Änderung gespeichert und neu geladen ist.
 */
export function withUnconfirmedEdits(notes: NoteRow[], ops: SaveOp[], now = new Date()) {
  const edited = new Set(
    ops
      .filter((op) => op.table === "note_blocks" && typeof op.values.note_id === "string")
      .map((op) => op.values.note_id as string),
  );
  if (edited.size === 0) return notes;
  const stamp = now.toISOString();
  return notes.map((note) =>
    edited.has(note.id) && Date.parse(note.edited_at) < now.getTime()
      ? { ...note, edited_at: stamp }
      : note,
  );
}

export function useTopics() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: topicsKey,
    queryFn: async () =>
      (
        await fetchWithOverlay(queue, "topics", () => fetchTopics(getSupabase()), {
          include: () => true,
        })
      ).sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)),
  });
}

export interface NoteBlocksResult {
  rows: BlockRow[];
  /** Blöcke mit noch nicht bestätigten lokalen Änderungen (lokaler Stand hat Vorrang) */
  unconfirmed: number;
}

/**
 * Blöcke einer Notiz vom Server, darüber der lokale, noch nicht bestätigte Stand
 * (`fetchWithOverlay`). Auch für das Umwandeln in eine Aufgabe (#65).
 */
export async function loadNoteBlocks(
  queue: SaveQueue,
  client: Supabase,
  noteId: string,
): Promise<NoteBlocksResult> {
  const belongs = (row: { note_id?: unknown }) => row.note_id === noteId;
  let ids = new Set<string>();
  const rows = await fetchWithOverlay(
    queue,
    "note_blocks",
    async () => {
      const data = await fetchNoteBlocks(client, noteId);
      ids = new Set(data.map((row) => row.id));
      return data;
    },
    { include: belongs },
  );
  const unconfirmed = queue
    .unconfirmedOps()
    .filter(
      (op) => op.table === "note_blocks" && (op.values.note_id === noteId || ids.has(op.id)),
    ).length;
  return { rows: rows.filter(belongs), unconfirmed };
}

/**
 * Zeilen für den Editor, wenn das Neuladen beim Wiederöffnen scheiterte (V-5): der Cache vom
 * letzten Mal, darüber alles, was die Warteschlange für diese Notiz noch unbestätigt hält – sonst
 * diffte der Editor gegen den alten Stand und schickte Upserts, die das Wartende überschreiben.
 */
export function blocksAfterLoadError(
  queue: Pick<SaveQueue, "unconfirmedOps">,
  cached: NoteBlocksResult,
  noteId: string,
): NoteBlocksResult {
  const belongs = (row: { note_id?: unknown }) => row.note_id === noteId;
  const known = new Set(cached.rows.map((row) => row.id));
  const rows = overlayUnconfirmed(
    queue,
    "note_blocks",
    cached.rows as Array<BlockRow & { note_id?: string }>,
    { include: belongs },
  )
    .filter((row) => (row as { note_id?: unknown }).note_id === undefined || belongs(row))
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  const unconfirmed = queue
    .unconfirmedOps()
    .filter(
      (op) => op.table === "note_blocks" && (op.values.note_id === noteId || known.has(op.id)),
    ).length;
  return { rows: rows as BlockRow[], unconfirmed };
}

/**
 * Blöcke einer Notiz – bei jedem Öffnen frisch vom Server (der Editor übernimmt den Inhalt nur
 * beim Einhängen), darüber der lokale, noch nicht bestätigte Stand.
 */
export function useNoteBlocks(noteId: string) {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: noteBlocksKey(noteId),
    staleTime: 0,
    gcTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () => loadNoteBlocks(queue, getSupabase(), noteId),
  });
}

/** Rückverweise (Trigger → links); nach jedem Speichern von Blöcken neu geladen. */
export function useBacklinks(noteId: string) {
  const getSupabase = useSupabase();
  return useQuery({
    queryKey: backlinksKey(noteId),
    staleTime: 0,
    queryFn: () => fetchBacklinks(getSupabase(), noteId),
  });
}

/** Aufgaben, deren Notiz hierher verlinkt (Trigger → task_note_links). */
export function useTaskBacklinks(noteId: string) {
  const getSupabase = useSupabase();
  return useQuery({
    queryKey: [...backlinksKey(noteId), "tasks"],
    staleTime: 0,
    queryFn: () => fetchTaskBacklinks(getSupabase(), noteId),
  });
}

/* ------------------------------------------------------------------ */
/* Schreiben (optimistisch, über die Speicher-Warteschlange)          */
/* ------------------------------------------------------------------ */

function writeValues(note: NoteRow): NoteWrite {
  return {
    title: note.title,
    type: note.type,
    area_id: note.area_id,
    topic_id: note.topic_id,
    project_id: note.project_id,
    task_id: note.task_id,
    tags: note.tags,
    reviewed_at: note.reviewed_at,
    archived_at: note.archived_at,
    deleted_at: note.deleted_at,
  };
}

const nowIso = () => new Date().toISOString();

function patchNotes(queryClient: QueryClient, id: string, patch: Partial<NoteRow>) {
  queryClient.setQueryData<NoteRow[]>(notesKey, (old) =>
    old?.map((note) =>
      note.id === id ? { ...note, ...patch, updated_at: nowIso(), edited_at: nowIso() } : note,
    ),
  );
}

export function createNoteActions(queue: SaveQueue, queryClient: QueryClient) {
  const topics = () => queryClient.getQueryData<TopicRow[]>(topicsKey) ?? [];

  const update = (id: string, values: Partial<NoteWrite>) => {
    const patch: Partial<NoteWrite> = { ...values };
    // Bereich folgt dem Thema (wie der DB-Trigger notes_derive_area)
    if (patch.topic_id) {
      const topic = topics().find((t) => t.id === patch.topic_id);
      if (topic) patch.area_id = topic.area_id;
    }
    if (patch.tags) patch.tags = normalizeTags(patch.tags);
    patchNotes(queryClient, id, patch);
    queue.enqueue({ table: "notes", id, mode: "update", values: patch });
  };

  return {
    create(input: Partial<NoteWrite> & { area_id: string }): NoteRow {
      const topic = input.topic_id ? topics().find((t) => t.id === input.topic_id) : undefined;
      const note = toNote({
        ...input,
        id: newId(),
        area_id: topic?.area_id ?? input.area_id,
        tags: normalizeTags(input.tags ?? []),
      });
      queryClient.setQueryData<NoteRow[]>(notesKey, (old) => [...(old ?? []), note]);
      queue.enqueue({ table: "notes", id: note.id, mode: "upsert", values: writeValues(note) });
      return note;
    },

    update,

    /** Text der Notiz wurde bearbeitet: nur lokal „zuletzt bearbeitet“ setzen (Server: Blöcke) */
    touch(id: string) {
      queryClient.setQueryData<NoteRow[]>(notesKey, (old) =>
        old?.map((note) => (note.id === id ? { ...note, edited_at: nowIso() } : note)),
      );
    },

    /** Inline-Tags aus dem Outliner nur ergänzen, nie entfernen (E14, wie der DB-Trigger) */
    mergeInlineTags(id: string, inline: string[]) {
      const note = queryClient.getQueryData<NoteRow[]>(notesKey)?.find((n) => n.id === id);
      if (!note) return;
      const merged = normalizeTags([...note.tags, ...inline]);
      if (merged.length !== note.tags.length) patchNotes(queryClient, id, { tags: merged });
    },

    /**
     * In den Papierkorb ohne eigene Meldung (Umwandeln in eine Aufgabe, #65): gibt die Umkehrung
     * zurück. null = nicht gefunden.
     */
    trashQuietly(id: string): (() => void) | null {
      const note = queryClient.getQueryData<NoteRow[]>(notesKey)?.find((n) => n.id === id);
      if (!note) return null;
      softDelete(queue, "notes", id);
      queryClient.setQueryData<NoteRow[]>(notesKey, (old) => old?.filter((n) => n.id !== id));
      return () => {
        restoreDeleted(queue, "notes", id);
        queryClient.setQueryData<NoteRow[]>(notesKey, (old) =>
          old?.some((n) => n.id === id) ? old : [...(old ?? []), note],
        );
      };
    },

    /** In den Papierkorb (Soft-Delete) mit „Rückgängig“ (E8) */
    trash(id: string, onTrashed?: () => void) {
      const note = queryClient.getQueryData<NoteRow[]>(notesKey)?.find((n) => n.id === id);
      if (!note) return;
      trashWithUndo(queue, queryClient, {
        table: "notes",
        queryKey: notesKey,
        row: note,
        message: `„${noteTitle(note)}“ liegt im Papierkorb`,
        onTrashed,
      });
    },
  };
}

export type NoteActions = ReturnType<typeof createNoteActions>;

export function useNoteActions() {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(() => createNoteActions(queue, queryClient), [queue, queryClient]);
}

export function createTopicActions(queue: SaveQueue, queryClient: QueryClient) {
  const list = () => queryClient.getQueryData<TopicRow[]>(topicsKey) ?? [];
  const patch = (id: string, values: Partial<TopicRow>) =>
    queryClient.setQueryData<TopicRow[]>(topicsKey, (old) =>
      old?.map((t) => (t.id === id ? { ...t, ...values } : t)),
    );
  return {
    create(areaId: string, name: string): TopicRow {
      const inArea = list().filter((t) => t.area_id === areaId);
      const last = inArea.reduce<string | null>(
        (max, t) => (!max || t.sort > max ? t.sort : max),
        null,
      );
      const topic: TopicRow = {
        id: newId(),
        area_id: areaId,
        name: name.trim(),
        sort: generateKeyBetween(last, null),
        archived_at: null,
        deleted_at: null,
      };
      queryClient.setQueryData<TopicRow[]>(topicsKey, (old) => [...(old ?? []), topic]);
      queue.enqueue({
        table: "topics",
        id: topic.id,
        mode: "upsert",
        values: { area_id: topic.area_id, name: topic.name, sort: topic.sort, deleted_at: null },
      });
      return topic;
    },
    rename(id: string, name: string) {
      const value = name.trim();
      if (!value) return;
      patch(id, { name: value });
      queue.enqueue({ table: "topics", id, mode: "update", values: { name: value } });
    },
    trash(id: string) {
      const topic = list().find((t) => t.id === id);
      if (!topic) return;
      trashWithUndo(queue, queryClient, {
        table: "topics",
        queryKey: topicsKey,
        row: topic,
        message: `Thema „${topic.name}“ liegt im Papierkorb`,
      });
    },
  };
}

export function useTopicActions() {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(() => createTopicActions(queue, queryClient), [queue, queryClient]);
}
