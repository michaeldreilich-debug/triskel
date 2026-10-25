"use client";

/**
 * Zeitstrahl-Filter je Gerät (localStorage, #55): Status, Zeitraum, Sortierung. Der Bereich
 * kommt vom Bereichs-Schalter der App, die Verschiebung ‹ › gilt nur, solange die Seite offen ist.
 */
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TIMELINE_FILTERS, parseTimelineFilters, type TimelineFilters } from "./model";

export const TIMELINE_FILTER_KEY = "sz:zeitstrahl-filter";

export function useTimelineFilters(): [TimelineFilters, (patch: Partial<TimelineFilters>) => void] {
  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_TIMELINE_FILTERS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TIMELINE_FILTER_KEY);
      if (raw) setFilters(parseTimelineFilters(JSON.parse(raw)));
    } catch {
      // kein Speicher oder kaputter Wert: Standard bleibt
    }
  }, []);
  const patch = useCallback((change: Partial<TimelineFilters>) => {
    setFilters((old) => {
      const next = { ...old, ...change };
      try {
        window.localStorage.setItem(TIMELINE_FILTER_KEY, JSON.stringify(next));
      } catch {
        // nur Bequemlichkeit
      }
      return next;
    });
  }, []);
  return [filters, patch];
}
