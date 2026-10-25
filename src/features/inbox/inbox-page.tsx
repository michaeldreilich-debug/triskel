"use client";

import { CheckCircle2, FileText, Inbox as InboxIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AreaDot } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SwipeRow } from "@/components/ui/swipe-row";
import { TaskCheck } from "@/components/ui/task-check";
import type { AreaSummary } from "@/features/areas/defaults";
import { useConvert } from "@/features/convert/api";
import type { ProjectRow } from "@/features/projects/types";
import { useTaskActions } from "@/features/tasks/api";
import { ProjectPicker } from "@/features/tasks/components/pickers";
import { taskSwipeActions } from "@/features/tasks/components/task-item";
import { useTaskData } from "@/features/tasks/hooks";
import { useTaskPeek } from "@/features/tasks/peek";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { formatListDate } from "@/lib/dates";
import { CaptureField } from "./capture";

/** Einträge der Inbox: ungeordnet und offen, neueste zuerst. */
export const inboxItems = (tasks: TaskRow[]) =>
  tasks
    .filter((t) => t.in_inbox && t.status !== "erledigt")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

/**
 * „Zuordnen“ (E13): Bereich oder Projekt setzen oder den Eintrag in eine Notiz umwandeln.
 * Danach verlässt er die Inbox.
 */
export function AssignPopover({
  task,
  areas,
  projects,
  label = "Zuordnen",
}: {
  task: TaskRow;
  areas: AreaSummary[];
  projects: ProjectRow[];
  label?: string;
}) {
  const actions = useTaskActions();
  const convert = useConvert();
  const [open, setOpen] = useState(false);
  const done = () => setOpen(false);

  const toNote = () => {
    done();
    convert.taskToNote(task.id);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {/* leise, weil er in jeder Zeile steht (Muster 8, #23) */}
        <Button size="sm" variant="ghost" aria-label={`„${taskTitle(task)}“ zuordnen`}>
          {label}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={16}
          aria-label={`„${taskTitle(task)}“ zuordnen`}
          className="z-50 flex w-72 max-w-[calc(100vw-32px)] flex-col gap-3 rounded-card border border-border bg-surface p-3 text-fg shadow-float data-[state=open]:animate-pop-in"
        >
          <div className="flex flex-col gap-1.5">
            <p className="text-meta uppercase tracking-widest text-faint">Bereich</p>
            <div className="flex flex-wrap gap-2">
              {areas.map((area) => (
                <Button
                  key={area.id}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    actions.update(task.id, { area_id: area.id, in_inbox: false });
                    done();
                  }}
                >
                  <AreaDot color={area.color} />
                  {area.name}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-meta uppercase tracking-widest text-faint">Projekt</p>
            <ProjectPicker
              variant="button"
              label="Projekt wählen …"
              value={task.project_id}
              projects={projects}
              areas={areas}
              onSelect={(projectId) => {
                if (!projectId) return;
                actions.update(task.id, { project_id: projectId, in_inbox: false });
                done();
              }}
            />
          </div>
          <div className="-mx-1 flex flex-col border-t border-border pt-2">
            <Button variant="ghost" size="sm" className="justify-start" onClick={toNote}>
              <FileText size={16} strokeWidth={1.5} aria-hidden />
              Als Notiz anlegen
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                actions.complete(task.id);
                done();
              }}
            >
              <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden />
              Erledigt
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-danger hover:text-danger"
              onClick={() => {
                actions.trash(task.id);
                done();
              }}
            >
              <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              In den Papierkorb
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function InboxItem({
  task,
  areas,
  projects,
}: {
  task: TaskRow;
  areas: AreaSummary[];
  projects: ProjectRow[];
}) {
  const actions = useTaskActions();
  const peek = useTaskPeek();
  const convert = useConvert();
  // Wischen: links Papierkorb, rechts erledigt (verlässt die Inbox, gleitet also hinaus)
  const swipe = taskSwipeActions(task, actions);
  return (
    <SwipeRow left={swipe.left} right={{ ...swipe.right, dismiss: true }}>
      <div
        data-task-id={task.id}
        className="flex min-h-11 items-center gap-3 rounded-card px-2.5 py-2 hover:bg-surface"
      >
        <TaskCheck
          status={task.status}
          priority={task.priority}
          onCheckedChange={() => actions.complete(task.id)}
          aria-label={`„${taskTitle(task)}“ erledigt`}
        />
        <Link href={peek.hrefFor(task.id)} scroll={false} className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-medium">{taskTitle(task)}</span>
          <span className="text-meta text-faint tabular-nums">
            {formatListDate(task.created_at)}
          </span>
        </Link>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`„${taskTitle(task)}“ als Notiz anlegen`}
          title="Als Notiz anlegen"
          onClick={() => convert.taskToNote(task.id)}
          className="shrink-0 max-md:w-11 max-md:px-0"
        >
          <FileText size={16} strokeWidth={1.5} aria-hidden />
          <span className="max-md:hidden">→ Notiz</span>
        </Button>
        <AssignPopover task={task} areas={areas} projects={projects} />
      </div>
    </SwipeRow>
  );
}

/** Inbox (B8): Schnellerfassung oben, ungeordnete Einträge darunter. */
export function InboxPage() {
  const data = useTaskData({ forMe: true });
  const items = inboxItems(data.tasks);
  return (
    <Page>
      <PageHeader
        title="Inbox"
        meta={data.loading ? "Ungeordnetes" : `${items.length} ungeordnet`}
      />
      <CaptureField autoFocus />
      {data.error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-card border border-danger/50 p-4 text-ui"
        >
          <p className="text-danger">Inbox konnte nicht geladen werden. Verbindung prüfen.</p>
          <Button size="sm" onClick={data.retry}>
            Erneut laden
          </Button>
        </div>
      ) : data.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">Inbox wird geladen</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<InboxIcon strokeWidth={1.5} />}
          title="Inbox leer"
          description="Alles zugeordnet. Neues oben eintippen – ohne Kürzel landet es hier."
        />
      ) : (
        <ul aria-label="Inbox" className="flex flex-col gap-0.5">
          {items.map((task) => (
            <li key={task.id}>
              <InboxItem task={task} areas={data.ctx.areas} projects={data.ctx.projects} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
