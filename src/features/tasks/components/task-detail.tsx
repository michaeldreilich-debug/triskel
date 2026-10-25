"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import {
  ChevronDown,
  FileText,
  GripVertical,
  Link2,
  Lock,
  MoreHorizontal,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { FoldButton, WideToggle } from "@/components/shell/wide";
import { useBufferedText } from "@/components/ui/buffered";
import { Button } from "@/components/ui/button";
import { copyAppLink } from "@/components/ui/copy-link";
import { DatePicker } from "@/components/ui/date-picker";
import { EditedLine } from "@/components/ui/edited-line";
import { FileDrop } from "@/components/ui/file-drop";
import { quietControlClasses } from "@/components/ui/input";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskCheck } from "@/components/ui/task-check";
import { areasKey, useAreas } from "@/features/areas/api";
import type { AreaSummary } from "@/features/areas/defaults";
import { LinkedEvents } from "@/features/calendar/components/event-links";
import { useConvert } from "@/features/convert/api";
import { createQueryNoteDirectory } from "@/features/notes/directory";
import { useOutlineMedia } from "@/features/notes/media";
import { useMilestones, useProjects } from "@/features/projects/api";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { useFreshOnOpen } from "@/lib/data/fresh";
import { useSupabase } from "@/lib/data/provider";
import {
  berlinDate,
  berlinDateTime,
  berlinTime,
  formatDateShort,
  formatDayShort,
  formatListDate,
} from "@/lib/dates";
import { useSaveQueue } from "@/lib/save-queue/react";
import { useUi } from "@/lib/ui-store";
import { useNoteActions, useNotes } from "../../notes/api";
import { tasksKey, useDependencies, useTaskActions, useTasks } from "../api";
import { checklistProgress } from "../checklist";
import { blockersOf, dependentsOf, wouldCreateCycle } from "../dependencies";
import { useTaskPeek } from "../peek";
import { fetchTaskSourceNoteIds } from "../queries";
import {
  detectPreset,
  PRESET_LABELS,
  presetToRule,
  RECURRENCE_PRESETS,
  type RecurrencePreset,
  recurrenceLabel,
} from "../recurrence";
import {
  ASSIGNEE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskAssignee,
  type TaskStatus,
  taskTitle,
} from "../types";
import { MilestonePicker, ProjectField, TaskPicker } from "./pickers";
import { TaskBodyEditor } from "./task-body-editor";
import { TaskDragSource, useHasTaskDropZones } from "./task-dnd";

const NONE = "__keine__";
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

function Property({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const labelClasses = "flex min-h-11 items-center text-ui-sm text-faint md:min-h-8";
  return (
    <>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClasses}>
          {label}
        </label>
      ) : (
        <span className={labelClasses}>{label}</span>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>
    </>
  );
}

