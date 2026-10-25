"use client";

import { Lock, Repeat } from "lucide-react";
import Link from "next/link";
import { DueDate } from "@/components/ui/due-date";
import { AreaDot } from "@/components/ui/pill";
import { TaskCheck } from "@/components/ui/task-check";
import { cn } from "@/lib/cn";
import { useTaskActions } from "../api";
import { checklistProgress } from "../checklist";
import { useTaskPeek } from "../peek";
import { PRIORITY_LABELS, type TaskRow, taskTitle } from "../types";
import { AiAssigneeBadge, TaskChecklistCount, type TaskContext } from "./task-item";

/** Karte im Board: Kreis (Priorität, Status), Titel, Projekt, Fälligkeit; blockiert gestrichelt mit Grund. */
export function TaskCard({
  task,
  ctx,
  blockers = [],
}: {
  task: TaskRow;
  ctx: TaskContext;
  blockers?: TaskRow[];
}) {
  const actions = useTaskActions();
  const peek = useTaskPeek();
  const done = task.status === "erledigt";
  const blocked = ctx.blocked.has(task.id) && !done;
  const project = ctx.projects.find((p) => p.id === task.project_id);
  const area = ctx.areas.find((a) => a.id === task.area_id);
  const priority = !done && task.priority && task.priority < 3 ? task.priority : null;
  const openBlockers = blockers.filter((b) => b.status !== "erledigt");
  return (
    <article
      data-task-id={task.id}
      className={cn(
        "relative flex flex-col gap-2 rounded-card border bg-surface p-3",
        blocked ? "border-dashed border-border-strong" : "border-border",
        peek.taskId === task.id && "border-border-strong bg-surface-2",
      )}
    >
      <div className="flex items-start gap-2.5">
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
          draggable={false}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-1.5 text-ui font-medium",
            done && "text-faint line-through",
            (blocked || task.assignee === "ai") && "text-muted",
          )}
        >
          {blocked ? (
            <Lock
              size={13}
              strokeWidth={1.5}
              className="mt-1 shrink-0 text-faint"
              aria-label="Blockiert"
            />
          ) : null}
          <span className="min-w-0 break-words">{taskTitle(task)}</span>
          <AiAssigneeBadge task={task} />
          {priority ? (
            <span className="sr-only">, Priorität {PRIORITY_LABELS[priority]}</span>
          ) : null}
        </Link>
      </div>
      {blocked && openBlockers.length > 0 ? (
        <p className="text-meta text-faint">
          Blockiert durch: {openBlockers.map((b) => taskTitle(b)).join(", ")}
        </p>
      ) : null}
      {project || task.due_date || task.recurrence || checklistProgress(task.body) ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-faint">
          {project ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {area ? <AreaDot color={area.color} /> : null}
              <span className="truncate">{project.title || "Ohne Titel"}</span>
            </span>
          ) : null}
          {task.recurrence ? (
            <Repeat size={12} strokeWidth={1.5} aria-label="Wiederkehrend" />
          ) : null}
          <TaskChecklistCount task={task} />
          <DueDate value={task.due_date} today={ctx.today} done={done} className="ml-auto" />
        </div>
      ) : null}
    </article>
  );
}
