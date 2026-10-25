import type { JSONContent } from "@tiptap/core";
import type { IsoDate } from "@/lib/dates";
import type { Priority } from "../tasks/types";
import type { ProjectLink } from "./links";

/** Status (Check in Migration 03) mit Anzeigenamen. */
export const PROJECT_STATUSES = [
  "idee",
  "geplant",
  "aktiv",
  "pausiert",
  "abgeschlossen",
  "archiv",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idee: "Idee",
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
  archiv: "Archiv",
};

export const parseProjectStatus = (value: string | null | undefined): ProjectStatus =>
  (PROJECT_STATUSES as readonly string[]).includes(value ?? "") ? (value as ProjectStatus) : "idee";

/** Punkt der Ergebnis-Checkliste „Fertig ist es, wenn …“ */
export interface OutcomeItem {
  id: string;
  text: string;
  done: boolean;
}

/** Abschluss-Ritual (Brief, Fokus-Regel 6) */
export interface ClosingReflection {
  /** Was hat geklappt? */
  worked: string;
  /** Was nehme ich mit? */
  takeaway: string;
  /** Was blieb offen? */
  open: string;
}

export interface ProjectRow {
  id: string;
  area_id: string;
  title: string;
  status: ProjectStatus;
  priority: Priority | null;
  start_date: IsoDate | null;
  target_date: IsoDate | null;
  why: string;
  outcome: OutcomeItem[];
  /** Links im Steckbrief (Migration 22) */
  links: ProjectLink[];
  /** Freitext im Reiter Übersicht (#44, Migration 24): TipTap-Dokument wie die Aufgaben-Notiz */
  body: JSONContent | null;
  body_text: string;
  next_task_id: string | null;
  last_activity_at: string;
  closing_reflection: ClosingReflection | null;
  sort: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type ProjectWrite = Omit<
  ProjectRow,
  "id" | "last_activity_at" | "created_at" | "updated_at"
>;

export interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  due_date: IsoDate | null;
  done_at: string | null;
  sort: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type MilestoneWrite = Pick<
  MilestoneRow,
  "project_id" | "title" | "due_date" | "done_at" | "sort" | "deleted_at"
>;

export const projectTitle = (project: Pick<ProjectRow, "title"> | undefined) =>
  project?.title.trim() ? project.title : "Ohne Titel";

/** Projekte, die noch laufen (für Auswahl und Zuordnung). */
export const isOpenProject = (project: Pick<ProjectRow, "status">) =>
  project.status !== "abgeschlossen" && project.status !== "archiv";

/** jsonb-Werte defensiv lesen (Daten könnten von Hand oder älter sein). */
export function parseOutcome(value: unknown): OutcomeItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `punkt-${index}`,
      text: typeof item.text === "string" ? item.text : "",
      done: item.done === true,
    }));
}

export function parseReflection(value: unknown): ClosingReflection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === "string" ? (v[key] as string) : "");
  return { worked: text("worked"), takeaway: text("takeaway"), open: text("open") };
}
