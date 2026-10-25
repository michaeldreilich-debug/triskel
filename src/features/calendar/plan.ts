/**
 * Einplanen-Spalte (#62, Variante D) als reine Funktion – kein "use client":
 * Oben „Jetzt einplanen“ (überfällig, in 7 Tagen fällig, Priorität hoch, Fokus heute/morgen),
 * darunter Inbox, Projekte nach Meilenstein und lose Aufgaben je Bereich. Jede Aufgabe steht
 * genau einmal (was oben steht, fehlt unten). „Noch einzuplanen“ ist jede offene Aufgabe ohne
 * Uhrzeit – auch mit Fälligkeit (bisher nur ganz ohne Datum).
 */
import type { MilestoneRow, ProjectRow } from "@/features/projects/types";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { addDays, type IsoDate } from "@/lib/dates";

/** „Fällig in 7 Tagen“ (heute + 7 Tage zählt, der 8. nicht) */
export const PLAN_SOON_DAYS = 7;
/** Höchstens so viele Zeilen im Jetzt-Block, der Rest hinter „N weitere“ */
export const PLAN_NOW_MAX = 7;
/** Projekte mit mehr offenen Aufgaben starten zugeklappt */
export const PLAN_BIG_PROJECT = 8;

/** Kleines Filter-Menü: was die Spalte zeigt (je Gerät gemerkt) */
export interface PlanFilters {
  inbox: boolean;
  projects: boolean;
  /** Aufgaben, die die KI angelegt hat (#69) */
  ai: boolean;
}
export const ALL_PLAN_FILTERS: PlanFilters = { inbox: true, projects: true, ai: true };

export interface PlanOptions {
  today: IsoDate;
  /** Bereichs-Schalter (null = alle); die Inbox gehört keinem Bereich und bleibt sichtbar */
  area: string | null;
  /** Projekt-Filter des Kalenders (null = alle) */
  projectId: string | null;
  query: string;
  filters: PlanFilters;
  projects: Pick<ProjectRow, "id" | "title" | "area_id" | "sort">[];
  milestones: Pick<MilestoneRow, "id" | "project_id" | "title" | "sort" | "done_at">[];
  areas: { id: string; name: string }[];
  /**
   * Welche Aufgaben die Spalte überhaupt zeigt (Standard: `isPlannable`, offen und ohne Uhrzeit).
   * Die Spalte „Wählen“ auf Heute (#90) bringt ihre Kandidaten schon mit und lässt alle zu.
   */
  pool?: (task: TaskRow, today: IsoDate) => boolean;
}

export interface PlanMilestone {
  /** null = Aufgaben ohne Meilenstein */
  id: string | null;
  title: string;
  tasks: TaskRow[];
}

export interface PlanProject {
  id: string;
  title: string;
  areaId: string;
  /** alle Aufgaben des Projekts in der Spalte (ohne die im Jetzt-Block) */
  count: number;
  /** ohne Meilenstein */
  loose: TaskRow[];
  /** der nächste offene Meilenstein (aufgeklappt) */
  current: PlanMilestone | null;
  /** spätere Meilensteine: nur als Zeile „+ 2 Meilensteine · 18 Aufgaben“ */
  later: PlanMilestone[];
  laterTasks: number;
  /** zugeklappt, solange nichts anderes gespeichert ist */
  big: boolean;
}

export interface PlanArea {
  id: string;
  name: string;
  tasks: TaskRow[];
}

export interface PlanModel {
  /** „N offen“: alle noch einzuplanenden Aufgaben (Bereich und Filter beachtet, Suche nicht) */
  open: number;
  /** „M jetzt“ */
  nowCount: number;
  /** Jetzt-Block, vollständig sortiert (die Oberfläche zeigt höchstens PLAN_NOW_MAX) */
  now: TaskRow[];
  inbox: TaskRow[];
  projects: PlanProject[];
  areas: PlanArea[];
  /** Treffer der Suche bzw. alle Zeilen der Spalte */
  shown: number;
  /** durch den Bereichs-Schalter ausgeblendet (Hinweis „N weitere in anderen Bereichen“) */
  hiddenByArea: number;
  searching: boolean;
}

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Offen und ohne Uhrzeit – Fokus-Tage jenseits von morgen gelten schon als eingeplant. */
export function isPlannable(task: TaskRow, today: IsoDate): boolean {
  if (task.deleted_at || task.status === "erledigt" || task.scheduled_at) return false;
  return !task.focus_date || task.focus_date <= addDays(today, 1);
}

/** „Jetzt einplanen“: überfällig, in 7 Tagen fällig, Priorität hoch, Fokus heute/morgen. Die Inbox nicht. */
export function isNow(task: TaskRow, today: IsoDate): boolean {
  if (task.in_inbox) return false;
  if (task.due_date && task.due_date <= addDays(today, PLAN_SOON_DAYS)) return true;
  if (task.priority === 1) return true;
  return task.focus_date !== null && task.focus_date <= addDays(today, 1);
}

const text = (value: string | null | undefined, fallback: string) => value?.trim() || fallback;

