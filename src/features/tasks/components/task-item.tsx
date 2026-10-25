"use client";

import {
  AppWindow,
  Bot,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  Link2,
  Lock,
  Repeat,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { OPEN_IN_NEW_TAB, useOpenInNewTab } from "@/components/shell/tabs/tabs-provider";
import { ChecklistCount } from "@/components/ui/checklist-count";
import { copyAppLink } from "@/components/ui/copy-link";
import { DueDate } from "@/components/ui/due-date";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { type SwipeAction, SwipeRow, trashSwipe } from "@/components/ui/swipe-row";
import { TaskCheck } from "@/components/ui/task-check";
import type { AreaSummary } from "@/features/areas/defaults";
import { useConvert } from "@/features/convert/api";
import type { MilestoneRow, ProjectRow } from "@/features/projects/types";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinDate, berlinTime, type IsoDate } from "@/lib/dates";
import { type TaskActions, useTaskActions } from "../api";
import { checklistProgress } from "../checklist";
import { useTaskPeek } from "../peek";
import { recurrenceLabel } from "../recurrence";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskRow,
  type TaskStatus,
  taskTitle,
} from "../types";

export interface TaskContext {
  projects: ProjectRow[];
  milestones: MilestoneRow[];
  areas: AreaSummary[];
  blocked: Set<string>;
  today: IsoDate;
}

/** Kontext einer Aufgabe in einer Zeile: Projekt · Meilenstein (bzw. Bereich/Inbox). */
export function taskContextLine(task: TaskRow, ctx: TaskContext, showProject = true): string {
  const project = ctx.projects.find((p) => p.id === task.project_id);
  const milestone = ctx.milestones.find((m) => m.id === task.milestone_id);
  const parts: string[] = [];
  if (showProject && project) parts.push(project.title.trim() || "Ohne Titel");
  if (milestone) parts.push(milestone.title.trim() || "Meilenstein");
  if (!project && task.in_inbox) parts.push("Inbox");
  if (!project && !task.in_inbox && showProject) {
    const area = ctx.areas.find((a) => a.id === task.area_id);
    if (area) parts.push(area.name);
  }
  if (task.body_text) parts.push(task.body_text.split("\n")[0] ?? "");
  return parts.filter(Boolean).join(" · ");
}

/** #77: Arbeitsschritt der KI – dezent markiert (steht nur im Projekt bzw. bei „Zuständig: KI“). */
export function AiAssigneeBadge({ task }: { task: Pick<TaskRow, "assignee"> }) {
  if (task.assignee !== "ai") return null;
  return (
    <span
      title="Zuständig: KI"
      className="shrink-0 rounded-control border border-border px-1 text-meta font-normal leading-4 text-faint"
    >
      KI
    </span>
  );
}

/** „2/5“ der Checkliste einer Aufgabe (#42); ohne Checkliste nichts. */
export function TaskChecklistCount({ task }: { task: TaskRow }) {
  const progress = checklistProgress(task.body);
  return progress ? <ChecklistCount {...progress} /> : null;
}

