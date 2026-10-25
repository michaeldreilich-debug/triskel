"use client";

import { AlertTriangle, Archive, ExternalLink, Folder, Hourglass, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { ProgressRing, ProjectStatusIcon } from "@/components/ui/progress-ring";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { useAreas } from "@/features/areas/api";
import type { AreaSummary } from "@/features/areas/defaults";
import { useTasks } from "@/features/tasks/api";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { type DatabaseDef, DatabaseView } from "@/features/views/components/database-view";
import {
  PROJECT_BOARD_FIELDS,
  PROJECT_DEFAULTS,
  PROJECT_FIELDS,
  type ProjectViewCtx,
} from "@/features/views/entities/projects";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinDate, formatDue } from "@/lib/dates";
import { useProjectActions, useProjects } from "../api";
import { formatProgress, isStale, projectProgress, stuckReasons, stuckText } from "../rules";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type ProjectRow,
  type ProjectStatus,
  projectTitle,
} from "../types";

/** Aktuelle Zeit, minütlich erneuert (für „14 Tage still“; in Tests per page.clock). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Hinweise mit Grund (Muster 5, #23): „Festgefahren: Ergebnis fehlt“ und „14 Tage still“,
 * als Warnsymbol mit kurzem Text statt Pille.
 */
export function ProjectHints({
  project,
  tasks,
  now,
  className,
}: {
  project: ProjectRow;
  tasks: TaskRow[];
  now: number;
  className?: string;
}) {
  const stuck = stuckReasons(project, tasks);
  const stale = isStale(project, tasks, now);
  if (!stuck.length && !stale) return null;
  return (
    <span className={cn("flex min-w-0 flex-col gap-0.5 text-meta text-warning", className)}>
      {stuck.length ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
          <span className="truncate">{stuckText(stuck)}</span>
        </span>
      ) : null}
      {stale ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Hourglass size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
          <span className="truncate">14 Tage still</span>
        </span>
      ) : null}
    </span>
  );
}

function nextStepOf(project: ProjectRow, tasks: TaskRow[]) {
  const next = tasks.find((t) => t.id === project.next_task_id);
  return next && next.status !== "erledigt" ? next : null;
}

/**
 * Projektzeile (Muster 5): Status als Form (aktiv = Fortschrittsring in Bereichsfarbe), Titel
 * mit nächstem Schritt, Hinweis mit Grund, Ziel und Fortschritt bündig in eigenen Spalten.
 * Am Handy stehen Hinweis und Ziel in einer zweiten Zeile.
 */
export function ProjectListItem({
  project,
  tasks,
  areas,
  now,
}: {
  project: ProjectRow;
  tasks: TaskRow[];
  areas: AreaSummary[];
  now: number;
}) {
  const area = areas.find((a) => a.id === project.area_id);
  const progress = projectProgress(project.id, tasks);
  const next = nextStepOf(project, tasks);
  const title = projectTitle(project);
  return (
    <Link
      href={appPath.project(project.id)}
      data-project-id={project.id}
      className="grid min-h-11 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 rounded-card px-2.5 py-2.5 transition-colors hover:bg-surface md:grid-cols-[22px_minmax(0,1fr)_minmax(0,280px)_88px_52px]"
    >
      <ProjectStatusIcon
        status={project.status}
        color={area?.color}
        progress={progress.ratio}
        label={project.status === "aktiv" ? `Fortschritt ${title}` : undefined}
        className="col-start-1 row-start-1"
      />
      <span className="col-start-2 row-start-1 flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-ui font-medium">{title}</span>
        <span className="truncate text-meta text-faint">
          {next
            ? `Nächster Schritt: ${taskTitle(next)}`
            : progress.total === 0
              ? "Noch keine Aufgaben"
              : "Kein nächster Schritt"}
        </span>
      </span>
      <ProjectHints
        project={project}
        tasks={tasks}
        now={now}
        className="col-start-2 row-start-2 md:col-start-3 md:row-start-1"
      />
      <span className="col-start-3 row-start-2 text-right text-meta text-faint tabular-nums md:col-start-4 md:row-start-1">
        {project.target_date ? (
          `Ziel ${formatDue(project.target_date, berlinDate(new Date(now)))}`
        ) : (
          <span className="max-md:hidden">–</span>
        )}
      </span>
      <span className="col-start-3 row-start-1 text-right text-meta text-muted tabular-nums md:col-start-5">
        {formatProgress(progress)}
      </span>
    </Link>
  );
}

function ProjectCard({
  project,
  tasks,
  areas,
  now,
}: {
  project: ProjectRow;
  tasks: TaskRow[];
  areas: AreaSummary[];
  now: number;
}) {
  const area = areas.find((a) => a.id === project.area_id);
  const progress = projectProgress(project.id, tasks);
  const next = nextStepOf(project, tasks);
  return (
    <article className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
      <Link
        href={appPath.project(project.id)}
        draggable={false}
        className="flex items-start gap-2.5 text-ui font-medium hover:underline"
      >
        <ProgressRing
          value={progress.ratio}
          color={area?.color}
          label={`Fortschritt ${projectTitle(project)}`}
        />
        <span className="min-w-0 break-words">{projectTitle(project)}</span>
        <span className="ml-auto shrink-0 text-meta font-normal text-muted tabular-nums">
          {formatProgress(progress)}
        </span>
      </Link>
      {next ? <p className="truncate text-meta text-muted">→ {taskTitle(next)}</p> : null}
      <ProjectHints project={project} tasks={tasks} now={now} />
    </article>
  );
}

