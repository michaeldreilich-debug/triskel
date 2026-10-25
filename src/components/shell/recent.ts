/**
 * „Zuletzt bearbeitet“ in der Seitenleiste (Rückmeldung #30, wie bei Notion): Notizen, Projekte
 * und Aufgaben nach der letzten Bearbeitung, neueste zuerst, im gewählten Bereich. Aufgaben
 * zählen nur, wenn Titel, Notiz oder Checkliste geändert wurden (#38, `tasks.edited_at`) – nicht
 * beim Abhaken, Verschieben oder Anlegen; erledigte fallen heraus wie archivierte Notizen.
 */
import { type NoteRow, noteTitle } from "@/features/notes/types";
import { type ProjectRow, projectTitle } from "@/features/projects/types";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";

export const RECENT_LIMIT = 5;

export interface RecentItem {
  kind: "note" | "project" | "task";
  id: string;
  title: string;
  href: string;
  at: string;
}

export interface RecentSources {
  notes: Pick<NoteRow, "id" | "title" | "area_id" | "edited_at" | "updated_at" | "archived_at">[];
  projects: Pick<ProjectRow, "id" | "title" | "area_id" | "updated_at">[];
  tasks?: Pick<TaskRow, "id" | "title" | "area_id" | "edited_at" | "status">[];
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

export function recentItems(
  { notes, projects, tasks = [] }: RecentSources,
  areaId: string | null,
  options: { limit?: number; taskHref?: (id: string) => string } = {},
): RecentItem[] {
  const inArea = (row: { area_id: string | null }) => !areaId || row.area_id === areaId;
  const taskHref = options.taskHref ?? appPath.task;
  const items: RecentItem[] = [
    ...notes
      .filter((n) => !n.archived_at && inArea(n))
      .map((n) => ({
        kind: "note" as const,
        id: n.id,
        title: noteTitle(n),
        href: appPath.note(n.id),
        at: n.edited_at || n.updated_at,
      })),
    ...projects.filter(inArea).map((p) => ({
      kind: "project" as const,
      id: p.id,
      title: projectTitle(p),
      href: appPath.project(p.id),
      at: p.updated_at,
    })),
    ...tasks
      .filter((t) => t.edited_at && t.status !== "erledigt" && inArea(t))
      .map((t) => ({
        kind: "task" as const,
        id: t.id,
        title: taskTitle(t),
        href: taskHref(t.id),
        at: t.edited_at as string,
      })),
  ];
  return items.sort((a, b) => time(b.at) - time(a.at)).slice(0, options.limit ?? RECENT_LIMIT);
}
