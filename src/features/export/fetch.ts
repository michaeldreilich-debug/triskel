/**
 * Daten für den Export (B14) frisch vom Server laden – alle Tabellen vollständig, auch der
 * Papierkorb (für export.json). Läuft im Browser mit der Sitzung des Nutzers (RLS + aal2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { toEventLink } from "@/features/calendar/links";
import { ATTACHMENT_BUCKET, collectFiles, exportFileName } from "@/features/notes/attachments";
import { collectImagePaths, imageFileName, NOTE_IMAGE_BUCKET } from "@/features/notes/images";
import { fetchMedia, type MediaBucketName } from "@/features/notes/media-api";
import { parseNoteType } from "@/features/notes/types";
import type { BlockRow } from "@/features/outliner/model/serializer";
import type { MilestoneRow } from "@/features/projects/types";
import { toRecap } from "@/features/recaps/model";
import { toProject, toTask } from "@/features/tasks/queries";
import { fetchAll } from "@/lib/data/fetch-all";
import type { Database } from "@/lib/supabase/database.types";
import { type ExportInput, type ExportNote, stripComputed } from "./vault";

type Client = SupabaseClient<Database>;
type Row = Record<string, unknown> & { id?: string };

/** Tabellen im Export (Reihenfolge = Reihenfolge in export.json). */
export const EXPORT_TABLES = [
  "user_settings",
  "areas",
  "topics",
  "projects",
  "milestones",
  "tasks",
  "task_dependencies",
  "notes",
  "note_blocks",
  "links",
  "task_note_links",
  "recaps",
  "templates",
  "saved_views",
  "ai_activity",
  "ai_clients",
  "note_types",
  "calendar_sources",
  // Termin-Verknüpfungen (#68): im Vault als „termin“ an Notiz und Aufgabe
  "event_links",
  // öffentliche Freigaben (#94): welche Notiz seit wann – ohne Token (siehe unten)
  "note_shares",
] as const;
type ExportTable = (typeof EXPORT_TABLES)[number];

/**
 * Spalten statt `*`, wo etwas nicht in den Export gehört: Die geheime iCal-Adresse einer
 * Kalenderquelle (Migration 30) bleibt in der Datenbank – wer sie hat, liest den Kalender. Ebenso
 * der Token einer öffentlichen Freigabe (Migration 45): wer ihn hat, liest die Notiz.
 */
const EXPORT_COLUMNS: Partial<Record<ExportTable, string>> = {
  calendar_sources:
    "id, user_id, kind, name, google_calendar_id, color, enabled, sort, created_at, updated_at, deleted_at",
  note_shares: "id, user_id, note_id, created_at, updated_at, revoked_at, deleted_at",
};

async function fetchTable(client: Client, table: ExportTable): Promise<Row[]> {
  const rows = await fetchAll<Row>(async (from, to) => {
    // stabil fürs Blättern: nach dem Primärschlüssel – bei task_dependencies (ohne id) die beiden
    // Aufgaben; created_at wäre nicht eindeutig, an der Seitengrenze fehlten Zeilen (T-11)
    const query = client.from(table).select(EXPORT_COLUMNS[table] ?? "*");
    const ordered =
      table === "task_dependencies"
        ? query.order("task_id").order("blocked_by_task_id")
        : query.order("id");
    const result = await ordered.range(from, to);
    return result as unknown as { data: Row[] | null; error: unknown };
  });
  return stripComputed(rows);
}

const str = (value: unknown) => (typeof value === "string" ? value : null);
const live = (rows: Row[]) => rows.filter((r) => !r.deleted_at);

