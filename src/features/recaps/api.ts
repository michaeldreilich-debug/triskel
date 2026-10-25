"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchAll } from "@/lib/data/fetch-all";
import { useSupabase, useUserId } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import type { IsoDate } from "@/lib/dates";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import { trashWithUndo } from "@/lib/save-queue/soft-delete";
import { RPC_CLOSE_RECAP, RPC_RECAP_ANSWER } from "@/lib/save-queue/supabase-persister";
import type { Database } from "@/lib/supabase/database.types";
import {
  type AnswerValue,
  answerOf,
  answerPatch,
  findRecap,
  monthQuestions,
  parseStats,
  recapId,
  recapTitle,
  toRecap,
} from "./model";
import type { RecapQuestion, RecapRow, RecapWrite, ReviewState, WeekStats } from "./types";

export const recapsKey = ["recaps"] as const;
export const weekStatsKey = (start: IsoDate, end: IsoDate) => ["week_stats", start, end] as const;

const RECAP_COLUMNS =
  "id, kind, period_start, period_end, mood, energy, sport, relations, learning, answers, focus_next, themes, questions, stats, review, closed_at, created_at, updated_at, deleted_at";

type Client = SupabaseClient<Database>;

type RawRow = Record<string, unknown> & { id: string };

/** Alle Rückblicke (ohne Papierkorb) als Rohzeilen, neueste Zeiträume zuerst. */
export function fetchRecapRows(client: Client): Promise<RawRow[]> {
  return fetchAll<RawRow>(async (from, to) => {
    const result = await client
      .from("recaps")
      .select(RECAP_COLUMNS)
      .is("deleted_at", null)
      .order("period_start", { ascending: false })
      .order("id")
      .range(from, to);
    return result as unknown as { data: RawRow[] | null; error: unknown };
  });
}

export async function fetchRecaps(client: Client): Promise<RecapRow[]> {
  return (await fetchRecapRows(client)).map(toRecap);
}

/** Automatische Zahlen eines Zeitraums (week_stats, nur lesend). */
export async function fetchWeekStats(
  client: Client,
  start: IsoDate,
  end: IsoDate,
): Promise<WeekStats | null> {
  const { data, error } = await client.rpc("week_stats", { p_start: start, p_end: end });
  if (error) throw error;
  return parseStats(data);
}

export function useRecaps() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: recapsKey,
    queryFn: async () => {
      const rows = (
        await fetchWithOverlay(queue, "recaps", () => fetchRecapRows(getSupabase()), {
          include: () => true,
        })
      ).map(toRecap);
      // Abschließen wartet noch in der Warteschlange: schon als abgeschlossen zeigen
      const unconfirmed = queue.unconfirmedOps();
      const closing = new Set(
        unconfirmed.filter((op) => op.table === RPC_CLOSE_RECAP).map((op) => op.id),
      );
      // feldweise geschriebene Antworten (V-2), noch unbestätigt: lokaler Stand hat Vorrang
      const answers = new Map<string, Record<string, unknown>>();
      for (const op of unconfirmed) {
        if (op.table !== RPC_RECAP_ANSWER) continue;
        answers.set(op.id, { ...(answers.get(op.id) ?? {}), ...op.values });
      }
      return rows.map((r) => {
        const pending = answers.get(r.id);
        const withAnswers = pending ? { ...r, answers: { ...r.answers, ...pending } } : r;
        return closing.has(r.id) && !withAnswers.closed_at
          ? { ...withAnswers, closed_at: new Date().toISOString() }
          : withAnswers;
      });
    },
  });
}

/** Zahlen live (offener Rückblick); bei jedem Öffnen frisch. */
export function useWeekStats(start: IsoDate, end: IsoDate, enabled = true) {
  const getSupabase = useSupabase();
  return useQuery({
    queryKey: weekStatsKey(start, end),
    enabled: enabled && !!start && !!end,
    staleTime: 0,
    queryFn: () => fetchWeekStats(getSupabase(), start, end),
  });
}

/* ------------------------------------------------------------------ */
/* Schreiben (optimistisch, über die Speicher-Warteschlange)          */
/* ------------------------------------------------------------------ */

const nowIso = () => new Date().toISOString();

export { recapId };

