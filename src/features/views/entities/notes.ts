import type { AreaSummary } from "@/features/areas/defaults";
import { type NoteRow, type NoteTypeRow, noteTitle, type TopicRow } from "@/features/notes/types";
import type { ProjectRow } from "@/features/projects/types";
import type { FieldDef, ViewConfig } from "../engine";

export interface NoteViewCtx {
  areas: AreaSummary[];
  topics: TopicRow[];
  projects: ProjectRow[];
  /** Notiz-Typen des Nutzers (#34) in Reihenfolge */
  types: Pick<NoteTypeRow, "key" | "name" | "counts_as_knowledge">[];
}

export const NOTE_FIELDS: FieldDef<NoteRow, NoteViewCtx>[] = [
  {
    key: "title",
    label: "Titel",
    type: "text",
    value: (n) => noteTitle(n),
    sortable: true,
    column: true,
  },
  {
    key: "snippet",
    label: "Text",
    type: "text",
    value: (n) => n.snippet || null,
  },
  {
    key: "type",
    label: "Typ",
    type: "enum",
    value: (n) => n.type,
    options: (ctx) => ctx.types.map((t) => ({ value: t.key, label: t.name })),
    filterable: true,
    sortable: true,
    groupable: true,
    column: true,
  },
  {
    key: "area",
    label: "Bereich",
    type: "enum",
    value: (n) => n.area_id,
    options: (ctx) => ctx.areas.map((a) => ({ value: a.id, label: a.name })),
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    key: "topic",
    label: "Thema",
    type: "enum",
    value: (n) => n.topic_id ?? "",
    options: (ctx) => [
      ...[...ctx.topics]
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .map((t) => ({ value: t.id, label: t.name })),
      { value: "", label: "Ohne Thema" },
    ],
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    key: "project",
    label: "Projekt",
    type: "enum",
    value: (n) => n.project_id ?? "",
    options: (ctx) => [
      ...[...ctx.projects]
        .sort((a, b) => a.title.localeCompare(b.title, "de"))
        .map((p) => ({ value: p.id, label: p.title.trim() || "Ohne Titel" })),
      { value: "", label: "Ohne Projekt" },
    ],
    // #81: Notizen ohne Projekt stehen in Liste und Tabelle oben (wie Aufgaben, #79)
    groupOrder: [""],
    filterable: true,
    groupable: true,
    column: true,
  },
  {
    key: "tags",
    label: "Tags",
    type: "text",
    value: (n) => (n.tags.length ? n.tags.map((t) => `#${t}`).join(" ") : null),
    column: true,
  },
  {
    key: "reviewed_at",
    label: "Geprüft am",
    type: "date",
    value: (n) => n.reviewed_at,
    filterable: true,
    sortable: true,
    column: true,
  },
  {
    key: "edited_at",
    label: "Zuletzt bearbeitet",
    type: "timestamp",
    value: (n) => n.edited_at,
    sortable: true,
    column: true,
  },
  {
    key: "created_at",
    label: "Erstellt",
    type: "timestamp",
    value: (n) => n.created_at,
    sortable: true,
  },
];

export const NOTE_BOARD_FIELDS = ["type", "area"];

export const NOTE_DEFAULTS: ViewConfig = {
  type: "liste",
  filters: [],
  sort: { field: "edited_at", dir: "desc" },
  // #48: Die Arbeit läuft über das Projekt – nach Projekt gruppiert
  group: "project",
  board: "type",
  columns: ["title", "type", "topic", "tags", "edited_at"],
};
