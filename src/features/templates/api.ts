"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { type NoteType, parseNoteType } from "@/features/notes/types";
import type { ProjectActions } from "@/features/projects/api";
import type { ProjectRow, ProjectWrite } from "@/features/projects/types";
import type { TaskActions } from "@/features/tasks/api";
import { fetchAll } from "@/lib/data/fetch-all";
import { useSupabase } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import { trashWithUndo } from "@/lib/save-queue/soft-delete";
import type { Database } from "@/lib/supabase/database.types";
import { parseProjectTemplate } from "./model";
import {
  TEMPLATE_KINDS,
  type TemplateKind,
  type TemplateRow,
  type TemplateWrite,
  templateName,
} from "./types";

export const templatesKey = ["templates"] as const;

const TEMPLATE_COLUMNS =
  "id, kind, note_type, name, body, seed_key, created_at, updated_at, deleted_at";

export function toTemplate(row: Record<string, unknown> & { id: string }): TemplateRow {
  const now = new Date().toISOString();
  const str = (value: unknown) => (typeof value === "string" ? value : null);
  const kind = str(row.kind);
  return {
    id: row.id,
    kind: (TEMPLATE_KINDS as readonly string[]).includes(kind ?? "")
      ? (kind as TemplateKind)
      : "notiz",
    note_type: row.note_type ? parseNoteType(str(row.note_type)) : null,
    name: str(row.name) ?? "",
    body:
      typeof row.body === "object" && row.body !== null && !Array.isArray(row.body)
        ? (row.body as Record<string, unknown>)
        : {},
    seed_key: str(row.seed_key),
    created_at: str(row.created_at) ?? now,
    updated_at: str(row.updated_at) ?? now,
    deleted_at: str(row.deleted_at),
  };
}

/** Alle Vorlagen (ohne Papierkorb). */
export async function fetchTemplates(
  client: SupabaseClient<Database>,
): Promise<Array<Record<string, unknown> & { id: string }>> {
  return fetchAll(async (from, to) => {
    const result = await client
      .from("templates")
      .select(TEMPLATE_COLUMNS)
      .is("deleted_at", null)
      .order("created_at")
      .order("id")
      .range(from, to);
    return result as unknown as {
      data: Array<Record<string, unknown> & { id: string }> | null;
      error: unknown;
    };
  });
}

/** Mitgelieferte zuerst, dann eigene nach Anlagedatum. */
export function sortTemplates(list: TemplateRow[]): TemplateRow[] {
  return [...list].sort(
    (a, b) =>
      Number(b.seed_key !== null) - Number(a.seed_key !== null) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

export function useTemplates() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: templatesKey,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      sortTemplates(
        (
          await fetchWithOverlay(queue, "templates", () => fetchTemplates(getSupabase()), {
            include: () => true,
          })
        ).map(toTemplate),
      ),
  });
}

/* ------------------------------------------------------------------ */
/* Schreiben (optimistisch, über die Speicher-Warteschlange)          */
/* ------------------------------------------------------------------ */

const nowIso = () => new Date().toISOString();

export function createTemplateActions(queue: SaveQueue, queryClient: QueryClient) {
  const list = () => queryClient.getQueryData<TemplateRow[]>(templatesKey) ?? [];
  const patch = (id: string, values: Partial<TemplateRow>) =>
    queryClient.setQueryData<TemplateRow[]>(templatesKey, (old) =>
      old?.map((t) => (t.id === id ? { ...t, ...values, updated_at: nowIso() } : t)),
    );

  return {
    create(input: Pick<TemplateWrite, "kind" | "name" | "body"> & Partial<TemplateWrite>) {
      const template = toTemplate({
        note_type: null,
        ...(input as Record<string, unknown>),
        id: newId(),
        seed_key: null,
        created_at: nowIso(),
      });
      queryClient.setQueryData<TemplateRow[]>(templatesKey, (old) => [...(old ?? []), template]);
      const values: TemplateWrite = {
        kind: template.kind,
        note_type: template.kind === "notiz" ? template.note_type : null,
        name: template.name,
        body: template.body,
        deleted_at: null,
      };
      queue.enqueue({ table: "templates", id: template.id, mode: "upsert", values: { ...values } });
      return template;
    },

    update(id: string, values: Partial<TemplateWrite>) {
      patch(id, values);
      queue.enqueue({ table: "templates", id, mode: "update", values: { ...values } });
    },

    trash(id: string) {
      const template = list().find((t) => t.id === id);
      if (!template) return;
      trashWithUndo(queue, queryClient, {
        table: "templates",
        queryKey: templatesKey,
        row: template,
        message: `Vorlage „${templateName(template)}“ liegt im Papierkorb`,
        restore: (rows, row) => sortTemplates([...rows, row]),
      });
    },
  };
}

