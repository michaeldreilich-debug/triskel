"use client";

import { Lock, Repeat, SquareCheck } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { AreaDot } from "@/components/ui/pill";
import { PriorityBadge, TaskStatusBadge } from "@/components/ui/status-badge";
import { TaskCheck } from "@/components/ui/task-check";
import { CELL_CONTROL, CellMenu } from "@/features/views/components/cells";
import {
  type DatabaseDef,
  DatabaseView,
  type StorageUpgrade,
} from "@/features/views/components/database-view";
import { defaultCell } from "@/features/views/components/table-view";
import type { ViewConfig } from "@/features/views/engine";
import {
  FOR_ME_FILTER,
  TASK_BOARD_FIELDS,
  TASK_DEFAULTS,
  TASK_FIELDS,
  type TaskViewCtx,
  withForMeFilter,
} from "@/features/views/entities/tasks";
import { projectGroupLink } from "@/features/views/group-link";
import { cn } from "@/lib/cn";
import { berlinDate, berlinDateTime, berlinTime, formatDateShort, type IsoDate } from "@/lib/dates";
import { useTaskActions } from "../api";
import { blockersOf } from "../dependencies";
import { useTaskData } from "../hooks";
import { useTaskPeek } from "../peek";
import { recurrenceLabel } from "../recurrence";
import {
  ASSIGNEE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskAssignee,
  type TaskRow,
  type TaskStatus,
  taskTitle,
} from "../types";
import { ProjectField } from "./pickers";
import { TaskCard } from "./task-card";
import { TaskDragSource } from "./task-dnd";
import { AiAssigneeBadge, TaskContextMenuItems, TaskItem } from "./task-item";

/** „Keine“ im Menü (Radix braucht einen Wert) */
const NONE = "__keine__";

/**
 * Lokaler Ansichts-Zustand der Aufgaben-Datenbank (`:2` seit #48, Gruppierung nach Projekt;
 * `:3` seit #77, Filter „Zuständig: Ich“)
 */
const TASKS_STORAGE_KEY = "sz:ansicht:tasks:3";

export interface TaskDatabaseProps {
  /** nur Aufgaben dieses Projekts (Projekt-Reiter) */
  projectId?: string;
  /** Vorgabe ohne gespeicherte Ansicht (z. B. Projekt-Reiter: Board) */
  defaults?: Partial<ViewConfig>;
  storageKey?: string;
  savedViews?: boolean;
  /** Älterer Stand dieses Geräts, der einmal übernommen wird (Projekt-Reiter, #91) */
  storageUpgrade?: StorageUpgrade | StorageUpgrade[];
  /** Bereich für „+ Neu“ im Board (null = Inbox) */
  newTaskArea: string | null;
  onCount?: (shown: number, total: number) => void;
  /** Aufgaben in Liste und Tabelle lassen sich ziehen (Projekt-Reiter: auf „Nächster Schritt“, #89) */
  draggable?: boolean;
}