export async function fetchExportData(client: Client, now = new Date()): Promise<ExportInput> {
  const entries = await Promise.all(
    EXPORT_TABLES.map(async (table) => [table, await fetchTable(client, table)] as const),
  );
  const tables = Object.fromEntries(entries) as Record<ExportTable, Row[]>;
  const notes: ExportNote[] = live(tables.notes).map((n) => ({
    id: String(n.id),
    title: str(n.title) ?? "",
    type: parseNoteType(str(n.type)),
    area_id: str(n.area_id) ?? "",
    topic_id: str(n.topic_id),
    project_id: str(n.project_id),
    task_id: str(n.task_id),
    tags: Array.isArray(n.tags) ? n.tags.map(String) : [],
    reviewed_at: str(n.reviewed_at),
    archived_at: str(n.archived_at),
    created_at: str(n.created_at) ?? now.toISOString(),
    updated_at: str(n.updated_at) ?? now.toISOString(),
  }));
  const blocks = live(tables.note_blocks) as unknown as Array<BlockRow & { note_id: string }>;
  const attachments = await fetchAttachments([
    ...blocks.map((b) => b.content),
    // Aufgaben-Notizen und der Freitext der Projekte (#44) können Bilder und Dateien enthalten
    ...live(tables.tasks).map((t) => t.body),
    ...live(tables.projects).map((p) => p.body),
  ]);
  return {
    attachments: attachments.loaded,
    missingAttachments: attachments.missing,
    areas: live(tables.areas).map((a) => ({
      id: String(a.id),
      name: str(a.name) ?? "",
      sort: str(a.sort) ?? "",
    })),
    topics: live(tables.topics).map((t) => ({
      id: String(t.id),
      area_id: str(t.area_id) ?? "",
      name: str(t.name) ?? "",
    })),
    projects: live(tables.projects).map((p) => toProject(p as Row & { id: string })),
    milestones: live(tables.milestones) as unknown as MilestoneRow[],
    tasks: live(tables.tasks).map((t) => toTask(t as Row & { id: string })),
    dependencies: live(tables.task_dependencies).map((d) => ({
      task_id: String(d.task_id),
      blocked_by_task_id: String(d.blocked_by_task_id),
    })),
    notes,
    blocks,
    recaps: live(tables.recaps).map((r) => toRecap(r as Row & { id: string })),
    eventLinks: live(tables.event_links).map((l) => toEventLink(l as Row & { id: string })),
    noteTypes: live(tables.note_types).map((t) => ({
      key: parseNoteType(str(t.key)),
      name: str(t.name) ?? "",
    })),
    tables,
    exportedAt: now,
  };
}

/** Höchstens so viele Downloads gleichzeitig (T-10: alle auf einmal überforderte das iPhone). */
export const EXPORT_DOWNLOADS_AT_ONCE = 4;

/** `tasks` mit höchstens `limit` gleichzeitig laufenden Aufrufen, Ergebnisse in Reihenfolge. */
export async function inBatches<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await (tasks[index] as () => Promise<T>)();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Bilder (E24) und Dateien (#27) aus Notizen und Aufgaben laden. Was sich nicht laden lässt,
 * fehlt im ZIP – und wird gezählt, damit die Meldung es nennt (T-10). Dateien heißen wie im
 * Markdown-Verweis (`exportFileName`).
 */
async function fetchAttachments(
  contents: unknown[],
): Promise<{ loaded: Array<{ name: string; data: Uint8Array }>; missing: number }> {
  const load = (bucket: MediaBucketName, path: string, name: string) => async () => {
    try {
      const blob = await fetchMedia(bucket, path);
      return { name, data: new Uint8Array(await blob.arrayBuffer()) };
    } catch {
      return null;
    }
  };
  const results = await inBatches(
    [
      ...collectImagePaths(contents).map((path) =>
        load(NOTE_IMAGE_BUCKET, path, imageFileName(path)),
      ),
      ...collectFiles(contents).map((file) =>
        load(ATTACHMENT_BUCKET, file.path, exportFileName(file.path, file.name)),
      ),
    ],
    EXPORT_DOWNLOADS_AT_ONCE,
  );
  const loaded = results.filter((a) => a !== null);
  return { loaded, missing: results.length - loaded.length };
}
