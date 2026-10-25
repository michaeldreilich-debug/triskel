"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { appPath } from "@/lib/app-links";
import { fetchAll } from "@/lib/data/fetch-all";
import { useSupabase } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import { trashWithUndo } from "@/lib/save-queue/soft-delete";
import { keyAfter } from "@/lib/sort-key";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Entity } from "./config";
import type { ViewConfig, ViewType } from "./engine";

/** Höchstens so viele gespeicherte Ansichten je Bereich (Brief: „max. ~5 pro Bereich“). */
export const SAVED_VIEW_LIMIT = 5;

export interface SavedViewRow {
  id: string;
  entity: Entity;
  /** null = „Alles“ */
  area_id: string | null;
  name: string;
  view_type: ViewType;
  config: Json;
  sort: string;
  deleted_at: string | null;
}

export const savedViewsKey = ["saved_views"] as const;

export const ENTITY_PATHS: Record<Entity, string> = {
  tasks: appPath.tasks(),
  projects: appPath.projects(),
  notes: appPath.notes(),
};

export const savedViewHref = (view: Pick<SavedViewRow, "id" | "entity">) =>
  `${ENTITY_PATHS[view.entity]}?ansicht=${view.id}`;

export async function fetchSavedViews(client: SupabaseClient<Database>): Promise<SavedViewRow[]> {
  return fetchAll<SavedViewRow>(async (from, to) => {
    const result = await client
      .from("saved_views")
      .select("id, entity, area_id, name, view_type, config, sort, deleted_at")
      .is("deleted_at", null)
      .order("sort")
      .order("id")
      .range(from, to);
    return result as unknown as { data: SavedViewRow[] | null; error: unknown };
  });
}

export function useSavedViews() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: savedViewsKey,
    queryFn: async () =>
      (
        await fetchWithOverlay(queue, "saved_views", () => fetchSavedViews(getSupabase()), {
          include: () => true,
        })
      ).sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)),
  });
}

/** Ansichten eines Bereichs (für die Grenze und die Seitenleiste). */
export const viewsInArea = (views: SavedViewRow[], areaId: string | null) =>
  views.filter((v) => (v.area_id ?? null) === areaId);

export function createSavedViewActions(queue: SaveQueue, queryClient: QueryClient) {
  const list = () => queryClient.getQueryData<SavedViewRow[]>(savedViewsKey) ?? [];
  const patch = (id: string, values: Partial<SavedViewRow>) =>
    queryClient.setQueryData<SavedViewRow[]>(savedViewsKey, (old) =>
      old?.map((v) => (v.id === id ? { ...v, ...values } : v)),
    );
  return {
    /** Neue Ansicht; null, wenn der Bereich schon SAVED_VIEW_LIMIT Ansichten hat. */
    create(input: {
      entity: Entity;
      areaId: string | null;
      name: string;
      config: ViewConfig;
    }): SavedViewRow | null {
      if (viewsInArea(list(), input.areaId).length >= SAVED_VIEW_LIMIT) return null;
      const view: SavedViewRow = {
        id: newId(),
        entity: input.entity,
        area_id: input.areaId,
        name: input.name.trim().slice(0, 80),
        view_type: input.config.type,
        config: input.config as unknown as Json,
        sort: keyAfter(list().map((v) => v.sort)),
        deleted_at: null,
      };
      queryClient.setQueryData<SavedViewRow[]>(savedViewsKey, (old) => [...(old ?? []), view]);
      queue.enqueue({
        table: "saved_views",
        id: view.id,
        mode: "upsert",
        values: {
          entity: view.entity,
          area_id: view.area_id,
          name: view.name,
          view_type: view.view_type,
          config: view.config,
          sort: view.sort,
          deleted_at: null,
        },
      });
      return view;
    },
    /** Aktuelle Filter/Sortierung in die gespeicherte Ansicht übernehmen */
    saveConfig(id: string, config: ViewConfig) {
      const values = { config: config as unknown as Json, view_type: config.type };
      patch(id, values);
      queue.enqueue({ table: "saved_views", id, mode: "update", values });
    },
    rename(id: string, name: string) {
      const value = name.trim().slice(0, 80);
      if (!value) return;
      patch(id, { name: value });
      queue.enqueue({ table: "saved_views", id, mode: "update", values: { name: value } });
    },
    trash(id: string, onTrashed?: () => void) {
      const view = list().find((v) => v.id === id);
      if (!view) return;
      trashWithUndo(queue, queryClient, {
        table: "saved_views",
        queryKey: savedViewsKey,
        row: view,
        message: `Ansicht „${view.name}“ liegt im Papierkorb`,
        onTrashed,
      });
    },
  };
}

export function useSavedViewActions() {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(() => createSavedViewActions(queue, queryClient), [queue, queryClient]);
}
