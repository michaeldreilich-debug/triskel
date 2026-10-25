import type { NoteType } from "@/features/notes/types";

/** Vorlagen (Migration 06): Projekt, Notiz (je Notiz-Typ) und Rückblick. */
export const TEMPLATE_KINDS = ["projekt", "notiz", "rueckblick"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  projekt: "Projekt",
  notiz: "Notiz",
  rueckblick: "Rückblick",
};

export interface TemplateRow {
  id: string;
  kind: TemplateKind;
  /** nur Notiz-Vorlagen: für welchen Typ (null = alle) */
  note_type: NoteType | null;
  name: string;
  body: Record<string, unknown>;
  /** stabiler Schlüssel der mitgelieferten Vorlagen (null bei eigenen) */
  seed_key: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type TemplateWrite = Pick<
  TemplateRow,
  "kind" | "note_type" | "name" | "body" | "deleted_at"
>;

export const templateName = (template: Pick<TemplateRow, "name"> | undefined) =>
  template?.name.trim() ? template.name : "Ohne Namen";