export function createRecapActions(queue: SaveQueue, queryClient: QueryClient, userId: string) {
  const list = () => queryClient.getQueryData<RecapRow[]>(recapsKey) ?? [];
  const patch = (id: string, values: Partial<RecapRow>) =>
    queryClient.setQueryData<RecapRow[]>(recapsKey, (old) =>
      old?.map((r) => (r.id === id ? { ...r, ...values, updated_at: nowIso() } : r)),
    );

  /**
   * Wochen- oder Monatsrückblick anlegen; die Leitfragen der Vorlage werden festgehalten (im
   * Monat mit „Fokus nächster Monat“).
   */
  const create = (
    kind: RecapRow["kind"],
    start: IsoDate,
    end: IsoDate,
    template: RecapQuestion[],
  ): RecapRow => {
    const existing = findRecap(list(), kind, start);
    if (existing) return existing;
    const questions = kind === "monat" ? monthQuestions(template) : template;
    const recap = toRecap({
      id: recapId(userId, kind, start),
      kind,
      period_start: start,
      period_end: end,
      questions,
    });
    queryClient.setQueryData<RecapRow[]>(recapsKey, (old) => [recap, ...(old ?? [])]);
    // nur die Kennung des Zeitraums: Hat ein anderes Gerät (oder die KI) die Zeile schon angelegt
    // und darin geschrieben, bleiben Antworten, Werte und Fokus stehen (die Datenbank füllt sonst
    // die Vorgaben). deleted_at: null holt einen Rückblick dieses Zeitraums aus dem Papierkorb.
    const values: Partial<RecapWrite> = {
      kind: recap.kind,
      period_start: start,
      period_end: end,
      questions,
      deleted_at: null,
    };
    queue.enqueue({ table: "recaps", id: recap.id, mode: "upsert", values: { ...values } });
    return recap;
  };

  return {
    create,

    /** Wochenrückblick anlegen (Kurzform). */
    createWeek: (start: IsoDate, end: IsoDate, questions: RecapQuestion[]) =>
      create("woche", start, end, questions),

    update(id: string, values: Partial<RecapWrite>) {
      patch(id, values);
      queue.enqueue({ table: "recaps", id, mode: "update", values: { ...values } });
    },

    /**
     * Stand des Wochenreviews ändern (S1c) – immer auf dem neuesten Stand im Cache, damit
     * schnelles Abhaken mehrerer Projekte und Weiterblättern sich nicht gegenseitig überschreiben.
     */
    review(id: string, next: (current: ReviewState) => ReviewState) {
      const recap = list().find((r) => r.id === id);
      if (!recap) return;
      const review = next(recap.review);
      patch(id, { review });
      queue.enqueue({ table: "recaps", id, mode: "update", values: { review } });
    },

    /**
     * Antwort ändern – immer auf dem neuesten Stand im Cache (schnelles Tippen in mehreren Feldern).
     * Antworten im `answers`-Objekt gehen feldweise per RPC (Migration 49, V-2): nur dieser
     * Schlüssel ändert sich auf dem Server, was KI oder iPhone inzwischen in andere Felder
     * schrieben, bleibt. Spalten (Skalen, Sport, Fokus) wie bisher als Update.
     */
    answer(id: string, question: RecapQuestion, next: (current: AnswerValue) => AnswerValue) {
      const recap = list().find((r) => r.id === id);
      if (!recap) return;
      const value = next(answerOf(recap, question));
      const values = answerPatch(recap, question, value);
      patch(id, values);
      if ("answers" in values) {
        queue.enqueue({
          table: RPC_RECAP_ANSWER,
          id,
          mode: "update",
          values: { [question.key]: value ?? null },
        });
        return;
      }
      queue.enqueue({ table: "recaps", id, mode: "update", values: { ...values } });
    },

    /**
     * Abschließen: Der Server hält die Zahlen fest (close_recap). Bis dahin zeigt die Ansicht die
     * zuletzt geladenen Zahlen als Snapshot.
     */
    close(id: string, stats: WeekStats | null) {
      patch(id, { closed_at: nowIso(), ...(stats ? { stats } : {}) });
      queue.enqueue({ table: RPC_CLOSE_RECAP, id, mode: "update", values: {} });
    },

    trash(id: string, onTrashed?: () => void) {
      const recap = list().find((r) => r.id === id);
      if (!recap) return;
      trashWithUndo(queue, queryClient, {
        table: "recaps",
        queryKey: recapsKey,
        row: recap,
        message: `„${recapTitle(recap)}“ liegt im Papierkorb`,
        onTrashed,
        restore: (rows, row) => [row, ...rows],
      });
    },
  };
}

export type RecapActions = ReturnType<typeof createRecapActions>;

export function useRecapActions(): RecapActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMemo(
    () => createRecapActions(queue, queryClient, userId),
    [queue, queryClient, userId],
  );
}
