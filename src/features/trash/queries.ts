/**
 * Server-Abfrage des Papierkorbs (B13) – reine Funktion auf einem Supabase-Client (in der App aus
 * dem DataProvider, in Integrationstests als Testnutzer). Je Tabelle nur, was die Liste braucht.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { noteTypeName, parseNoteType } from "@/features/notes/types";
import { recapTitle } from "@/features/recaps/model";
import { TEMPLATE_KIND_LABELS, type TemplateKind } from "@/features/templates/types";
import { fetchAll } from "@/lib/data/fetch-all";
import { formatRange } from "@/lib/dates";
import type { Database } from "@/lib/supabase/database.types";
import { sortTrash, TRASH_TABLES, type TrashItem, type TrashTable } from "./model";

type Client = SupabaseClient<Database>;
type Row = Record<string, unknown> & { id: string; deleted_at: string };

const COLUMNS: Record<TrashTable, string> = {
  tasks: "id, title, area_id, project_id, in_inbox, deleted_at",
  notes: "id, title, area_id, topic_id, project_id, deleted_at",
  projects: "id, title, area_id, deleted_at",
  milestones: "id, title, project_id, deleted_at",
  topics: "id, name, area_id, deleted_at",
  recaps: "id, kind, period_start, period_end, deleted_at",
  templates: "id, name, kind, note_type, deleted_at",
  saved_views: "id, name, entity, area_id, deleted_at",
  note_types: "id, name, deleted_at",
  // nie die Adresse (Geheimnis) – nur Name
  calendar_sources: "id, name, deleted_at",
};

const str = (value: unknown) => (typeof value === "string" ? value : null);

function templateDetail(row: Row): string {
  const kind = TEMPLATE_KIND_LABELS[row.kind as TemplateKind] ?? "Vorlage";
  const type = str(row.note_type);
  return type ? `${kind} · ${noteTypeName([], parseNoteType(type))}` : kind;
}

function toItem(table: TrashTable, row: Row): TrashItem {
  const start = str(row.period_start) ?? "";
  return {
    table,
    id: row.id,
    title:
      table === "recaps"
        ? recapTitle({ kind: row.kind === "monat" ? "monat" : "woche", period_start: start })
        : (str(row.title) ?? str(row.name) ?? ""),
    deletedAt: row.deleted_at,
    areaId: str(row.area_id),
    projectId: str(row.project_id),
    topicId: str(row.topic_id),
    ...(table === "tasks" ? { inInbox: row.in_inbox === true } : {}),
    ...(table === "saved_views" ? { entity: str(row.entity) } : {}),
    ...(table === "recaps" ? { period: formatRange(start, str(row.period_end) ?? start) } : {}),
    ...(table === "templates" ? { detail: templateDetail(row) } : {}),
  };
}

async function fetchTable(client: Client, table: TrashTable): Promise<TrashItem[]> {
  const rows = await fetchAll<Row>(async (from, to) => {
    const result = await client
      .from(table)
      .select(COLUMNS[table])
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .order("id")
      .range(from, to);
    return result as unknown as { data: Row[] | null; error: unknown };
  });
  return rows.map((row) => toItem(table, row));
}

/** Alles mit deleted_at aus den Tabellen des Papierkorbs, neueste zuerst. */
export async function fetchTrash(
  client: Client,
  tables: readonly TrashTable[] = TRASH_TABLES,
): Promise<TrashItem[]> {
  const lists = await Promise.all(tables.map((table) => fetchTable(client, table)));
  return sortTrash(lists.flat());
}
