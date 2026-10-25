"use client";

/**
 * Kärtchen beim Drüberfahren (#61): voller Titel, Projekt › Meilenstein (bzw. Inbox/Bereich),
 * Fälligkeit, Uhrzeit, Priorität und der Anfang der Notiz – damit klar ist, was eingeplant wird,
 * auch wenn der Titel in der Spalte gekürzt ist. Nur mit Maus (Radix öffnet bei Berührung nicht),
 * am Handy stehen Titel und Projekt ungekürzt in der Zeile. Beim Ziehen schließt es.
 */
import { HoverCard } from "radix-ui";
import { useState } from "react";
import { AreaDot } from "@/components/ui/pill";
import { PRIORITY_LABELS, type TaskRow, taskTitle } from "@/features/tasks/types";
import { berlinDate, berlinTime, formatDue } from "@/lib/dates";
import { formatMinutes } from "../layout";
import { useCalendar } from "./calendar-context";

export type HoverSide = "top" | "right" | "bottom" | "left";

/** „Projekt › Meilenstein“, sonst Inbox bzw. Bereich. */
export function taskPlaceLine(
  task: TaskRow,
  ctx: Pick<ReturnType<typeof useCalendar>["ctx"], "projects" | "milestones" | "areas">,
): string {
  const project = ctx.projects.find((p) => p.id === task.project_id);
  const milestone = ctx.milestones.find((m) => m.id === task.milestone_id);
  if (project) {
    const name = project.title.trim() || "Ohne Titel";
    return milestone ? `${name} › ${milestone.title.trim() || "Meilenstein"}` : name;
  }
  if (task.in_inbox) return "Inbox";
  return ctx.areas.find((a) => a.id === task.area_id)?.name ?? "";
}

export function TaskHover({
  task,
  side = "top",
  children,
}: {
  task: TaskRow;
  side?: HoverSide;
  children: React.ReactElement;
}) {
  const { ctx, today } = useCalendar();
  const [open, setOpen] = useState(false);
  const area = ctx.areas.find((a) => a.id === task.area_id);
  const place = taskPlaceLine(task, ctx);
  const when: string[] = [];
  if (task.due_date) when.push(`fällig ${formatDue(task.due_date, today)}`);
  if (task.scheduled_at) {
    const duration = task.duration_min ? ` · ${formatMinutes(task.duration_min)}` : "";
    when.push(
      `${formatDue(berlinDate(new Date(task.scheduled_at)), today)} ${berlinTime(task.scheduled_at)}${duration}`,
    );
  }
  if (task.priority && task.priority < 3) when.push(`Priorität ${PRIORITY_LABELS[task.priority]}`);
  const note = task.body_text.trim().split("\n").slice(0, 3).join(" · ");
  return (
    <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={400} closeDelay={80}>
      <HoverCard.Trigger asChild onPointerDown={() => setOpen(false)}>
        {children}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side={side}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          data-testid="task-hover"
          className="z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-card border border-border bg-surface p-3 text-fg shadow-float data-[state=open]:animate-pop-in"
        >
          <p className="text-ui font-medium break-words">{taskTitle(task)}</p>
          {place ? (
            <p className="flex items-center gap-1.5 text-ui-sm text-muted">
              {area ? <AreaDot color={area.color} /> : null}
              <span className="min-w-0 break-words">{place}</span>
            </p>
          ) : null}
          {when.length ? (
            <p className="text-meta text-faint tabular-nums">{when.join(" · ")}</p>
          ) : null}
          {note ? <p className="line-clamp-3 text-meta text-faint break-words">{note}</p> : null}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
