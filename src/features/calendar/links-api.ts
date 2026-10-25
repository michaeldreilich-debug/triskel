"use client";

/**
 * Termin-Verknüpfungen im Client (#68): lesen (`useEventLinks`, eine kleine Tabelle, ganz im
 * Speicher) und schreiben über die Speicher-Warteschlange – verknüpfen, Umfang ändern, lösen
 * (Soft-Delete mit Rückgängig), Schnappschuss nachziehen und auf einen neu angelegten Termin
 * umhängen (Rückgängig nach dem Löschen, wenn Google den Termin nicht mehr hatte).
 */
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { notifyWithUndo } from "@/components/ui/toast";
import { fetchAll } from "@/lib/data/fetch-all";
import { useSupabase } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import type { Supabase } from "@/lib/supabase/client";
import {
  alreadyLinked,
  EVENT_LINK_COLUMNS,
  EVENT_LINK_WRITE_KEYS,
  type EventLinkRow,
  type EventLinkScope,
  type LinkableEvent,
  linkMatches,
  sameLink,
  snapshotOf,
  snapshotStale,
  toEventLink,
} from "./links";

/** Cache-Schlüssel = Tabellenname (wie bei den übrigen Tabellen) */
export const eventLinksKey = ["event_links"] as const;

type RawRow = Record<string, unknown> & { id: string };

export async function fetchEventLinkRows(client: Supabase): Promise<RawRow[]> {
  return fetchAll<RawRow>(
    async (from, to) =>
      (await client
        .from("event_links")
        .select(EVENT_LINK_COLUMNS)
        .is("deleted_at", null)
        .order("event_start")
        .order("id")
        .range(from, to)) as { data: RawRow[] | null; error: unknown },
  );
}

export function useEventLinks() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: eventLinksKey,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await fetchWithOverlay(queue, "event_links", () => fetchEventLinkRows(getSupabase()), {
          include: () => true,
        })
      ).map(toEventLink),
  });
}

export type LinkTarget =
  | { taskId: string; noteId?: undefined }
  | { noteId: string; taskId?: undefined };

const writeValues = (row: EventLinkRow) =>
  Object.fromEntries(EVENT_LINK_WRITE_KEYS.map((key) => [key, row[key]]));

export function createEventLinkActions(queue: SaveQueue, queryClient: QueryClient) {
  const list = () => queryClient.getQueryData<EventLinkRow[]>(eventLinksKey) ?? [];
  const setList = (update: (old: EventLinkRow[]) => EventLinkRow[]) =>
    queryClient.setQueryData<EventLinkRow[]>(eventLinksKey, (old) => update(old ?? []));
  const nowIso = () => new Date().toISOString();

  const patch = (id: string, values: Partial<EventLinkRow>) => {
    setList((old) =>
      values.deleted_at
        ? old.filter((l) => l.id !== id)
        : old.map((l) => (l.id === id ? { ...l, ...values } : l)),
    );
    queue.enqueue({ table: "event_links", id, mode: "update", values });
  };

  const upsert = (row: EventLinkRow) => {
    setList((old) => [...old.filter((l) => l.id !== row.id), row]);
    queue.enqueue({ table: "event_links", id: row.id, mode: "upsert", values: writeValues(row) });
  };

  return {
    /**
     * Termin ↔ Aufgabe/Notiz. Serie nur, wenn der Termin zu einer gehört. Schon verknüpft: null.
     */
    link(
      event: LinkableEvent,
      target: LinkTarget,
      scope: EventLinkScope = "occurrence",
    ): EventLinkRow | null {
      if (alreadyLinked(list(), event, target)) return null;
      const now = nowIso();
      const row: EventLinkRow = {
        id: newId(),
        google_calendar_id: event.calendarId,
        event_id: event.eventId,
        recurring_event_id: event.recurringEventId,
        scope: scope === "series" && event.recurringEventId ? "series" : "occurrence",
        task_id: target.taskId ?? null,
        note_id: target.noteId ?? null,
        ...snapshotOf(event),
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      upsert(row);
      return row;
    },

    /** Nur dieses Mal ↔ ganze Serie (nur bei Serien). */
    setScope(link: EventLinkRow, scope: EventLinkScope) {
      if (link.scope === scope || (scope === "series" && !link.recurring_event_id)) return;
      patch(link.id, { scope });
    },

    /** Lösen: nur die Verknüpfung, nie die Aufgabe oder Notiz – mit Rückgängig. */
    unlink(link: EventLinkRow, label: string) {
      patch(link.id, { deleted_at: nowIso() });
      notifyWithUndo(`Verknüpfung mit „${label}“ gelöst`, () => {
        // Zurückholen gewinnt (Migration 48, M-4): Wurde derselbe Termin inzwischen neu verknüpft,
        // legt die Datenbank diese zweite Zeile in den Papierkorb – lokal ebenso
        setList((old) => [
          ...old.filter((l) => l.id !== link.id && !sameLink(l, link)),
          { ...link, deleted_at: null },
        ]);
        queue.enqueue({
          table: "event_links",
          id: link.id,
          mode: "update",
          values: { deleted_at: null },
        });
      });
    },

    /** Schnappschuss der Verknüpfungen dieses Termins nachziehen, wenn Titel oder Zeit abweichen. */
    refreshSnapshot(event: LinkableEvent) {
      for (const link of list()) {
        if (link.deleted_at || !linkMatches(link, event) || !snapshotStale(link, event)) continue;
        patch(link.id, snapshotOf(event));
      }
    },

    /**
     * Termin bekam eine neue ID (Rückgängig nach dem Löschen hat ihn neu angelegt, bzw. er liegt
     * jetzt in einem anderen Kalender): Verknüpfungen des alten Termins umhängen.
     */
    retarget(oldEventId: string, event: LinkableEvent) {
      for (const link of list()) {
        if (link.deleted_at || link.event_id !== oldEventId) continue;
        patch(link.id, {
          google_calendar_id: event.calendarId,
          event_id: event.eventId,
          ...(link.scope === "occurrence" ? snapshotOf(event) : {}),
        });
      }
    },
  };
}

export type EventLinkActions = ReturnType<typeof createEventLinkActions>;

export function useEventLinkActions(): EventLinkActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(() => createEventLinkActions(queue, queryClient), [queue, queryClient]);
}
