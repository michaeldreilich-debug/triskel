"use client";

/**
 * Projektübersicht (#55, Variante 3): Kennzahlen-Kacheln im Kopf und Karten „Nächster Schritt“
 * je aktivem Projekt. Alles ohne Fläche (Muster 1: höchstens eine gefüllte Karte je Seite):
 * Kacheln durch feine Linien getrennt, Karten mit leichtem Rahmen.
 */
import { AppWindow, ExternalLink, Link2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OPEN_IN_NEW_TAB, useOpenInNewTab } from "@/components/shell/tabs/tabs-provider";
import { copyAppLink } from "@/components/ui/copy-link";
import { DueDate } from "@/components/ui/due-date";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { ProgressRing } from "@/components/ui/progress-ring";
import type { AreaSummary } from "@/features/areas/defaults";
import { ProjectHints } from "@/features/projects/components/project-database";
import { formatProgress, projectProgress } from "@/features/projects/rules";
import { projectTitle } from "@/features/projects/types";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { formatMonth, type IsoDate } from "@/lib/dates";
import type { NextStepCard, TimelineStats } from "../model";

function Tile({
  label,
  value,
  sub,
  tone,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  tone?: "danger";
  testId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-bg p-4">
      <p
        data-testid={testId}
        className={cn(
          "heading text-title-sm leading-none tabular-nums md:text-title",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-ui-sm font-medium">{label}</p>
      <p className="text-meta text-faint tabular-nums">{sub}</p>
    </div>
  );
}

/** Vier Kennzahlen: aktive Projekte, Meilensteine diesen Monat, überfällige, Fortschritt. */
export function StatTiles({ stats, today }: { stats: TimelineStats; today: IsoDate }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Gruppe von Kacheln, kein Formular
    <div
      role="group"
      aria-label="Kennzahlen"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border lg:grid-cols-4"
    >
      <Tile
        testId="timeline-stat-active"
        label="Aktive Projekte"
        value={stats.active}
        sub={stats.active === 1 ? "läuft gerade" : "laufen gerade"}
      />
      <Tile
        testId="timeline-stat-month"
        label={`Meilensteine ${formatMonth(today, { year: false })}`}
        value={stats.monthMilestones}
        sub={`${stats.monthDone} erreicht`}
      />
      <Tile
        testId="timeline-stat-overdue"
        label="Überfällige Meilensteine"
        value={stats.overdueMilestones}
        tone={stats.overdueMilestones > 0 ? "danger" : undefined}
        sub={
          stats.overdueMilestones === 0
            ? "alles im Plan"
            : `in ${stats.overdueProjects} ${stats.overdueProjects === 1 ? "Projekt" : "Projekten"}`
        }
      />
      <Tile
        testId="timeline-stat-progress"
        label="Fortschritt"
        value={stats.progress === null ? "–" : `${Math.round(stats.progress * 100)} %`}
        sub={
          stats.taskTotal === 0
            ? "noch keine Aufgaben"
            : `${stats.taskDone} von ${stats.taskTotal} Aufgaben aktiver Projekte`
        }
      />
    </div>
  );
}

/** Karte je aktivem Projekt: nächster Schritt, nächster Meilenstein, Fortschritt als Ring, Ziel. */
export function NextStepCardView({
  card,
  area,
  tasks,
  today,
  now,
}: {
  card: NextStepCard;
  area: AreaSummary | undefined;
  tasks: TaskRow[];
  today: IsoDate;
  now: number;
}) {
  const router = useRouter();
  const openInNewTab = useOpenInNewTab();
  const { project, task, milestone } = card;
  const progress = projectProgress(project.id, tasks);
  const title = projectTitle(project);
  const href = appPath.project(project.id);
  return (
    <ContextMenuRoot modal={false}>
      <ContextMenuTrigger asChild>
        <article
          data-timeline-card={project.id}
          className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-4"
        >
          <div className="flex items-center justify-between gap-2 text-meta text-faint">
            <span className="flex min-w-0 items-center gap-1.5">
              {area ? <AreaDot color={area.color} /> : null}
              <span className="truncate">{area?.name ?? ""}</span>
            </span>
            {project.target_date ? (
              <DueDate value={project.target_date} today={today} prefix="Ziel " />
            ) : (
              <span>kein Ziel</span>
            )}
          </div>
          <div className="flex items-start gap-3">
            <Link
              href={href}
              className="heading min-w-0 flex-1 text-body-lg/snug break-words hover:underline"
            >
              {title}
            </Link>
            <span className="flex shrink-0 items-center gap-2 text-ui-sm text-muted tabular-nums">
              <ProgressRing
                value={progress.ratio}
                color={area?.color}
                label={`Fortschritt ${title}`}
              />
              {formatProgress(progress)}
            </span>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-dashed border-border-strong pt-3 text-ui-sm">
            <dt className="font-medium text-muted">Nächster Schritt</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
              {task ? (
                <>
                  <Link
                    href={appPath.task(task.id)}
                    className="min-w-0 break-words hover:underline"
                  >
                    {taskTitle(task)}
                  </Link>
                  <DueDate value={task.due_date} today={today} />
                </>
              ) : (
                <span className="text-faint">
                  {progress.total === 0 ? "noch keine Aufgaben" : "keiner festgelegt"}
                </span>
              )}
            </dd>
            <dt className="font-medium text-muted">Meilenstein</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
              {milestone ? (
                <>
                  <span className="min-w-0 break-words">
                    {milestone.title.trim() || "Meilenstein"}
                  </span>
                  <DueDate value={milestone.due_date} today={today} />
                </>
              ) : (
                <span className="text-faint">keiner offen</span>
              )}
            </dd>
          </dl>
          <ProjectHints project={project} tasks={tasks} now={now} />
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => router.push(href)}>
          <ExternalLink aria-hidden />
          Öffnen
        </ContextMenuItem>
        {openInNewTab ? (
          <ContextMenuItem onSelect={() => openInNewTab(href)}>
            <AppWindow aria-hidden />
            {OPEN_IN_NEW_TAB}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => void copyAppLink(href)}>
          <Link2 aria-hidden />
          Link kopieren
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