const durationLabel = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${minutes / 60} h`.replace(".", ",");

/** Aufgabe mit allen Eigenschaften (Panel rechts bzw. Sheet auf dem Handy). */
export function TaskDetail({
  taskId,
  onClose,
  onFold,
}: {
  taskId: string;
  onClose: () => void;
  /** Panel zum Reiter am rechten Rand einklappen (#80, nur als Panel ab 1280 px) */
  onFold?: () => void;
}) {
  const ids = {
    title: useId(),
    status: useId(),
    priority: useId(),
    assignee: useId(),
    due: useId(),
    scheduled: useId(),
    time: useId(),
    duration: useId(),
    recurrence: useId(),
    area: useId(),
    project: useId(),
    milestone: useId(),
    focus: useId(),
    properties: useId(),
  };
  const router = useRouter();
  const queryClient = useQueryClient();
  const tasks = useTasks();
  const deps = useDependencies();
  const projects = useProjects();
  const milestones = useMilestones();
  const areas = useAreas();
  const notes = useNotes();
  const actions = useTaskActions();
  const noteActions = useNoteActions();
  const convert = useConvert();
  const activeArea = useUi((s) => s.area);
  const getSupabase = useSupabase();
  const peek = useTaskPeek();
  const bodyFocus = useRef<HTMLDivElement>(null);
  const bodyEditor = useRef<Editor | null>(null);
  // Bilder und Dateien der Aufgaben-Notiz (#27, Ordner je Aufgabe)
  const media = useOutlineMedia(taskId);
  // Notiz erst mit frischem Serverstand einhängen (D-7) – außer bei einer eben hier angelegten
  // Aufgabe, die es auf dem Server noch gar nicht gibt
  const queue = useSaveQueue();
  const [isNew] = useState(() =>
    queue
      .unconfirmedOps()
      .some((op) => op.table === "tasks" && op.id === taskId && op.mode === "upsert"),
  );
  const bodyFresh = useFreshOnOpen(tasksKey, taskId) || isNew;
  const [focusBody, setFocusBody] = useState(false);
  const [blockerError, setBlockerError] = useState<string | null>(null);
  // Handy: Eigenschaften zugeklappt, eine Zeile fasst sie zusammen (Rückmeldung 12.10.2026)
  const [showProperties, setShowProperties] = useState(false);
  // neue Notizen aus „((“ landen im Bereich und Projekt der Aufgabe und verweisen auf sie
  const noteContext = useRef<{ areaId: string; projectId: string | null }>({
    areaId: "",
    projectId: null,
  });
  const noteDirectory = useMemo(
    () =>
      createQueryNoteDirectory(queryClient, {
        create: (title) =>
          noteActions.create({
            title,
            // #75: Neue Aufgaben öffnen sofort – kamen die Bereiche erst nach dem letzten
            // Zeichnen, hier frisch nachsehen (ein leerer Bereich ließe die Notiz nie speichern)
            area_id:
              noteContext.current.areaId ||
              (queryClient.getQueryData<AreaSummary[]>(areasKey)?.[0]?.id ?? ""),
            project_id: noteContext.current.projectId,
            task_id: taskId,
          }).id,
      }),
    [queryClient, noteActions, taskId],
  );
  const sourceNotes = useQuery({
    queryKey: ["task-source-notes", taskId],
    queryFn: () => fetchTaskSourceNoteIds(getSupabase(), taskId),
    staleTime: 60_000,
  });

  const task = tasks.data?.find((t) => t.id === taskId);
  const titleField = useBufferedText(
    task?.title ?? "",
    (title) => actions.update(taskId, { title }),
    (raw) => raw.replace(/\n/g, " "),
  );
  // #89/#90: im Panel (nur dort gibt es `onFold`) lässt sich die offene Aufgabe am Kopf auf eine
  // Fläche der Seite ziehen (nächster Schritt, Fokus), solange es eine gibt
  const hasDropZones = useHasTaskDropZones();
  const draggable = Boolean(onFold) && hasDropZones && task?.status !== "erledigt";
  if (!task) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-end">
          <Button variant="ghost" size="icon-sm" aria-label="Aufgabe schließen" onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        </div>
        {tasks.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <span className="sr-only">Aufgabe wird geladen</span>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <p className="text-ui text-muted">
            Aufgabe nicht gefunden – sie liegt im Papierkorb oder existiert nicht mehr.
          </p>
        )}
      </div>
    );
  }

  const allTasks = tasks.data ?? [];
  const allDeps = deps.data ?? [];
  const projectList = projects.data ?? [];
  const areaList = areas.data ?? [];
  const project = projectList.find((p) => p.id === task.project_id);
  const projectMilestones = (milestones.data ?? []).filter((m) => m.project_id === task.project_id);
  const blockers = blockersOf(task.id, allTasks, allDeps);
  const dependents = dependentsOf(task.id, allTasks, allDeps);
  const openBlockers = blockers.filter((b) => b.status !== "erledigt");
  const done = task.status === "erledigt";
  const today = berlinDate();
  const anchor = task.due_date ?? today;
  const preset = detectPreset(task.recurrence);
  const recurrenceOptions = [
    ...RECURRENCE_PRESETS.map((p) => ({
      value: p,
      label: p === "none" ? "Keine" : recurrenceLabel(presetToRule(p, anchor)) || PRESET_LABELS[p],
    })),
    ...(preset === "custom"
      ? [{ value: "custom", label: `Eigene Regel (${task.recurrence})` }]
      : []),
  ];
  const area = areaList.find((a) => a.id === task.area_id);
  const checklist = checklistProgress(task.body);
  const milestone = projectMilestones.find((m) => m.id === task.milestone_id);
  noteContext.current = {
    areaId:
      task.area_id ??
      project?.area_id ??
      (areaList.some((a) => a.id === activeArea) ? activeArea : null) ??
      areaList[0]?.id ??
      "",
    projectId: task.project_id,
  };
  const summary = [
    project ? null : (area?.name ?? "Inbox"),
    milestone ? milestone.title.trim() || "Meilenstein" : null,
    TASK_STATUS_LABELS[task.status],
    task.priority ? PRIORITY_LABELS[task.priority] : null,
    task.assignee === "ai" ? "für die KI" : null,
    task.due_date ? `fällig ${formatDayShort(task.due_date)}` : null,
    task.scheduled_at
      ? `geplant ${formatDayShort(berlinDate(task.scheduled_at))} ${berlinTime(task.scheduled_at)}`
      : null,
    task.duration_min ? durationLabel(task.duration_min) : null,
    task.recurrence ? recurrenceLabel(task.recurrence) : null,
    task.focus_date ? `Fokus ${formatDayShort(task.focus_date)}` : null,
  ].filter(Boolean);
  const sourceNoteList = (sourceNotes.data ?? [])
    .map((id) => notes.data?.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  const addBlocker = (blockerId: string) => {
    const result = actions.addBlocker(task.id, blockerId);
    if (result === "cycle") {
      const blocker = allTasks.find((t) => t.id === blockerId);
      setBlockerError(
        `Abgelehnt: „${taskTitle(blocker)}“ wartet schon (direkt oder indirekt) auf diese Aufgabe – das wäre ein Kreis.`,
      );
    } else {
      setBlockerError(null);
    }
  };

  return (
    <FileDrop
      onFiles={(files) => bodyEditor.current?.chain().insertMedia(files, "end").run()}
      label="Loslassen: an die Aufgabe hängen"
    >
      <article
        aria-labelledby={ids.title}
        className="flex flex-col gap-5 px-4 py-4 md:px-6 md:py-5"
      >
        <div className="flex items-center justify-between gap-2">
          <TaskDragSource
            task={task}
            scope="kopf"
            disabled={!draggable}
            title={
              draggable
                ? "Ziehen: Aufgabe ablegen, z. B. als nächster Schritt oder Fokus"
                : undefined
            }
            className={cn("min-w-0 flex-1", draggable && "cursor-grab")}
          >
            <p className="flex min-w-0 items-center gap-1.5 truncate text-ui-sm text-faint">
              {draggable ? (
                <GripVertical size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
              ) : null}
              {project ? (
                <>
                  <span className="truncate">{project.title || "Ohne Titel"}</span>
                  <span aria-hidden>/</span>
                </>
              ) : task.in_inbox ? (
                <span>Inbox /</span>
              ) : null}
              <span>Aufgabe</span>
            </p>
          </TaskDragSource>
          <div className="flex shrink-0 items-center">
            {onFold ? (
              <FoldButton label="Aufgabe" side="right" onClick={onFold} className="max-xl:hidden" />
            ) : null}
            <WideToggle mode="task" />
            <MenuRoot>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Aufgaben-Aktionen">
                  <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem onSelect={() => convert.taskToNote(task.id)}>
                  <FileText aria-hidden />
                  In Notiz umwandeln
                </MenuItem>
                <MenuItem onSelect={() => copyAppLink(appPath.task(task.id))}>
                  <Link2 aria-hidden />
                  Link kopieren
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="danger" onSelect={() => actions.trash(task.id, onClose)}>
                  <Trash2 aria-hidden />
                  In den Papierkorb
                </MenuItem>
              </MenuContent>
            </MenuRoot>
            <Button variant="ghost" size="icon-sm" aria-label="Aufgabe schließen" onClick={onClose}>
              <X size={16} strokeWidth={1.5} aria-hidden />
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <TaskCheck
            status={task.status}
            priority={task.priority}
            size="lg"
            onCheckedChange={() => actions.toggle(task.id)}
            aria-label={done ? "Wieder öffnen" : "Erledigt"}
            className="mt-2"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <textarea
              id={ids.title}
              aria-label="Titel"
              rows={1}
              {...titleField}
              placeholder="Ohne Titel"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const body = bodyFocus.current?.querySelector<HTMLElement>(".task-body");
                  // Notiz lädt noch frisch (D-7): fokussieren, sobald sie da ist
                  if (body) body.focus();
                  else setFocusBody(true);
                }
              }}
              className={cn(
                "heading w-full resize-none bg-transparent text-title-sm tracking-tight text-fg [field-sizing:content] placeholder:text-faint focus-visible:outline-none",
                done && "text-faint line-through",
              )}
            />
            <EditedLine at={task.updated_at} />
          </div>
        </div>

        <LinkedEvents target={{ taskId: task.id }} />

        {openBlockers.length > 0 ? (
          <p className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-ui-sm text-muted">
            <Lock size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
            Blockiert – wartet auf{" "}
            {openBlockers.length === 1 ? "eine Aufgabe" : `${openBlockers.length} Aufgaben`}.
          </p>
        ) : null}

        <div className="flex flex-col gap-2 border-b border-border pb-3 md:pb-5">
          <button
            type="button"
            aria-expanded={showProperties}
            aria-controls={ids.properties}
            onClick={() => setShowProperties((open) => !open)}
            className="-mx-1 flex min-h-11 items-center gap-3 rounded-control px-1 text-left hover:bg-surface md:hidden"
          >
            <span className="sr-only">Eigenschaften:</span>
            <span className="line-clamp-2 min-w-0 flex-1 text-ui-sm text-muted tabular-nums">
              {summary.join(" · ")}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-ui-sm text-faint">
              {showProperties ? "Weniger" : "Details"}
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                aria-hidden
                className={cn("transition-transform", showProperties && "rotate-180")}
              />
            </span>
          </button>
          <div
            id={ids.properties}
            className={cn(
              "grid grid-cols-[104px_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 text-ui md:grid-cols-[120px_minmax(0,1fr)]",
              !showProperties && "max-md:hidden",
            )}
          >
            {/* Bereich und Projekt zuerst (Rückmeldung #21) */}
            <Property label="Bereich" htmlFor={ids.area}>
              {project ? (
                <span className="inline-flex min-h-11 items-center gap-2 px-2 text-body-lg text-fg md:min-h-8 md:text-ui">
                  {area ? <AreaDot color={area.color} /> : null}
                  {area?.name ?? "–"}
                  <span className="text-meta text-faint">aus dem Projekt</span>
                </span>
              ) : (
                <Select
                  id={ids.area}
                  variant="quiet"
                  value={task.area_id ?? NONE}
                  placeholder="Inbox (kein Bereich)"
                  onValueChange={(value) =>
                    actions.update(task.id, { area_id: value === NONE ? null : value })
                  }
                  options={areaList.map((a) => ({
                    value: a.id,
                    label: a.name,
                    icon: <AreaDot color={a.color} />,
                  }))}
                />
              )}
            </Property>
            <Property label="Projekt" htmlFor={ids.project}>
              <ProjectField
                id={ids.project}
                value={task.project_id}
                projects={projectList}
                areas={areaList}
                onSelect={(projectId) => actions.update(task.id, { project_id: projectId })}
              />
            </Property>
            {project ? (
              <Property label="Meilenstein" htmlFor={ids.milestone}>
                <MilestonePicker
                  id={ids.milestone}
                  value={task.milestone_id}
                  milestones={projectMilestones}
                  onSelect={(milestoneId) => actions.update(task.id, { milestone_id: milestoneId })}
                />
              </Property>
            ) : null}
            <Property label="Status" htmlFor={ids.status}>
              <Select
                id={ids.status}
                variant="quiet"
                value={task.status}
                onValueChange={(value) => actions.setStatus(task.id, value as TaskStatus)}
                options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
              />
            </Property>
            <Property label="Priorität" htmlFor={ids.priority}>
              <Select
                id={ids.priority}
                variant="quiet"
                value={task.priority ? String(task.priority) : NONE}
                onValueChange={(value) =>
                  actions.update(task.id, {
                    priority: value === NONE ? null : (Number(value) as Priority),
                  })
                }
                options={[
                  { value: NONE, label: "Keine" },
                  ...PRIORITIES.map((p) => ({ value: String(p), label: PRIORITY_LABELS[p] })),
                ]}
              />
            </Property>
            {/* #77: Arbeitsschritte der KI stehen nur im Projekt, sonst nirgends */}
            <Property label="Zuständig" htmlFor={ids.assignee}>
              <Select
                id={ids.assignee}
                variant="quiet"
                value={task.assignee}
                onValueChange={(value) =>
                  actions.update(task.id, { assignee: value as TaskAssignee })
                }
                options={[
                  { value: "user", label: ASSIGNEE_LABELS.user },
                  { value: "ai", label: `${ASSIGNEE_LABELS.ai} – nur im Projekt sichtbar` },
                ]}
              />
            </Property>
            <Property label="Fällig" htmlFor={ids.due}>
              <DatePicker
                id={ids.due}
                variant="quiet"
                value={task.due_date}
                placeholder="Kein Datum"
                onChange={(value) => actions.update(task.id, { due_date: value })}
                className={cn(
                  task.due_date && task.due_date < today && !done && "[&_span]:text-danger",
                )}
              />
            </Property>
            <Property label="Geplant" htmlFor={ids.scheduled}>
              <DatePicker
                id={ids.scheduled}
                variant="quiet"
                value={task.scheduled_at ? berlinDate(task.scheduled_at) : null}
                placeholder="Nicht geplant"
                onChange={(value) =>
                  actions.update(task.id, {
                    scheduled_at: value
                      ? berlinDateTime(
                          value,
                          task.scheduled_at ? berlinTime(task.scheduled_at) : "09:00",
                        )
                      : null,
                  })
                }
              />
              {task.scheduled_at ? (
                <input
                  id={ids.time}
                  type="time"
                  aria-label="Uhrzeit"
                  value={berlinTime(task.scheduled_at)}
                  onChange={(event) => {
                    if (!event.target.value || !task.scheduled_at) return;
                    actions.update(task.id, {
                      scheduled_at: berlinDateTime(
                        berlinDate(task.scheduled_at),
                        event.target.value,
                      ),
                    });
                  }}
                  className={cn(quietControlClasses, "h-11 tabular-nums md:h-8")}
                />
              ) : null}
            </Property>
            <Property label="Dauer" htmlFor={ids.duration}>
              <Select
                id={ids.duration}
                variant="quiet"
                value={task.duration_min ? String(task.duration_min) : NONE}
                onValueChange={(value) =>
                  actions.update(task.id, { duration_min: value === NONE ? null : Number(value) })
                }
                options={[
                  { value: NONE, label: "Keine" },
                  ...[...new Set([...DURATIONS, ...(task.duration_min ? [task.duration_min] : [])])]
                    .sort((a, b) => a - b)
                    .map((m) => ({ value: String(m), label: durationLabel(m) })),
                ]}
              />
            </Property>
            <Property label="Wiederholung" htmlFor={ids.recurrence}>
              <Select
                id={ids.recurrence}
                variant="quiet"
                value={preset}
                onValueChange={(value) => {
                  if (value === "custom") return;
                  actions.update(task.id, {
                    recurrence: presetToRule(value as RecurrencePreset, anchor),
                    ...(task.due_date ? {} : { due_date: anchor }),
                  });
                }}
                options={recurrenceOptions}
              />
            </Property>
            <Property label="Fokus-Tag" htmlFor={ids.focus}>
              <DatePicker
                id={ids.focus}
                variant="quiet"
                value={task.focus_date}
                placeholder="Kein Fokus"
                onChange={(value) => actions.setFocus(task.id, value)}
              />
            </Property>
            <Property label="Blockiert durch">
              <ul aria-label="Blockiert durch" className="flex w-full flex-col gap-0.5">
                {blockers.map((blocker) => (
                  <li
                    key={blocker.id}
                    className="group flex min-h-11 items-center gap-2 md:min-h-8"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        blocker.status === "erledigt" ? "bg-success" : "bg-warning",
                      )}
                    />
                    <Link
                      href={peek.hrefFor(blocker.id)}
                      scroll={false}
                      className={cn(
                        "min-w-0 flex-1 truncate px-1 text-ui hover:underline",
                        blocker.status === "erledigt" && "text-faint line-through",
                      )}
                    >
                      {taskTitle(blocker)}
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`„${taskTitle(blocker)}“ als Blocker entfernen`}
                      onClick={() => actions.removeBlocker(task.id, blocker.id)}
                      className="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
                    >
                      <X size={14} strokeWidth={1.5} aria-hidden />
                    </Button>
                  </li>
                ))}
                <li>
                  <TaskPicker
                    variant="add"
                    label={blockers.length ? "Weitere" : "Aufgabe wählen"}
                    ariaLabel="Blockiert durch: Aufgabe wählen"
                    tasks={allTasks.filter(
                      (t) =>
                        t.id !== task.id &&
                        t.status !== "erledigt" &&
                        !blockers.some((b) => b.id === t.id),
                    )}
                    projects={projectList}
                    onSelect={addBlocker}
                    note={(candidate) =>
                      wouldCreateCycle(allDeps, task.id, candidate.id) ? "bildet Kreis" : undefined
                    }
                  />
                </li>
              </ul>
            </Property>
          </div>
        </div>

        {blockerError ? (
          <p
            role="alert"
            className="rounded-control border border-danger/50 px-3 py-2 text-ui-sm text-danger"
          >
            {blockerError}
          </p>
        ) : null}

        <div ref={bodyFocus} className="flex flex-col gap-3">
          {checklist ? (
            <section aria-label="Checkliste" className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-ui-sm">
                <span className="text-faint">Checkliste</span>
                <span className="tabular-nums" data-testid="checklist-progress">
                  {checklist.done} von {checklist.total}
                </span>
              </div>
              <ProgressBar
                value={checklist.done / checklist.total}
                color={area?.color ?? "neutral"}
                label={`Checkliste: ${checklist.done} von ${checklist.total} erledigt`}
              />
            </section>
          ) : null}
          {bodyFresh ? (
            <TaskBodyEditor
              key={task.id}
              initialContent={task.body}
              notes={noteDirectory}
              onOpenNote={(noteId) => router.push(appPath.note(noteId))}
              onChange={(body, text) => actions.update(task.id, { body, body_text: text })}
              images={media.images}
              files={media.files}
              editorRef={bodyEditor}
              autoFocus={focusBody}
              refreshKey={tasksKey}
            />
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
        </div>

        {dependents.length > 0 || sourceNoteList.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            {dependents.length > 0 ? (
              <section aria-label="Wartet auf diese Aufgabe" className="flex flex-col gap-1">
                <h3 className="text-meta uppercase tracking-widest text-faint">Wartet hierauf</h3>
                {dependents.map((d) => (
                  <Link
                    key={d.id}
                    href={peek.hrefFor(d.id)}
                    scroll={false}
                    className="truncate text-ui text-fg/85 hover:underline"
                  >
                    {taskTitle(d)}
                  </Link>
                ))}
              </section>
            ) : null}
            {sourceNoteList.length > 0 ? (
              <section aria-label="Aus Notiz" className="flex flex-col gap-1">
                <h3 className="text-meta uppercase tracking-widest text-faint">Aus Notiz</h3>
                {sourceNoteList.map((n) => (
                  <Link
                    key={n.id}
                    href={appPath.note(n.id)}
                    className="inline-flex items-center gap-2 text-ui text-fg/85 hover:underline"
                  >
                    <FileText size={14} strokeWidth={1.5} aria-hidden className="text-faint" />
                    {n.title.trim() || "Ohne Titel"}
                  </Link>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-faint tabular-nums">
          <span>
            Angelegt {formatListDate(task.created_at)}
            {task.created_by === "ai" ? " · von KI angelegt" : ""}
          </span>
          {task.completed_at ? <span>Erledigt {formatListDate(task.completed_at)}</span> : null}
          {task.recurrence ? (
            <span className="inline-flex items-center gap-1">
              <Repeat size={12} strokeWidth={1.5} aria-hidden />
              {recurrenceLabel(task.recurrence)}
              {task.due_date ? ` · ab ${formatDateShort(task.due_date)}` : ""}
            </span>
          ) : null}
        </p>
      </article>
    </FileDrop>
  );
}
