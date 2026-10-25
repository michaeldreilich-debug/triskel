/**
 * Papierkorb (B13) als reine Logik: Einträge aus allen Tabellen mit `deleted_at`, neueste zuerst,
 * mit Vorrang des lokalen Stands (zurückgeholt oder endgültig gelöscht, aber noch nicht gespeichert).
 */
import type { SaveOp } from "@/lib/save-queue/save-queue";
import { RPC_EMPTY_TRASH } from "@/lib/save-queue/supabase-persister";

/** Was im Papierkorb erscheint. */
export const TRASH_TABLES = [
  "tasks",
  "notes",
  "projects",
  "milestones",
  "topics",
  "recaps",
  "templates",
  "saved_views",
  "note_types",
  "calendar_sources",
] as const;
export type TrashTable = (typeof TRASH_TABLES)[number];

export const TRASH_KIND_LABELS: Record<TrashTable, string> = {
  tasks: "Aufgabe",
  notes: "Notiz",
  projects: "Projekt",
  milestones: "Meilenstein",
  topics: "Thema",
  recaps: "Rückblick",
  templates: "Vorlage",
  saved_views: "Ansicht",
  note_types: "Notiz-Typ",
  calendar_sources: "Kalender",
};

export interface TrashItem {
  table: TrashTable;
  id: string;
  /** Titel bzw. Name, wie gespeichert (kann leer sein) */
  title: string;
  deletedAt: string;
  areaId: string | null;
  projectId: string | null;
  topicId: string | null;
  /** nur Aufgaben: lag in der Inbox */
  inInbox?: boolean;
  /** nur Ansichten: Datenbank (tasks, notes, projects) */
  entity?: string | null;
  /** nur Rückblicke: Zeitraum („12.–18.10.2026“) */
  period?: string;
  /** nur Vorlagen: Art („Projekt“, „Notiz · Protokoll“) */
  detail?: string;
}

export const trashTitle = (item: Pick<TrashItem, "title">) => item.title.trim() || "Ohne Titel";

/** Neueste zuerst, bei gleichem Zeitpunkt stabil. */
export function sortTrash(items: TrashItem[]): TrashItem[] {
  return [...items].sort(
    (a, b) =>
      Date.parse(b.deletedAt) - Date.parse(a.deletedAt) ||
      a.table.localeCompare(b.table) ||
      a.id.localeCompare(b.id),
  );
}

const keyOf = (table: string, id: string) => `${table}:${id}`;

/**
 * Lokaler Stand hat Vorrang: Was schon zurückgeholt (deleted_at = null) oder endgültig gelöscht
 * wurde, aber noch in der Warteschlange steht, erscheint nicht mehr.
 */
export function applyPendingTrashOps(items: TrashItem[], ops: SaveOp[]): TrashItem[] {
  const purged = new Set<string>();
  const restored = new Set<string>();
  // in Reihenfolge: spätere Ops gewinnen (zurückgeholt, dann erneut gelöscht → wieder sichtbar)
  for (const op of ops) {
    if (op.table === RPC_EMPTY_TRASH) purged.add(keyOf(String(op.values.entity), op.id));
    else if (op.values.deleted_at === null) restored.add(keyOf(op.table, op.id));
    else if (typeof op.values.deleted_at === "string") restored.delete(keyOf(op.table, op.id));
  }
  if (purged.size === 0 && restored.size === 0) return items;
  return items.filter((item) => {
    const key = keyOf(item.table, item.id);
    return !purged.has(key) && !restored.has(key);
  });
}

/** Suche im Papierkorb: Teilwort im Titel, Groß/klein egal. */
export function matchesTrashQuery(item: TrashItem, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("de");
  return !q || trashTitle(item).toLocaleLowerCase("de").includes(q);
}

/**
 * Was beim Wiederherstellen mitkommt: Ein Meilenstein ist nur auf seiner Projektseite sichtbar –
 * liegt das Projekt auch im Papierkorb, kommt es mit zurück. Alles andere kommt allein zurück
 * (eine Aufgabe eines gelöschten Projekts erscheint dann in ihrem Bereich).
 */
export function restoreTargets(item: TrashItem, items: TrashItem[]): TrashItem[] {
  if (item.table === "milestones" && item.projectId) {
    const project = items.find((i) => i.table === "projects" && i.id === item.projectId);
    if (project) return [item, project];
  }
  return [item];
}

/** Hinweis vor dem endgültigen Löschen: was sonst noch passiert (Fremdschlüssel, Migrationen 03–05). */
export function purgeNote(table: TrashTable): string | null {
  switch (table) {
    case "projects":
      return "Seine Meilensteine gehen mit, Aufgaben und Notizen bleiben (ohne Projekt).";
    case "notes":
      return "Samt Inhalt; Verweise auf die Notiz verschwinden.";
    case "topics":
      return "Notizen des Themas bleiben (ohne Thema).";
    case "milestones":
      return "Aufgaben bleiben (ohne Meilenstein).";
    default:
      return null;
  }
}