/** Rechtsklick-Menü einer Aufgabe (feedback.md #3: Kontextaktionen per Rechtsklick). */
export function TaskContextMenuItems({
  task,
  actions,
  onOpen,
}: {
  task: TaskRow;
  actions: TaskActions;
  onOpen: () => void;
}) {
  const today = berlinDate();
  const convert = useConvert();
  const peek = useTaskPeek();
  const openInNewTab = useOpenInNewTab();
  return (
    <>
      <ContextMenuItem onSelect={onOpen}>
        <ExternalLink aria-hidden />
        Öffnen
      </ContextMenuItem>
      {openInNewTab ? (
        <ContextMenuItem onSelect={() => openInNewTab(peek.hrefFor(task.id))}>
          <AppWindow aria-hidden />
          {OPEN_IN_NEW_TAB}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={() => actions.toggle(task.id)}>
        {task.status === "erledigt" ? <Circle aria-hidden /> : <CheckCircle2 aria-hidden />}
        {task.status === "erledigt" ? "Wieder öffnen" : "Erledigt"}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Status</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={task.status}
            onValueChange={(value) => actions.setStatus(task.id, value as TaskStatus)}
          >
            {TASK_STATUSES.map((s) => (
              <ContextMenuRadioItem key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Priorität</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={task.priority ? String(task.priority) : "keine"}
            onValueChange={(value) =>
              actions.update(task.id, {
                priority: value === "keine" ? null : (Number(value) as Priority),
              })
            }
          >
            <ContextMenuRadioItem value="keine">Keine</ContextMenuRadioItem>
            {PRIORITIES.map((p) => (
              <ContextMenuRadioItem key={p} value={String(p)}>
                {PRIORITY_LABELS[p]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        onSelect={() => actions.setFocus(task.id, task.focus_date === today ? null : today)}
      >
        <CalendarCheck2 aria-hidden />
        {task.focus_date === today ? "Fokus heute entfernen" : "Fokus heute"}
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() =>
          actions.update(task.id, { assignee: task.assignee === "ai" ? "user" : "ai" })
        }
      >
        <Bot aria-hidden />
        {task.assignee === "ai" ? "Zuständig: Ich" : "Zuständig: KI"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => convert.taskToNote(task.id)}>
        <FileText aria-hidden />
        In Notiz umwandeln
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => copyAppLink(appPath.task(task.id))}>
        <Link2 aria-hidden />
        Link kopieren
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="danger" onSelect={() => actions.trash(task.id)}>
        <Trash2 aria-hidden />
        In den Papierkorb
      </ContextMenuItem>
    </>
  );
}

/** Wischgesten einer Aufgabe am Handy (Rückmeldung #22): links Papierkorb, rechts erledigt. */
export function taskSwipeActions(
  task: TaskRow,
  actions: TaskActions,
): { left: SwipeAction; right: SwipeAction } {
  const done = task.status === "erledigt";
  return {
    left: trashSwipe(() => actions.trash(task.id)),
    right: {
      label: done ? "Wieder öffnen" : "Erledigt",
      icon: done ? Circle : Check,
      tone: done ? "neutral" : "success",
      onTrigger: () => actions.toggle(task.id),
    },
  };
}

/**
 * Aufgabe als ruhige Listenzeile: Aufgaben-Kreis (Farbe = Priorität, Füllung = Status), Titel,
 * Kontext; rechts die Fälligkeit (Muster 3 und 4, #23).
 * Am Handy wischbar (links Papierkorb, rechts erledigt), am Desktop Rechtsklick-Menü.
 */
export function TaskItem({
  task,
  ctx,
  showProject = true,
  className,
}: {
  task: TaskRow;
  ctx: TaskContext;
  showProject?: boolean;
  className?: string;
}) {
  const actions = useTaskActions();
  const peek = useTaskPeek();
  const done = task.status === "erledigt";
  const blocked = ctx.blocked.has(task.id) && !done;
  const area = ctx.areas.find((a) => a.id === task.area_id);
  const line = taskContextLine(task, ctx, showProject);
  const priority = !done && task.priority && task.priority < 3 ? task.priority : null;

  return (
    <SwipeRow {...taskSwipeActions(task, actions)}>
      <ContextMenuRoot modal={false}>
        <ContextMenuTrigger asChild>
          <div
            data-task-id={task.id}
            className={cn(
              "group flex min-h-11 items-start gap-3 rounded-card px-2.5 py-2 transition-colors hover:bg-surface",
              peek.taskId === task.id && "bg-surface-2 hover:bg-surface-2",
              className,
            )}
          >
            <TaskCheck
              status={task.status}
              priority={task.priority}
              onCheckedChange={() => actions.toggle(task.id)}
              aria-label={`„${taskTitle(task)}“ ${done ? "wieder öffnen" : "erledigt"}`}
              className="mt-0.5"
            />
            <Link
              href={peek.hrefFor(task.id)}
              scroll={false}
              className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-control"
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 text-ui font-medium",
                  done && "text-faint line-through",
                  (blocked || task.assignee === "ai") && "text-muted",
                )}
              >
                {blocked ? (
                  <Lock
                    size={13}
                    strokeWidth={1.5}
                    className="shrink-0 text-faint"
                    aria-label="Blockiert"
                  />
                ) : null}
                <span className="truncate">{taskTitle(task)}</span>
                <AiAssigneeBadge task={task} />
                {priority ? (
                  <span className="sr-only">, Priorität {PRIORITY_LABELS[priority]}</span>
                ) : null}
              </span>
              {line || task.recurrence || task.scheduled_at || checklistProgress(task.body) ? (
                <span className="flex min-w-0 items-center gap-1.5 text-meta text-faint">
                  {showProject && area && !task.in_inbox ? <AreaDot color={area.color} /> : null}
                  {task.scheduled_at ? (
                    <span className="shrink-0 tabular-nums">{berlinTime(task.scheduled_at)}</span>
                  ) : null}
                  {task.recurrence ? (
                    <Repeat
                      size={12}
                      strokeWidth={1.5}
                      className="shrink-0"
                      aria-label={`Wiederholt sich: ${recurrenceLabel(task.recurrence)}`}
                    />
                  ) : null}
                  <TaskChecklistCount task={task} />
                  <span className="truncate">{line}</span>
                </span>
              ) : null}
            </Link>
            {task.due_date ? (
              <span className="flex shrink-0 items-center pt-0.5">
                <DueDate value={task.due_date} today={ctx.today} done={done} />
              </span>
            ) : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`Aufgabe „${taskTitle(task)}“`}>
          <TaskContextMenuItems task={task} actions={actions} onOpen={() => peek.open(task.id)} />
        </ContextMenuContent>
      </ContextMenuRoot>
    </SwipeRow>
  );
}
