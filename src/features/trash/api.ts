"use client";

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { notifyWithUndo, toast } from "@/components/ui/toast";
import { useSupabase, useUserId } from "@/lib/data/provider";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import { RPC_EMPTY_TRASH } from "@/lib/save-queue/supabase-persister";
import { removeUnusedMedia } from "./media";
import {
  applyPendingTrashOps,
  restoreTargets,
  sortTrash,
  type TrashItem,
  trashTitle,
} from "./model";
import { fetchTrash } from "./queries";

export const trashKey = ["trash"] as const;

/**
 * Inhalt des Papierkorbs, darüber der lokale Stand (Unbestätigtes wird vor und nach dem Laden
 * gelesen, wie bei fetchWithOverlay). Neu geladen, sobald ein Löschen/Zurückholen gespeichert ist
 * (DataProvider).
 */
export function useTrash() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: trashKey,
    staleTime: 0,
    queryFn: async () => {
      const before = queue.unconfirmedOps();
      const items = await fetchTrash(getSupabase());
      return applyPendingTrashOps(items, [...before, ...queue.unconfirmedOps()]);
    },
  });
}

const sameItem = (a: TrashItem, b: TrashItem) => a.table === b.table && a.id === b.id;

export function createTrashActions(
  queue: SaveQueue,
  queryClient: QueryClient,
  /** endgültig gelöschte Notizen und Aufgaben: ihre Bilder und Dateien mit entfernen */
  options: { onPurgeFiles?: (ownerIds: string[]) => void } = {},
) {
  const list = () => queryClient.getQueryData<TrashItem[]>(trashKey) ?? [];
  const setList = (update: (old: TrashItem[]) => TrashItem[]) =>
    queryClient.setQueryData<TrashItem[]>(trashKey, (old) => update(old ?? []));
  const remove = (items: TrashItem[]) =>
    setList((old) => old.filter((i) => !items.some((t) => sameItem(t, i))));

  /** „Rückgängig“ nach dem Wiederherstellen: wieder in den Papierkorb. */
  const trashAgain = (items: TrashItem[]) => {
    const now = new Date().toISOString();
    for (const item of items) {
      queue.enqueue({
        table: item.table,
        id: item.id,
        mode: "update",
        values: { deleted_at: now },
      });
      // Listen-Caches heißen wie ihre Tabelle (tasks, notes, projects …)
      queryClient.setQueryData<Array<{ id: string }>>([item.table], (old) =>
        old?.filter((row) => row.id !== item.id),
      );
    }
    setList((old) =>
      sortTrash([
        ...old.filter((i) => !items.some((t) => sameItem(t, i))),
        ...items.map((i) => ({ ...i, deletedAt: now })),
      ]),
    );
  };

  return {
    /** Zurückholen (samt Projekt bei Meilensteinen); die Listen laden nach dem Speichern neu. */
    restore(item: TrashItem) {
      const targets = restoreTargets(item, list());
      for (const target of targets) {
        queue.enqueue({
          table: target.table,
          id: target.id,
          mode: "update",
          values: { deleted_at: null },
        });
      }
      remove(targets);
      notifyWithUndo(`„${trashTitle(item)}“ ist wieder da`, () => trashAgain(targets));
    },

    /** Endgültig löschen (E9, nur nach Rückfrage in der Oberfläche) – nicht rückgängig zu machen. */
    purge(items: TrashItem[]) {
      if (items.length === 0) return;
      for (const item of items) {
        queue.enqueue({
          table: RPC_EMPTY_TRASH,
          id: item.id,
          mode: "update",
          values: { entity: item.table },
        });
      }
      remove(items);
      // Bilder und Dateien endgültig gelöschter Notizen, Aufgaben und Projekte (Freitext, #44)
      // mit entfernen (E24, #27), soweit sie nicht woandershin kopiert wurden (media.ts)
      const owners = items
        .filter((i) => i.table === "notes" || i.table === "tasks" || i.table === "projects")
        .map((i) => i.id);
      if (owners.length > 0) options.onPurgeFiles?.(owners);
      const [first] = items;
      toast(
        items.length === 1 && first
          ? `„${trashTitle(first)}“ endgültig gelöscht`
          : `${items.length} Einträge endgültig gelöscht`,
      );
    },
  };
}

export type TrashActions = ReturnType<typeof createTrashActions>;

export function useTrashActions(): TrashActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  const getSupabase = useSupabase();
  const userId = useUserId();
  return useMemo(
    () =>
      createTrashActions(queue, queryClient, {
        // Erst speichern (z. B. ein eben in eine andere Notiz eingefügtes Bild), dann nur
        // Ungenutztes entfernen – und erst, wenn das endgültige Löschen bestätigt ist: Kehrt der
        // Flush wegen eines Netzfehlers früh zurück, lebten die Einträge noch (D-11). Scheitert
        // es, bleiben verwaiste Dateien (kein Datenverlust).
        onPurgeFiles: (ids) => {
          const purging = () =>
            queue
              .unconfirmedOps()
              .some((op) => op.table === RPC_EMPTY_TRASH && ids.includes(op.id));
          const clean = () =>
            removeUnusedMedia(
              getSupabase(),
              userId,
              ids,
              queue.unconfirmedOps().map((op) => op.values),
            ).catch(() => {});
          void queue
            .flush()
            .then(() => {
              if (!purging()) return clean();
              // später nachholen, sobald die Warteschlange es bestätigt hat
              const off = queue.subscribe(() => {
                if (purging()) return;
                off();
                void clean();
              });
            })
            .catch(() => {});
        },
      }),
    [queue, queryClient, getSupabase, userId],
  );
}