/** Aufgaben als generische Datenbank-Ansicht (Liste, Tabelle, Board). */
export function TaskDatabase({
  projectId,
  defaults,
  storageKey = TASKS_STORAGE_KEY,
  savedViews = true,
  storageUpgrade,
  newTaskArea,
  onCount,
  draggable = false,
}: TaskDatabaseProps) {
  const data = useTaskData();
  const actions = useTaskActions();
  const peek = useTaskPeek();
  const { tasks, deps } = data;

  const ctx: TaskViewCtx = useMemo(
    () => ({ ...data.ctx, blockersOf: (id: string) => blockersOf(id, tasks, deps) }),
    [data.ctx, tasks, deps],
  );
  const rows = projectId ? tasks.filter((t) => t.project_id === projectId) : tasks;
  const today = berlinDate();
  /** Datum in der Tabelle ändern (#87): Anzeige wie bisher (`defaultCell`), Klick öffnet den Kalender */
  const dateCell = (
    t: TaskRow,
    key: string,
    label: string,
    onChange: (value: IsoDate | null) => void,
  ) => {
    const field = TASK_FIELDS.find((f) => f.key === key);
    const value = field?.value(t, ctx);
    return (
      <DatePicker
        variant="quiet"
        aria-label={`${label}: ${value ? formatDateShort(String(value)) : "kein Datum"}`}
        value={value ? (String(value) as IsoDate) : null}
        onChange={onChange}
        className={CELL_CONTROL}
        display={field ? defaultCell(field, t, ctx, today) : null}
      />
    );
  };

  const def: DatabaseDef<TaskRow, TaskViewCtx> = {
    entity: "tasks",
    label: "Aufgaben",
    hiddenNoun: { one: "weitere Aufgabe", many: "weitere Aufgaben" },
    fields: projectId
      ? TASK_FIELDS.filter((f) => f.key !== "project" && f.key !== "area")
      : TASK_FIELDS,
    // im Projekt alle (KI-Aufgaben dezent), sonst nur die des Nutzers (#77)
    defaults: {
      ...TASK_DEFAULTS,
      ...(projectId ? {} : { filters: [...TASK_DEFAULTS.filters, FOR_ME_FILTER] }),
      ...defaults,
    },
    boardFields: TASK_BOARD_FIELDS,
    // #79: in der Übersicht sind die Projekte beim Öffnen zu, „Ohne Projekt“ (oben) offen
    startClosed: projectId ? undefined : { group: "project", open: [""] },
    searchFields: ["title"],
    areaOf: (t) => t.area_id,
    renderListItem: (t) => (
      <TaskDragSource task={t} scope="liste" disabled={!draggable}>
        <TaskItem task={t} ctx={ctx} showProject={!projectId} />
      </TaskDragSource>
    ),
    renderCard: (t) => <TaskCard task={t} ctx={ctx} blockers={ctx.blockersOf(t.id)} />,
    contextMenu: (t) => (
      <TaskContextMenuItems task={t} actions={actions} onOpen={() => peek.open(t.id)} />
    ),
    cells: {
      title: (t) => {
        const done = t.status === "erledigt";
        const blocked = ctx.blocked.has(t.id) && !done;
        return (
          <TaskDragSource
            task={t}
            scope="tabelle"
            disabled={!draggable}
            className="flex items-center gap-2.5"
          >
            <TaskCheck
              status={t.status}
              priority={t.priority}
              onCheckedChange={() => actions.toggle(t.id)}
              aria-label={`„${taskTitle(t)}“ ${done ? "wieder öffnen" : "erledigt"}`}
            />
            {blocked ? (
              <Lock
                size={13}
                strokeWidth={1.5}
                className="shrink-0 text-faint"
                aria-label="Blockiert"
              />
            ) : null}
            <Link
              href={peek.hrefFor(t.id)}
              scroll={false}
              className={cn(
                "truncate font-medium hover:underline",
                done && "text-faint line-through",
              )}
            >
              {taskTitle(t)}
            </Link>
            <AiAssigneeBadge task={t} />
          </TaskDragSource>
        );
      },
      // #87: Eigenschaften direkt in der Zelle ändern – dieselben Aktionen wie im Panel
      status: (t) => (
        <CellMenu
          label="Status"
          value={t.status}
          options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
          onChange={(value) => actions.setStatus(t.id, value as TaskStatus)}
        >
          <TaskStatusBadge status={t.status} />
        </CellMenu>
      ),
      priority: (t) => (
        <CellMenu
          label="Priorität"
          value={t.priority ? String(t.priority) : NONE}
          options={[
            ...PRIORITIES.map((p) => ({ value: String(p), label: PRIORITY_LABELS[p] })),
            { value: NONE, label: "Keine" },
          ]}
          onChange={(value) =>
            actions.update(t.id, { priority: value === NONE ? null : (Number(value) as Priority) })
          }
        >
          {t.priority ? (
            <PriorityBadge priority={t.priority} />
          ) : (
            <span className="text-faint">–</span>
          )}
        </CellMenu>
      ),
      due_date: (t) =>
        dateCell(t, "due_date", "Fällig", (value) => actions.update(t.id, { due_date: value })),
      // wie im Panel: der Tag ändert sich, die Uhrzeit bleibt (neu: 09:00)
      scheduled_at: (t) =>
        dateCell(t, "scheduled_at", "Geplant", (value) =>
          actions.update(t.id, {
            scheduled_at: value
              ? berlinDateTime(value, t.scheduled_at ? berlinTime(t.scheduled_at) : "09:00")
              : null,
          }),
        ),
      focus_date: (t) =>
        dateCell(t, "focus_date", "Fokus-Tag", (value) => actions.setFocus(t.id, value)),
      project: (t) => (
        <ProjectField
          aria-label="Projekt"
          value={t.project_id}
          projects={ctx.projects}
          areas={ctx.areas}
          onSelect={(id) => actions.update(t.id, { project_id: id })}
          showArea
          className={CELL_CONTROL}
        />
      ),
      area: (t) => {
        const area = ctx.areas.find((a) => a.id === t.area_id);
        const shown = area ? (
          <span className="inline-flex items-center gap-1.5">
            <AreaDot color={area.color} />
            {area.name}
          </span>
        ) : (
          <span className="text-faint">Inbox</span>
        );
        // im Projekt folgt der Bereich dem Projekt (wie im Panel)
        if (t.project_id) return shown;
        return (
          <CellMenu
            label="Bereich"
            value={t.area_id ?? NONE}
            options={ctx.areas.map((a) => ({
              value: a.id,
              label: a.name,
              icon: <AreaDot color={a.color} />,
            }))}
            onChange={(value) => actions.update(t.id, { area_id: value })}
          >
            {shown}
          </CellMenu>
        );
      },
      assignee: (t) => (
        <CellMenu
          label="Zuständig"
          value={t.assignee}
          options={[
            { value: "user", label: ASSIGNEE_LABELS.user },
            { value: "ai", label: ASSIGNEE_LABELS.ai },
          ]}
          onChange={(value) => actions.update(t.id, { assignee: value as TaskAssignee })}
        >
          {ASSIGNEE_LABELS[t.assignee]}
        </CellMenu>
      ),
      blocked_by: (t) => {
        const open = ctx.blockersOf(t.id).filter((b) => b.status !== "erledigt");
        return open.length ? (
          <span className="text-muted">{open.map((b) => taskTitle(b)).join(", ")}</span>
        ) : (
          <span className="text-faint">–</span>
        );
      },
      recurrence: (t) =>
        t.recurrence ? (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Repeat size={12} strokeWidth={1.5} aria-hidden />
            {recurrenceLabel(t.recurrence)}
          </span>
        ) : (
          <span className="text-faint">–</span>
        ),
    },
    move: (t, field, value) => {
      if (field === "status") actions.setStatus(t.id, value as TaskStatus);
      else if (field === "priority") {
        actions.update(t.id, { priority: value ? (Number(value) as Priority) : null });
      }
    },
    onAdd: (field, value) => {
      const created = actions.create({
        title: "",
        area_id: newTaskArea,
        in_inbox: !newTaskArea && !projectId,
        project_id: projectId ?? null,
        ...(field === "status" ? { status: value as TaskStatus } : {}),
        ...(field === "priority" ? { priority: value ? (Number(value) as Priority) : null } : {}),
      });
      peek.open(created.id);
    },
    canAdd: (field, value) => !(field === "status" && value === "erledigt"),
    // Darstellung „Kalender“ (S2c): die gefilterten Aufgaben nach Fälligkeit/Plan/Fokus im Monat
    calendar: (rows) => ({ tasks: rows }),
    boardLimit: (field, value) => (field === "status" && value === "erledigt" ? 5 : 50),
    // #77 ergänzt „Zuständig: Ich“ (`:3`); ein Stand von vor #48 wechselt dabei auch die
    // Gruppierung einmal auf „Projekt“
    storageUpgrade:
      storageUpgrade ??
      (storageKey === TASKS_STORAGE_KEY
        ? [
            { from: "sz:ansicht:tasks:2", patch: withForMeFilter },
            {
              from: "sz:ansicht:tasks",
              patch: (old) => ({ group: "project", ...withForMeFilter(old) }),
            },
          ]
        : undefined),
    groupLink: (field, key) => projectGroupLink(field, key, ctx.projects),
    groupDecor: (field, key) => {
      if (field === "area") {
        const area = ctx.areas.find((a) => a.id === key);
        return area ? <AreaDot color={area.color} /> : null;
      }
      if (field === "project") {
        const project = ctx.projects.find((p) => p.id === key);
        const area = ctx.areas.find((a) => a.id === project?.area_id);
        return area ? <AreaDot color={area.color} /> : null;
      }
      return null;
    },
    empty: {
      title: projectId ? "Noch keine Aufgaben im Projekt" : "Noch keine Aufgaben",
      description: "Oben eintippen und Enter drücken.",
      icon: <SquareCheck strokeWidth={1.5} />,
    },
  };

  return (
    <DatabaseView
      def={def}
      rows={rows}
      ctx={ctx}
      areas={data.ctx.areas}
      loading={data.loading}
      error={data.error}
      onRetry={data.retry}
      savedViews={savedViews}
      storageKey={storageKey}
      areaFilter={!projectId}
      onCount={onCount}
    />
  );
}
