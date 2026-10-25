/**
 * Fokus-Regeln für Projekte (Brief, weiche Warnungen) – gleiche Logik wie v_projects
 * (Migration 07), im Client gerechnet, damit sie sofort auf Änderungen reagiert:
 * - Fortschritt = erledigte ÷ alle Aufgaben (ohne Aufgaben: null → „–“)
 * - festgefahren = aktiv ohne Ergebnis oder ohne offenen nächsten Schritt
 * - still = aktiv und 14 Tage ohne Bewegung
 * - höchstens 3 aktive Projekte je Bereich
 */
import type { TaskRow } from "../tasks/types";
import type { ProjectRow } from "./types";

export const MAX_ACTIVE_PER_AREA = 3;
export const STALE_DAYS = 14;

export interface Progress {
  total: number;
  done: number;
  /** 0–1, null ohne Aufgaben */
  ratio: number | null;
}

export function projectProgress(projectId: string, tasks: TaskRow[]): Progress {
  const own = tasks.filter((t) => t.project_id === projectId && !t.deleted_at);
  const done = own.filter((t) => t.status === "erledigt").length;
  return {
    total: own.length,
    done,
    ratio: own.length === 0 ? null : Math.round((done / own.length) * 10_000) / 10_000,
  };
}

export const formatProgress = (progress: Progress) =>
  progress.ratio === null ? "–" : `${Math.round(progress.ratio * 100)} %`;

export type StuckReason = "ergebnis" | "naechster-schritt";

/** Warum ist ein aktives Projekt festgefahren? Leere Liste = nicht festgefahren. */
export function stuckReasons(project: ProjectRow, tasks: TaskRow[]): StuckReason[] {
  if (project.status !== "aktiv") return [];
  const reasons: StuckReason[] = [];
  if (!project.outcome.some((item) => item.text.trim() !== "")) reasons.push("ergebnis");
  const next = tasks.find((t) => t.id === project.next_task_id);
  if (!next || next.deleted_at || next.status === "erledigt") reasons.push("naechster-schritt");
  return reasons;
}

export const STUCK_LABELS: Record<StuckReason, string> = {
  ergebnis: "kein Ergebnis („Fertig ist es, wenn …“)",
  "naechster-schritt": "kein offener nächster Schritt",
};

/** Kurzform mit Grund für Listen und Heute (Muster 5, #23): „Festgefahren: Ergebnis fehlt“. */
export function stuckText(reasons: StuckReason[]): string {
  if (reasons.length === 0) return "";
  if (reasons.length > 1) return "Festgefahren: Ergebnis, nächster Schritt fehlen";
  return reasons[0] === "ergebnis"
    ? "Festgefahren: Ergebnis fehlt"
    : "Festgefahren: nächster Schritt fehlt";
}

/** Letzte Bewegung: Projekt selbst oder eine seiner Aufgaben (lokal sofort aktuell). */
export function lastActivity(project: ProjectRow, tasks: TaskRow[]): number {
  let latest = Math.max(
    Date.parse(project.last_activity_at) || 0,
    Date.parse(project.updated_at) || 0,
  );
  for (const task of tasks) {
    if (task.project_id === project.id) latest = Math.max(latest, Date.parse(task.updated_at) || 0);
  }
  return latest;
}

/** 14 Tage still (nur aktive Projekte), gemessen an `now` (in Tests per page.clock gesteuert). */
export function isStale(project: ProjectRow, tasks: TaskRow[], now: number = Date.now()): boolean {
  return project.status === "aktiv" && lastActivity(project, tasks) < now - STALE_DAYS * 86_400_000;
}

export function daysSince(timestamp: number, now: number = Date.now()): number {
  return Math.floor((now - timestamp) / 86_400_000);
}

/** Aktive Projekte je Bereich. */
export function activeCountByArea(projects: ProjectRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of projects) {
    if (p.status === "aktiv" && !p.deleted_at)
      counts.set(p.area_id, (counts.get(p.area_id) ?? 0) + 1);
  }
  return counts;
}

/** Bereiche mit mehr als 3 aktiven Projekten. */
export function overloadedAreas(projects: ProjectRow[]): Array<{ areaId: string; count: number }> {
  return [...activeCountByArea(projects)]
    .filter(([, count]) => count > MAX_ACTIVE_PER_AREA)
    .map(([areaId, count]) => ({ areaId, count }));
}