const bySort = (a: TaskRow, b: TaskRow) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);
const byPriority = (a: TaskRow, b: TaskRow) => (a.priority ?? 9) - (b.priority ?? 9);
const byDue = (a: TaskRow, b: TaskRow) =>
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
/** Fälligstes zuerst, dann Priorität, dann die Reihenfolge, in der sie stehen */
export const compareForPlan = (a: TaskRow, b: TaskRow) =>
  byDue(a, b) || byPriority(a, b) || bySort(a, b);

const EMPTY_PLAN: PlanModel = {
  open: 0,
  nowCount: 0,
  now: [],
  inbox: [],
  projects: [],
  areas: [],
  shown: 0,
  hiddenByArea: 0,
  searching: false,
};

export function buildPlan(tasks: TaskRow[], options: PlanOptions): PlanModel {
  const { today } = options;
  // heutiger Tag noch unbekannt (vor dem Einhängen): nichts einzuplanen statt „Invalid time value“
  if (!today) return EMPTY_PLAN;
  const q = fold(options.query.trim());
  const searching = q !== "";
  // Die Suche geht über alles: das Filter-Menü gilt dann nicht
  const filters = searching ? ALL_PLAN_FILTERS : options.filters;
  const projectById = new Map(options.projects.map((p) => [p.id, p]));
  const projectTitle = (task: TaskRow) =>
    task.project_id ? text(projectById.get(task.project_id)?.title, "Ohne Titel") : "";
  const matches = (task: TaskRow) =>
    !q ||
    fold(taskTitle(task)).includes(q) ||
    fold(task.body_text).includes(q) ||
    fold(projectTitle(task)).includes(q);

  const pool = options.pool ?? isPlannable;
  let candidates = tasks.filter((t) => pool(t, today));
  if (options.projectId) candidates = candidates.filter((t) => t.project_id === options.projectId);
  candidates = candidates.filter(
    (t) =>
      (filters.inbox || !t.in_inbox) &&
      (filters.projects || !t.project_id || t.in_inbox) &&
      (filters.ai || t.created_by !== "ai"),
  );
  const inArea = (t: TaskRow) => !options.area || t.in_inbox || t.area_id === options.area;
  const hiddenByArea = candidates.filter((t) => !inArea(t) && matches(t)).length;
  candidates = candidates.filter(inArea);
  const open = candidates.length;
  candidates = candidates.filter(matches);

  const inbox = candidates.filter((t) => t.in_inbox).sort(byPriority);
  const rest = candidates.filter((t) => !t.in_inbox);
  const nowTasks = rest
    .filter((t) => isNow(t, today))
    .sort(
      (a, b) =>
        compareForPlan(a, b) || (a.focus_date ?? "9999").localeCompare(b.focus_date ?? "9999"),
    );
  const nowIds = new Set(nowTasks.map((t) => t.id));
  const below = rest.filter((t) => !nowIds.has(t.id));

  /* ---- Projekte nach Meilenstein ---- */
  const byProject = new Map<string, TaskRow[]>();
  const looseByArea = new Map<string, TaskRow[]>();
  for (const task of below) {
    if (task.project_id && projectById.has(task.project_id)) {
      byProject.set(task.project_id, [...(byProject.get(task.project_id) ?? []), task]);
    } else if (task.area_id) {
      looseByArea.set(task.area_id, [...(looseByArea.get(task.area_id) ?? []), task]);
    }
  }
  const projects: PlanProject[] = [...byProject.entries()]
    .flatMap(([id, list]) => {
      const project = projectById.get(id);
      if (!project) return [];
      const milestones = options.milestones
        .filter((m) => m.project_id === id)
        .sort(
          (a, b) =>
            (a.done_at ? 1 : 0) - (b.done_at ? 1 : 0) ||
            (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0),
        );
      const known = new Set(milestones.map((m) => m.id));
      const groups: PlanMilestone[] = milestones
        .map((m) => ({
          id: m.id as string | null,
          title: text(m.title, "Meilenstein"),
          tasks: list.filter((t) => t.milestone_id === m.id).sort(compareForPlan),
        }))
        .filter((g) => g.tasks.length > 0);
      const loose = list
        .filter((t) => !t.milestone_id || !known.has(t.milestone_id))
        .sort(compareForPlan);
      const later = groups.slice(1);
      return [
        {
          id,
          title: text(project.title, "Ohne Titel"),
          areaId: project.area_id,
          count: list.length,
          loose,
          current: groups[0] ?? null,
          later,
          laterTasks: later.reduce((n, g) => n + g.tasks.length, 0),
          big: list.length > PLAN_BIG_PROJECT,
        },
      ];
    })
    .sort((a, b) => {
      const pa = projectById.get(a.id);
      const pb = projectById.get(b.id);
      return (pa?.sort ?? "") < (pb?.sort ?? "") ? -1 : (pa?.sort ?? "") > (pb?.sort ?? "") ? 1 : 0;
    });

  /* ---- lose Aufgaben je Bereich ---- */
  const areas: PlanArea[] = options.areas
    .map((a) => ({
      id: a.id,
      name: a.name,
      tasks: (looseByArea.get(a.id) ?? []).sort(compareForPlan),
    }))
    .filter((a) => a.tasks.length > 0);

  return {
    open,
    nowCount: nowTasks.length,
    now: nowTasks,
    inbox,
    projects,
    areas,
    shown: candidates.length,
    hiddenByArea,
    searching,
  };
}
