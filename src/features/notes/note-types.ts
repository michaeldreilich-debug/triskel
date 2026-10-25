"use client";

/**
 * Notiz-Typen selbst anlegen, umbenennen, löschen (#34, Migration 25) – „wie bei Notion“.
 * Lesen über `useNoteTypes`, Schreiben über die Warteschlange. Löschen fragt in der App nach dem
 * Zieltyp: Notizen (und Vorlagen) ziehen um, der Typ liegt im Papierkorb; „Rückgängig“ holt Typ
 * und Notizen zurück.
 */
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";
import { useMemo } from "react";
import { notifyWithUndo } from "@/components/ui/toast";
import { templatesKey } from "@/features/templates/api";
import type { TemplateRow } from "@/features/templates/types";
import { fetchAll } from "@/lib/data/fetch-all";
import { useSupabase } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import { RPC_NOTE_TYPE } from "@/lib/save-queue/supabase-persister";
import type { Supabase } from "@/lib/supabase/client";
import { notesKey } from "./api";
import {
  DEFAULT_NOTE_TYPE,
  DEFAULT_NOTE_TYPES,
  knowledgeTypeKeys,
  type NoteRow,
  type NoteType,
  type NoteTypeRow,
  noteTypeKey,
  noteTypeName,
  parseNoteType,
} from "./types";

/** Cache-Schlüssel = Tabellenname (Papierkorb lädt Zurückgeholtes darüber neu) */
export const noteTypesKey = ["note_types"] as const;

const bySort = (a: NoteTypeRow, b: NoteTypeRow) =>
  a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.key.localeCompare(b.key);

/** Alle Typen, auch gelöschte (deren Schlüssel bleiben belegt). */
export async function fetchNoteTypes(client: Supabase): Promise<NoteTypeRow[]> {
  const rows = await fetchAll<NoteTypeRow>(
    async (from, to) =>
      (await client
        .from("note_types")
        .select("id, key, name, sort, counts_as_knowledge, deleted_at")
        .order("sort")
        .order("id")
        .range(from, to)) as { data: NoteTypeRow[] | null; error: unknown },
  );
  return rows.map((row) => ({ ...row, key: parseNoteType(row.key) }));
}

/** Platzhalter, solange die eigenen Typen laden (die mitgelieferten). */
const FALLBACK: NoteTypeRow[] = DEFAULT_NOTE_TYPES.map((t, index) => ({
  id: `default-${t.key}`,
  key: t.key,
  name: t.name,
  sort: `a${index}`,
  counts_as_knowledge: t.countsAsKnowledge,
  deleted_at: null,
}));

export interface NoteTypes {
  /** aktive Typen in Reihenfolge */
  types: NoteTypeRow[];
  /** auch gelöschte (für eindeutige Schlüssel) */
  all: NoteTypeRow[];
  name: (key: NoteType) => string;
  /** Schlüssel der Typen, die als Wissen zählen (Migration 39) */
  knowledge: Set<NoteType>;
  loading: boolean;
}

export function useNoteTypes(): NoteTypes {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  const query = useQuery({
    queryKey: noteTypesKey,
    queryFn: async () =>
      (
        await fetchWithOverlay(queue, "note_types", () => fetchNoteTypes(getSupabase()), {
          include: () => true,
        })
      ).sort(bySort),
  });
  return useMemo(() => {
    const all = query.data ?? FALLBACK;
    const types = all.filter((t) => !t.deleted_at);
    return {
      types,
      all,
      name: (key: NoteType) => noteTypeName(types, key),
      knowledge: knowledgeTypeKeys(types),
      loading: query.isPending,
    };
  }, [query.data, query.isPending]);
}

