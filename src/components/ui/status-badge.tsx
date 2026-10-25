import { Pill, type Tone } from "./pill";

export type TaskStatus = "offen" | "in_arbeit" | "wartet" | "erledigt";
export type ProjectStatus = "idee" | "geplant" | "aktiv" | "pausiert" | "abgeschlossen" | "archiv";

const TASK: Record<TaskStatus, { label: string; tone: Tone }> = {
  offen: { label: "Offen", tone: "default" },
  in_arbeit: { label: "In Arbeit", tone: "warning" },
  wartet: { label: "Wartet", tone: "muted" },
  erledigt: { label: "Erledigt", tone: "success" },
};

const PROJECT: Record<ProjectStatus, { label: string; tone: Tone }> = {
  idee: { label: "Idee", tone: "muted" },
  geplant: { label: "Geplant", tone: "default" },
  aktiv: { label: "Aktiv", tone: "success" },
  pausiert: { label: "Pausiert", tone: "warning" },
  abgeschlossen: { label: "Abgeschlossen", tone: "muted" },
  archiv: { label: "Archiv", tone: "muted" },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const s = PROJECT[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export const PRIORITY_LABELS: Record<1 | 2 | 3, string> = { 1: "Hoch", 2: "Mittel", 3: "Niedrig" };

export function PriorityBadge({ priority }: { priority: 1 | 2 | 3 }) {
  return <Pill tone={priority === 1 ? "danger" : undefined}>{PRIORITY_LABELS[priority]}</Pill>;
}
