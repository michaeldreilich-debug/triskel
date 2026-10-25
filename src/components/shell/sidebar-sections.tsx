"use client";

import { FileText, Folder, SquareCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useAreas } from "@/features/areas/api";
import { useNotes } from "@/features/notes/api";
import { useProjects } from "@/features/projects/api";
import { MAX_ACTIVE_PER_AREA, projectProgress } from "@/features/projects/rules";
import { projectTitle } from "@/features/projects/types";
import { useTasks } from "@/features/tasks/api";
import { useTaskPeek } from "@/features/tasks/peek";
import { isForMe } from "@/features/tasks/types";
import type { Entity } from "@/features/views/config";
import { savedViewHref, useSavedViews, viewsInArea } from "@/features/views/saved";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui-store";
import { type RecentItem, recentItems } from "./recent";
import { navItemClasses, SidebarSection } from "./sidebar";

const ENTITY_ICONS: Record<Entity, typeof Folder> = {
  tasks: SquareCheck,
  projects: Folder,
  notes: FileText,
};

const RECENT_ICONS: Record<RecentItem["kind"], typeof Folder> = {
  note: FileText,
  project: Folder,
  task: SquareCheck,
};

const itemClasses = (active: boolean) => navItemClasses(active, "quiet");

/**
 * Aktive Projekte des gewählten Bereichs (Entwurf 05: „Aktive Projekte · Beruf“), je mit
 * kleinem Fortschrittsring in Bereichsfarbe (Muster 5, #23).
 */
export function ActiveProjectsNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const area = useUi((s) => s.area);
  const projects = useProjects();
  const tasks = useTasks();
  const areas = useAreas();
  const areaList = areas.data ?? [];
  const activeArea = area && areaList.some((a) => a.id === area) ? area : null;
  const inArea = (projects.data ?? []).filter((p) => !activeArea || p.area_id === activeArea);
  const active = inArea.filter((p) => p.status === "aktiv");
  const planned = inArea.filter((p) => p.status === "geplant").length;
  const areaName = areaList.find((a) => a.id === activeArea)?.name;
  const limit = activeArea
    ? MAX_ACTIVE_PER_AREA
    : MAX_ACTIVE_PER_AREA * Math.max(1, areaList.length);

  return (
    <SidebarSection id="projekte" title={`Aktive Projekte${areaName ? ` · ${areaName}` : ""}`}>
      {projects.isPending ? null : active.length === 0 ? (
        <p className="px-2 text-ui-sm text-faint">Noch keine aktiven Projekte.</p>
      ) : (
        active
          .sort((a, b) => projectTitle(a).localeCompare(projectTitle(b), "de"))
          .map((project) => {
            const color = areaList.find((a) => a.id === project.area_id)?.color;
            const href = appPath.project(project.id);
            return (
              <Link
                key={project.id}
                href={href}
                onClick={onNavigate}
                aria-current={pathname === href ? "page" : undefined}
                className={itemClasses(pathname === href)}
              >
                {color ? (
                  <ProgressRing
                    size="xs"
                    decorative
                    value={projectProgress(project.id, tasks.data ?? []).ratio}
                    color={color}
                    label={`Fortschritt ${projectTitle(project)}`}
                  />
                ) : null}
                <span className="truncate">{projectTitle(project)}</span>
              </Link>
            );
          })
      )}
      {active.length > 0 || planned > 0 ? (
        <p
          className={cn(
            "px-2 pt-0.5 text-meta tabular-nums",
            active.length > limit ? "text-warning" : "text-faint",
          )}
        >
          {active.length} / {limit} aktiv{planned ? ` · ${planned} geplant` : ""}
        </p>
      ) : null}
    </SidebarSection>
  );
}

/** Gespeicherte Ansichten des gewählten Bereichs (Entwurf 06). */
export function SavedViewsNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const area = useUi((s) => s.area);
  const saved = useSavedViews();
  const areas = useAreas();
  const activeArea = area && (areas.data ?? []).some((a) => a.id === area) ? area : null;
  const views = viewsInArea(saved.data ?? [], activeArea);
  if (views.length === 0) return null;
  return (
    <SidebarSection id="ansichten" title="Gespeicherte Ansichten">
      {views.map((view) => {
        const Icon = ENTITY_ICONS[view.entity];
        const href = savedViewHref(view);
        const active = params.get("ansicht") === view.id && href.startsWith(pathname);
        return (
          <Link
            key={view.id}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={itemClasses(active)}
          >
            <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
            <span className="truncate">{view.name}</span>
          </Link>
        );
      })}
    </SidebarSection>
  );
}

/** „Zuletzt bearbeitet“ (#30, wie bei Notion): Notizen, Projekte und Aufgaben (#38) im Bereich. */
export function RecentNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const area = useUi((s) => s.area);
  const notes = useNotes();
  const projects = useProjects();
  const tasks = useTasks();
  const areas = useAreas();
  const peek = useTaskPeek();
  const activeArea = area && (areas.data ?? []).some((a) => a.id === area) ? area : null;
  // Aufgaben öffnen als Panel auf der aktuellen Seite (?aufgabe=)
  const items = recentItems(
    {
      notes: notes.data ?? [],
      projects: projects.data ?? [],
      // #77: Arbeitsschritte der KI nur im Projekt
      tasks: (tasks.data ?? []).filter(isForMe),
    },
    activeArea,
    { taskHref: peek.hrefFor },
  );
  if (items.length === 0) return null;
  return (
    <SidebarSection id="zuletzt" title="Zuletzt bearbeitet">
      <ul aria-label="Zuletzt bearbeitet" className="flex flex-col gap-px">
        {items.map((item) => {
          const Icon = RECENT_ICONS[item.kind];
          const active = item.kind === "task" ? peek.taskId === item.id : pathname === item.href;
          return (
            <li key={`${item.kind}-${item.id}`}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={itemClasses(active)}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
                <span className="truncate">{item.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
}