export function createNoteTypeActions(queue: SaveQueue, queryClient: QueryClient) {
  const all = () => queryClient.getQueryData<NoteTypeRow[]>(noteTypesKey) ?? [];
  const setTypes = (update: (old: NoteTypeRow[]) => NoteTypeRow[]) =>
    queryClient.setQueryData<NoteTypeRow[]>(noteTypesKey, (old) => update(old ?? []).sort(bySort));
  /** Notizen und Vorlagen im Cache von einem Typ in einen anderen (wie die RPC) */
  const moveNotes = (ids: Set<string> | null, from: NoteType, to: NoteType) => {
    queryClient.setQueryData<NoteRow[]>(notesKey, (old) =>
      old?.map((n) => (n.type === from && (!ids || ids.has(n.id)) ? { ...n, type: to } : n)),
    );
  };

  return {
    /** Neuer Typ ans Ende; leerer Name: nichts. Liefert den Typ (auch für „anlegen und setzen“). */
    create(name: string): NoteTypeRow | null {
      const value = name.trim().slice(0, 40);
      if (!value) return null;
      // noch nicht geladen: die mitgelieferten zählen (sonst landete der neue Typ vorn)
      const known = all().length > 0 ? all() : FALLBACK;
      const existing = known.find(
        (t) => !t.deleted_at && t.name.toLocaleLowerCase("de") === value.toLocaleLowerCase("de"),
      );
      if (existing) return existing;
      const last = known.reduce<string | null>(
        (max, t) => (!max || t.sort > max ? t.sort : max),
        null,
      );
      const type: NoteTypeRow = {
        id: newId(),
        key: noteTypeKey(value, [...all().map((t) => t.key), ...FALLBACK.map((t) => t.key)]),
        name: value,
        sort: generateKeyBetween(last, null),
        counts_as_knowledge: false,
        deleted_at: null,
      };
      setTypes((old) => [...old, type]);
      queue.enqueue({
        table: "note_types",
        id: type.id,
        mode: "upsert",
        values: {
          key: type.key,
          name: type.name,
          sort: type.sort,
          counts_as_knowledge: false,
          deleted_at: null,
        },
      });
      return type;
    },

    rename(id: string, name: string) {
      const value = name.trim().slice(0, 40);
      if (!value) return;
      setTypes((old) => old.map((t) => (t.id === id ? { ...t, name: value } : t)));
      queue.enqueue({ table: "note_types", id, mode: "update", values: { name: value } });
    },

    /** „Zählt als Wissen“ je Typ ein-/ausschalten (Migration 39): Wissen zeigt danach die Notizen */
    setKnowledge(id: string, value: boolean) {
      setTypes((old) => old.map((t) => (t.id === id ? { ...t, counts_as_knowledge: value } : t)));
      queue.enqueue({
        table: "note_types",
        id,
        mode: "update",
        values: { counts_as_knowledge: value },
      });
    },

    /**
     * Löschen mit Zieltyp: Notizen und Vorlagen ziehen sofort um (Ansicht), gespeichert über
     * delete_note_type; „Rückgängig“ holt Typ, Notizen und Vorlagen zurück – auf dem Server auch
     * Notizen im Papierkorb, die die App nicht geladen hat (Migration 29, D-13).
     */
    remove(key: NoteType, target: NoteType) {
      const type = all().find((t) => t.key === key && !t.deleted_at);
      if (!type || key === DEFAULT_NOTE_TYPE || key === target) return;
      const moved = new Set(
        (queryClient.getQueryData<NoteRow[]>(notesKey) ?? [])
          .filter((n) => n.type === key)
          .map((n) => n.id),
      );
      const movedTemplates = new Set(
        (queryClient.getQueryData<TemplateRow[]>(templatesKey) ?? [])
          .filter((t) => t.note_type === key)
          .map((t) => t.id),
      );
      const deletedAt = new Date().toISOString();
      setTypes((old) => old.map((t) => (t.key === key ? { ...t, deleted_at: deletedAt } : t)));
      moveNotes(null, key, target);
      queryClient.setQueryData<TemplateRow[]>(templatesKey, (old) =>
        old?.map((t) => (t.note_type === key ? { ...t, note_type: target } : t)),
      );
      queue.enqueue({
        table: RPC_NOTE_TYPE,
        id: key,
        mode: "update",
        values: { action: "delete", p_target: target },
      });
      const targetName = noteTypeName(all(), target);
      notifyWithUndo(
        moved.size > 0
          ? `Typ „${type.name}“ gelöscht – ${moved.size === 1 ? "1 Notiz ist" : `${moved.size} Notizen sind`} jetzt „${targetName}“`
          : `Typ „${type.name}“ liegt im Papierkorb`,
        () => {
          setTypes((old) => old.map((t) => (t.key === key ? { ...t, deleted_at: null } : t)));
          moveNotes(moved, target, key);
          queryClient.setQueryData<TemplateRow[]>(templatesKey, (old) =>
            old?.map((t) => (movedTemplates.has(t.id) ? { ...t, note_type: key } : t)),
          );
          queue.enqueue({
            table: RPC_NOTE_TYPE,
            id: key,
            mode: "update",
            values: { action: "restore", p_note_ids: [...moved] },
          });
        },
      );
    },
  };
}

export type NoteTypeActions = ReturnType<typeof createNoteTypeActions>;

export function useNoteTypeActions(): NoteTypeActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(() => createNoteTypeActions(queue, queryClient), [queue, queryClient]);
}
