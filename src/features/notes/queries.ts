/**
 * Server-Abfragen für Notizen, Themen, Blöcke und Rückverweise – reine Funktionen auf einem
 * Supabase-Client (in der App aus dem DataProvider, in Integrationstests als Testnutzer).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlockRow } from "@/features/outliner/model/serializer";
import { fetchAll } from "@/lib/data/fetch-all";
import type { Database } from "@/lib/supabase/database.types";
import type { NoteRow, TopicRow } from "./types";

type Client = SupabaseClient<Database>;

const NOTE_COLUMNS =
  "id, title, type, area_id, topic_id, project_id, task_id, tags, reviewed_at, archived_at, created_at, updated_at, deleted_at";

export type ServerNote = Omit<NoteRow, "type"> & { type: string };
type NoteWithBlocks = Omit<ServerNote, "snippet" | "edited_at"> & {
  first?: Array<{ content_text: string }>;
  last?: Array<{ updated_at: string }>;
};

/** Späterer von zwei Zeitstempeln (unterschiedliche ISO-Schreibweisen, daher über Date). */
export function laterTimestamp(a: string, b: string | undefined): string {
  return b && Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Alle Notizen (ohne Papierkorb) samt Text des ersten Blocks als Vorschau und dem zuletzt
 * geänderten Block (auch gelöschte: Löschen ist eine Bearbeitung) für „zuletzt bearbeitet“.
 */
export async function fetchNotes(client: Client): Promise<ServerNote[]> {
  const rows = await fetchAll<NoteWithBlocks>(async (from, to) => {
    const result = await client
      .from("notes")
      .select(
        `${NOTE_COLUMNS}, first:note_blocks!note_blocks_note_id_fkey(content_text), last:note_blocks!note_blocks_note_id_fkey(updated_at)`,
      )
      .is("deleted_at", null)
      .is("first.parent_id", null)
      .is("first.deleted_at", null)
      .order("sort", { referencedTable: "first" })
      .limit(1, { referencedTable: "first" })
      .order("updated_at", { referencedTable: "last", ascending: false })
      .limit(1, { referencedTable: "last" })
      .order("id")
      .range(from, to);
    return result as unknown as { data: NoteWithBlocks[] | null; error: unknown };
  });
  return rows.map(({ first, last, ...note }) => ({
    ...note,
    snippet: first?.[0]?.content_text ?? "",
    edited_at: laterTimestamp(note.updated_at, last?.[0]?.updated_at),
  }));
}

export async function fetchTopics(client: Client): Promise<TopicRow[]> {
  return fetchAll<TopicRow>(async (from, to) =>
    client
      .from("topics")
      .select("id, area_id, name, sort, archived_at, deleted_at")
      .is("deleted_at", null)
      .order("sort")
      .order("id")
      .range(from, to),
  );
}

export type ServerBlock = BlockRow & { note_id: string };

/** Blöcke einer Notiz (ohne Papierkorb). */
export async function fetchNoteBlocks(client: Client, noteId: string): Promise<ServerBlock[]> {
  return fetchAll<ServerBlock>(async (from, to) => {
    const result = await client
      .from("note_blocks")
      .select("id, note_id, parent_id, sort, content, content_text, collapsed, task_id")
      .eq("note_id", noteId)
      .is("deleted_at", null)
      .order("sort")
      .order("id")
      .range(from, to);
    return result as unknown as { data: ServerBlock[] | null; error: unknown };
  });
}

export interface Backlink {
  noteId: string;
  /** Anzahl der verlinkenden Blöcke */
  count: number;
}

/** Rückverweise: Notizen, deren (nicht gelöschte) Blöcke per [[Link]] hierher zeigen. */
export async function fetchBacklinks(client: Client, noteId: string): Promise<Backlink[]> {
  const { data, error } = await client
    .from("links")
    .select("source_note_id")
    .eq("target_note_id", noteId)
    .is("deleted_at", null);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const link of data) {
    counts.set(link.source_note_id, (counts.get(link.source_note_id) ?? 0) + 1);
  }
  return [...counts].map(([id, count]) => ({ noteId: id, count }));
}

/** Rückverweise aus Aufgaben: IDs der Aufgaben, deren Notiz per „((“ hierher zeigt. */
export async function fetchTaskBacklinks(client: Client, noteId: string): Promise<string[]> {
  const { data, error } = await client
    .from("task_note_links")
    .select("task_id")
    .eq("target_note_id", noteId)
    .is("deleted_at", null);
  if (error) throw error;
  return [...new Set(data.map((link) => link.task_id))];
}
