import type { AreaColor } from "@/components/ui/pill";

export interface AreaSummary {
  id: string;
  name: string;
  color: AreaColor;
}

/**
 * Standard-Bereiche wie im Seed (Migration 09). Die Shell nutzt sie, bis die Bereiche
 * aus der Datenbank geladen werden (Session A2, Hook useAreas).
 */
export const DEFAULT_AREAS: AreaSummary[] = [
  { id: "beruf", name: "Beruf", color: "orange" },
  { id: "privat", name: "Privat", color: "blue" },
];