export type TemplateActions = ReturnType<typeof createTemplateActions>;

export function useTemplateActions(): TemplateActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(() => createTemplateActions(queue, queryClient), [queue, queryClient]);
}

/**
 * Beim Anlegen gewählte Vorlage einer Notiz (z. B. „Neues Protokoll“): Die Notizansicht wendet sie
 * an, sobald der Editor bereit und die Notiz leer ist – über den Editor, damit der Inhalt wie
 * jede Eingabe gespeichert wird. Nur im Speicher dieser Sitzung.
 */
export const pendingTemplateKey = (noteId: string) => ["note-template", noteId] as const;

export function rememberNoteTemplate(
  queryClient: QueryClient,
  noteId: string,
  template: TemplateRow,
) {
  queryClient.setQueryData(pendingTemplateKey(noteId), template.id);
}

/**
 * Wie `rememberNoteTemplate`, aber nur der Typ (#68, Notiz zum Termin): Sind die Vorlagen beim
 * Anlegen noch nicht geladen, sucht die Notizansicht die Vorlage des Typs, sobald sie da sind.
 */
export function rememberNoteTemplateOfType(
  queryClient: QueryClient,
  noteId: string,
  type: NoteType,
) {
  queryClient.setQueryData(pendingTemplateKey(noteId), `${PENDING_TYPE}${type}`);
}

const PENDING_TYPE = "typ:";

/** Vorgemerkte Vorlage auflösen (ID oder „typ:<Schlüssel>“), undefined = (noch) keine. */
export function pendingTemplate(
  templates: TemplateRow[] | undefined,
  pending: string,
): TemplateRow | undefined {
  if (!templates) return undefined;
  return pending.startsWith(PENDING_TYPE)
    ? autoNoteTemplate(templates, pending.slice(PENDING_TYPE.length) as NoteType)
    : templates.find((t) => t.id === pending);
}

/** Notiz-Vorlagen für einen Notiz-Typ: passende zuerst, dann die für alle Typen. */
export function noteTemplatesFor(templates: TemplateRow[], type: NoteType | null) {
  const notes = templates.filter((t) => t.kind === "notiz");
  return [
    ...notes.filter((t) => type !== null && t.note_type === type),
    ...notes.filter((t) => t.note_type === null),
    ...notes.filter((t) => t.note_type !== null && t.note_type !== type),
  ];
}

/** Die Vorlage, die beim Anlegen einer Notiz dieses Typs automatisch greift (genau passender Typ). */
export const autoNoteTemplate = (templates: TemplateRow[], type: NoteType) =>
  templates.find((t) => t.kind === "notiz" && t.note_type === type);

/** Projekt-Vorlage anwenden: Warum, Ergebnis-Punkte, Meilensteine und Aufgaben. */
export function applyProjectTemplate(
  project: ProjectRow,
  template: TemplateRow,
  projectActions: ProjectActions,
  taskActions: TaskActions,
) {
  const t = parseProjectTemplate(template.body);
  const values: Partial<ProjectWrite> = {};
  if (t.why.trim() && !project.why.trim()) values.why = t.why;
  if (t.outcome.length) {
    const kept = project.outcome.filter((o) => o.text.trim());
    values.outcome = [...kept, ...t.outcome.map((text) => ({ id: newId(), text, done: false }))];
  }
  if (Object.keys(values).length) projectActions.update(project.id, values);
  for (const title of t.milestones) projectActions.createMilestone(project.id, title);
  for (const title of t.tasks) {
    taskActions.create({
      title,
      project_id: project.id,
      area_id: project.area_id,
      in_inbox: false,
    });
  }
}