/** Projekte als Datenbank-Ansicht (B6) – Board-Spalten nach Status, Priorität oder Bereich. */
export function ProjectDatabase({ onCount }: { onCount?: (shown: number, total: number) => void }) {
  const projects = useProjects();
  const tasks = useTasks();
  const areas = useAreas();
  const actions = useProjectActions();
  const router = useRouter();
  const now = useNow();
  const taskList = tasks.data ?? [];
  const areaList = areas.data ?? [];
  const ctx: ProjectViewCtx = useMemo(
    () => ({ tasks: taskList, areas: areaList, now }),
    [taskList, areaList, now],
  );
  const queries = [projects, tasks, areas];
  const error = queries.some((q) => q.isError && !q.data);

  const def: DatabaseDef<ProjectRow, ProjectViewCtx> = {
    entity: "projects",
    label: "Projekte",
    hiddenNoun: { one: "weiteres Projekt", many: "weitere Projekte" },
    fields: PROJECT_FIELDS,
    defaults: PROJECT_DEFAULTS,
    boardFields: PROJECT_BOARD_FIELDS,
    searchFields: ["title"],
    areaOf: (p) => p.area_id,
    renderListItem: (p) => (
      <ProjectListItem project={p} tasks={taskList} areas={areaList} now={now} />
    ),
    renderCard: (p) => <ProjectCard project={p} tasks={taskList} areas={areaList} now={now} />,
    contextMenu: (p) => (
      <>
        <ContextMenuItem onSelect={() => router.push(appPath.project(p.id))}>
          <ExternalLink aria-hidden />
          Öffnen
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Status</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={p.status}
              onValueChange={(value) => actions.update(p.id, { status: value as ProjectStatus })}
            >
              {PROJECT_STATUSES.map((s) => (
                <ContextMenuRadioItem key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={() => router.push(appPath.project(p.id, "abschluss"))}>
          <Archive aria-hidden />
          Abschließen …
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="danger" onSelect={() => actions.trash(p.id)}>
          <Trash2 aria-hidden />
          In den Papierkorb
        </ContextMenuItem>
      </>
    ),
    cells: {
      title: (p) => {
        const area = areaList.find((a) => a.id === p.area_id);
        return (
          <Link
            href={appPath.project(p.id)}
            className="inline-flex items-center gap-2 font-medium hover:underline"
          >
            {area ? <AreaDot color={area.color} /> : null}
            {projectTitle(p)}
          </Link>
        );
      },
      status: (p) => <ProjectStatusBadge status={p.status} />,
      progress: (p) => {
        const progress = projectProgress(p.id, taskList);
        const area = areaList.find((a) => a.id === p.area_id);
        return (
          <span className="flex items-center gap-2">
            <ProgressRing
              value={progress.ratio}
              color={area?.color}
              label={`Fortschritt ${projectTitle(p)}`}
            />
            <span className="tabular-nums text-muted">{formatProgress(progress)}</span>
          </span>
        );
      },
      hint: (p) =>
        stuckReasons(p, taskList).length > 0 || isStale(p, taskList, now) ? (
          <ProjectHints project={p} tasks={taskList} now={now} />
        ) : (
          <span className="text-faint">–</span>
        ),
    },
    move: (p, field, value) => {
      if (field === "status") actions.update(p.id, { status: value as ProjectStatus });
      else if (field === "priority") {
        actions.update(p.id, { priority: value ? (Number(value) as 1 | 2 | 3) : null });
      } else if (field === "area" && value) actions.update(p.id, { area_id: value });
    },
    groupDecor: (field, key) => {
      if (field === "status" && (PROJECT_STATUSES as readonly string[]).includes(key))
        return (
          <span aria-hidden className="inline-flex">
            <ProjectStatusIcon status={key as ProjectStatus} size="sm" />
          </span>
        );
      if (field !== "area") return null;
      const area = areaList.find((a) => a.id === key);
      return area ? <AreaDot color={area.color} /> : null;
    },
    boardLimit: (field, value) => (field === "status" && value === "archiv" ? 5 : 50),
    // Darstellung „Kalender“ (S2c): Zieldaten und Meilensteine der gefilterten Projekte im Monat
    calendar: (rows) => ({ projects: rows }),
    archive: { field: "status", value: "archiv", noun: { one: "Projekt", many: "Projekte" } },
    empty: {
      title: "Noch keine Projekte",
      description: "Ein Projekt hat ein Ende – lege es mit „Neues Projekt“ an.",
      icon: <Folder strokeWidth={1.5} />,
    },
  };

  return (
    <DatabaseView
      def={def}
      rows={projects.data ?? []}
      ctx={ctx}
      areas={areaList}
      loading={!error && queries.some((q) => q.isPending)}
      error={error}
      onRetry={() => {
        for (const q of queries) void q.refetch();
      }}
      storageKey="sz:ansicht:projects"
      onCount={onCount}
    />
  );
}
