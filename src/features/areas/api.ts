"use client";

import { useQuery } from "@tanstack/react-query";
import type { AreaColor } from "@/components/ui/pill";
import { useSupabase } from "@/lib/data/provider";
import { overlayUnconfirmed } from "@/lib/data/unconfirmed";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { AreaSummary } from "./defaults";

export const areasKey = ["areas"] as const;

const toColor = (value: string): AreaColor => (value === "orange" ? "orange" : "blue");

/** Bereiche des Nutzers (Seeds: Beruf, Privat) in Sortierreihenfolge. */
export function useAreas() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: areasKey,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AreaSummary[]> => {
      const { data, error } = await getSupabase()
        .from("areas")
        .select("id, name, color, sort, deleted_at")
        .is("deleted_at", null)
        .order("sort");
      if (error) throw error;
      return overlayUnconfirmed(queue, "areas", data).map((area) => ({
        id: area.id,
        name: area.name,
        color: toColor(area.color),
      }));
    },
  });
}
