"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Folder,
  Link2,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "radix-ui";
import { useId, useState } from "react";
import { FoldButton, Rail, WideToggle } from "@/components/shell/wide";
import { useBufferedText } from "@/components/ui/buffered";
import { Button } from "@/components/ui/button";
import { copyAppLink } from "@/components/ui/copy-link";
import { DatePicker } from "@/components/ui/date-picker";
import { EditedLine } from "@/components/ui/edited-line";
import { EmptyState } from "@/components/ui/empty-state";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAreas } from "@/features/areas/api";
import { useNoteActions, useNotes } from "@/features/notes/api";
import { NoteDatabase } from "@/features/notes/components/note-database";
import { useNoteTypes } from "@/features/notes/note-types";
import { useNoteOpener } from "@/features/notes/peek";
import { type NoteType, preferredNoteType } from "@/features/notes/types";
import { useTaskActions } from "@/features/tasks/api";
import { QuickAdd } from "@/features/tasks/components/quick-add";
import { TaskDatabase } from "@/features/tasks/components/task-database";
import { TaskDragSource } from "@/features/tasks/components/task-dnd";
import { TaskItem } from "@/features/tasks/components/task-item";
import { useTaskData } from "@/features/tasks/hooks";
import { useMediaQuery, useTaskPeek } from "@/features/tasks/peek";
import { PRIORITIES, PRIORITY_LABELS, type Priority } from "@/features/tasks/types";
import { applyProjectTemplate, useTemplates } from "@/features/templates/api";
import { TemplateChips } from "@/features/templates/components/template-chips";
import { hasProjectContent, parseProjectTemplate } from "@/features/templates/model";
import type { ViewConfig } from "@/features/views/engine";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/dates";
import { useLocalFlag, useLocalNumber } from "@/lib/local-pref";
import { useMilestones, useProjectActions, useProjects } from "../api";
import {
  activeCountByArea,
  daysSince,
  formatProgress,
  isStale,
  lastActivity,
  MAX_ACTIVE_PER_AREA,
  projectProgress,
  STUCK_LABELS,
  stuckReasons,
} from "../rules";
import {
  type MilestoneRow,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type ProjectRow,
  type ProjectStatus,
  projectTitle,
} from "../types";
import { ClosingRitual } from "./closing-ritual";
import { byUrgency, MilestonePlan } from "./milestone-plan";
import { ProjectBody } from "./project-body";
import { useNow } from "./project-database";
import { LinkList, NextStepBox, OutcomeList, SectionTitle } from "./steckbrief-parts";

const TABS = ["uebersicht", "aufgaben", "notizen", "abschluss"] as const;
type Tab = (typeof TABS)[number];

/**
 * Vorgabe der Reiter „Aufgaben“ und „Notizen“ (#91): Tabelle mit Eigenschaften wie in den
 * Datenbanken, ohne Gruppierung und ohne Projekt-Spalte (es ist ja das Projekt).
 */
const PROJECT_TASK_VIEW: Partial<ViewConfig> = {
  type: "tabelle",
  group: null,
  columns: ["title", "status", "priority", "due_date", "blocked_by", "updated_at"],
};
const PROJECT_NOTE_VIEW: Partial<ViewConfig> = {
  type: "tabelle",
  group: null,
  sort: { field: "edited_at", dir: "desc" },
  columns: ["title", "type", "topic", "tags", "edited_at"],
};

/** Geräte mit dem alten Standard (Board nach Fälligkeit) bekommen die Tabelle; Eigenes bleibt. */
function projectTaskViewUpgrade(old: Record<string, unknown>): Partial<ViewConfig> {
  if (old.type !== "board") return {};
  return PROJECT_TASK_VIEW;
}
const NONE = "__keine__";

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
      <div className="flex min-w-0 items-center">{children}</div>
    </>
  );
}

/** „Warum“ des Projekts, frei bearbeitbar (Steckbrief am Laptop, Übersicht am Handy). */
function WhyField({ value, onChange }: { value: string; onChange: (why: string) => void }) {
  const id = useId();
  const field = useBufferedText(value, onChange);
  return (
    <section className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-meta uppercase tracking-widest text-faint">
        Warum
      </label>
      <textarea
        id={id}
        {...field}
        rows={2}
        placeholder="Warum ist das wichtig?"
        className="w-full resize-none rounded-control bg-transparent px-1 py-1 text-body-lg text-fg [field-sizing:content] placeholder:text-faint hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none md:text-ui"
      />
    </section>
  );
}

/** Steckbrief-Spalte am Laptop (#43): Standard 344 px, ziehbar von 280 bis 640 px. */
const STECKBRIEF_WIDTH = { initial: 344, min: 280, max: 640 };

/**
 * Projektseite (B7): Steckbrief links (320–360 px, Entwurf 05), rechts Reiter Übersicht /
 * Aufgaben / Notizen / Abschluss. Fokus-Regeln als weiche Hinweise.
 * Handy (unter 1024 px, Rückmeldung 12.10.2026): Steckbrief schlank – Eigenschaften als
 * zuklappbare Zusammenfassung, Ergebnis und Warum stehen dort in der Übersicht.
 * Meilensteine als nummerierter Fahrplan in der Übersicht. Das Zeitbudget gibt es in der App
 * nicht mehr (E24: der Nutzer nutzt keine Zeitplanung im Projekt); Spalte und Werte bleiben in der
 * Datenbank und im Export (export.json).
 */
export function ProjectPage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const templates = useTemplates();
  const pathname = usePathname();
  const params = useSearchParams();
  const ids = {
    title: useId(),
    status: useId(),
    area: useId(),
    priority: useId(),
    start: useId(),
    target: useId(),
    properties: useId(),
  };
  const [showProperties, setShowProperties] = useState(false);
  const [steckbriefWidth, setSteckbriefWidth] = useLocalNumber(
    "sz:steckbrief-breite",
    STECKBRIEF_WIDTH.initial,
    STECKBRIEF_WIDTH,
  );
  const [steckbriefFolded, setSteckbriefFolded] = useLocalFlag("sz:steckbrief-zu", false);
  const projects = useProjects();
  const milestones = useMilestones();
  const areas = useAreas();
  const notes = useNotes();
  const data = useTaskData();
  const actions = useProjectActions();
  const taskActions = useTaskActions();
  const peek = useTaskPeek();
  const noteActions = useNoteActions();
  const noteTypes = useNoteTypes();
  const noteOpener = useNoteOpener();
  const now = useNow();
  // #89: ziehen nur, wo Steckbrief und Inhalt nebeneinander stehen; darunter bleibt die Auswahl
  const draggable = useMediaQuery("(min-width: 1024px)");

  const tabParam = params.get("reiter");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as Tab)
    : "uebersicht";
  const setTab = (next: string) => {
    const query = new URLSearchParams(params.toString());
    if (next === "uebersicht") query.delete("reiter");
    else query.set("reiter", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const project = projects.data?.find((p) => p.id === projectId);
  const titleField = useBufferedText(
    project?.title ?? "",
    (title) => actions.update(projectId, { title }),
    (raw) => raw.replace(/\n/g, " "),
  );
  if (!project) {
    return (
      <div className="flex flex-col gap-4 px-4 py-8 md:px-8">
        {projects.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">Projekt wird geladen</span>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : projects.isError ? (
          <p role="alert" className="text-ui text-danger">
            Projekt konnte nicht geladen werden. Verbindung prüfen.
          </p>
        ) : (
          <EmptyState
            title="Projekt nicht gefunden"
            description="Es liegt im Papierkorb oder existiert nicht mehr."
            action={
              <Link href={appPath.projects()} className="text-ui underline">
                Zu den Projekten
              </Link>
            }
          />
        )}
      </div>
    );
  }

  const tasks = data.tasks;
  const areaList = areas.data ?? [];
  const area = areaList.find((a) => a.id === project.area_id);
  const progress = projectProgress(project.id, tasks);
  const stuck = stuckReasons(project, tasks);
  const stale = isStale(project, tasks, now);
  const activeInArea = activeCountByArea(projects.data ?? []).get(project.area_id) ?? 0;
  const overloaded = project.status === "aktiv" && activeInArea > MAX_ACTIVE_PER_AREA;
  const projectMilestones = (milestones.data ?? []).filter((m) => m.project_id === project.id);
  const projectTasks = tasks.filter((t) => t.project_id === project.id);
  const noteCount = (notes.data ?? []).filter((n) => n.project_id === project.id).length;
  /** Neue Notiz im Projekt (Protokoll, wenn es den Typ gibt); öffnet als Panel bzw. im Wissen (#92) */
  const createProjectNote = (type?: NoteType) => {
    const note = noteActions.create({
      title: "",
      area_id: project.area_id,
      project_id: project.id,
      type: type ?? preferredNoteType("protokoll", noteTypes.types),
    });
    noteOpener.open(note.id);
  };
  const openTasks = projectTasks.filter((t) => t.status !== "erledigt");
  // frisches Projekt: Vorlagen mit Inhalt anbieten (B11)
  const fresh =
    !project.why.trim() &&
    !project.outcome.some((o) => o.text.trim()) &&
    projectMilestones.length === 0 &&
    projectTasks.length === 0;
  const projectTemplates = (templates.data ?? []).filter(
    (t) => t.kind === "projekt" && hasProjectContent(parseProjectTemplate(t.body)),
  );
  const summary = [
    area?.name,
    PROJECT_STATUS_LABELS[project.status],
    project.priority ? PRIORITY_LABELS[project.priority] : null,
    project.start_date ? `Start ${formatDateShort(project.start_date)}` : null,
    project.target_date ? `Ziel ${formatDateShort(project.target_date)}` : null,
  ].filter(Boolean);

  const newTaskInProject = (title: string) =>
    taskActions.create({
      title,
      project_id: project.id,
      area_id: project.area_id,
      in_inbox: false,
    });

  const steckbrief = (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-ui-sm text-faint">
          <Link
            href={appPath.projects()}
            className="inline-flex items-center gap-1 hover:text-fg"
            aria-label="Zurück zu den Projekten"
          >
            <ArrowLeft size={14} strokeWidth={1.5} aria-hidden className="lg:hidden" />
            <span className="truncate">{area?.name ?? "Projekte"} / Projekte</span>
          </Link>
        </p>
        <div className="flex shrink-0 items-center">
          <WideToggle mode="page" />
          <MenuRoot>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Projekt-Aktionen">
                <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => copyAppLink(appPath.project(project.id))}>
                <Link2 aria-hidden />
                Link kopieren
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="danger"
                onSelect={() => actions.trash(project.id, () => router.push(appPath.projects()))}
              >
                <Trash2 aria-hidden />
                In den Papierkorb
              </MenuItem>
            </MenuContent>
          </MenuRoot>
          <FoldButton
            label="Steckbrief"
            onClick={() => setSteckbriefFolded(true)}
            className="max-lg:hidden"
          />
        </div>
      </div>

      <textarea
        id={ids.title}
        aria-label="Projekttitel"
        rows={1}
        {...titleField}
        placeholder="Projekt benennen"
        className="heading -mt-3 w-full resize-none bg-transparent text-title-sm tracking-tight text-fg [field-sizing:content] placeholder:text-faint focus-visible:outline-none"
      />
      <EditedLine at={lastActivity(project, tasks)} className="-mt-5" />
      {fresh ? (
        <div className="-mt-3">
          <TemplateChips
            templates={projectTemplates}
            onApply={(template) => applyProjectTemplate(project, template, actions, taskActions)}
          />
        </div>
      ) : null}

      <div className="-mt-3 flex flex-col gap-1 lg:mt-0">
        <button
          type="button"
          aria-expanded={showProperties}
          aria-controls={ids.properties}
          onClick={() => setShowProperties((open) => !open)}
          className="-mx-1 flex min-h-11 items-center gap-3 rounded-control px-1 text-left hover:bg-surface lg:hidden"
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
            "grid grid-cols-[92px_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 text-ui",
            !showProperties && "max-lg:hidden",
          )}
        >
          {/* Bereich zuerst, wie bei Aufgaben (Rückmeldung #21) */}
          <Property label="Bereich" htmlFor={ids.area}>
            <Select
              id={ids.area}
              variant="quiet"
              value={project.area_id}
              onValueChange={(value) => actions.update(project.id, { area_id: value })}
              options={areaList.map((a) => ({
                value: a.id,
                label: a.name,
                icon: <AreaDot color={a.color} />,
              }))}
            />
          </Property>
          <Property label="Status" htmlFor={ids.status}>
            <Select
              id={ids.status}
              variant="quiet"
              value={project.status}
              onValueChange={(value) =>
                actions.update(project.id, { status: value as ProjectStatus })
              }
              options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))}
            />
          </Property>
          <Property label="Priorität" htmlFor={ids.priority}>
            <Select
              id={ids.priority}
              variant="quiet"
              value={project.priority ? String(project.priority) : NONE}
              onValueChange={(value) =>
                actions.update(project.id, {
                  priority: value === NONE ? null : (Number(value) as Priority),
                })
              }
              options={[
                { value: NONE, label: "Keine" },
                ...PRIORITIES.map((p) => ({ value: String(p), label: PRIORITY_LABELS[p] })),
              ]}
            />
          </Property>
          <Property label="Start" htmlFor={ids.start}>
            <DatePicker
              id={ids.start}
              variant="quiet"
              value={project.start_date}
              placeholder="Offen"
              onChange={(value) => actions.update(project.id, { start_date: value })}
            />
          </Property>
          <Property label="Ziel" htmlFor={ids.target}>
            <DatePicker
              id={ids.target}
              variant="quiet"
              value={project.target_date}
              placeholder="Kein Zieldatum"
              onChange={(value) => actions.update(project.id, { target_date: value })}
            />
          </Property>
        </div>
      </div>

      <section aria-label="Fortschritt" className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-ui-sm">
          <span className="text-faint">Fortschritt</span>
          <span className="tabular-nums" data-testid="project-progress">
            {formatProgress(progress)}
            {progress.total > 0 ? (
              <span className="text-faint">
                {" "}
                · {progress.done} von {progress.total}
              </span>
            ) : null}
          </span>
        </div>
        <ProgressBar
          value={progress.ratio ?? 0}
          color={area?.color}
          label={`Fortschritt ${projectTitle(project)}`}
        />
      </section>

      {stuck.length || stale || overloaded ? (
        <ul aria-label="Hinweise" className="flex flex-col gap-2">
          {stuck.length ? (
            <li className="flex gap-2 rounded-control border border-warning/50 px-3 py-2 text-ui-sm text-warning">
              <AlertTriangle size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />
              <span>Festgefahren: {stuck.map((r) => STUCK_LABELS[r]).join(" und ")}.</span>
            </li>
          ) : null}
          {stale ? (
            <li className="flex gap-2 rounded-control border border-warning/50 px-3 py-2 text-ui-sm text-warning">
              <AlertTriangle size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />
              <span>
                14 Tage still – seit {daysSince(lastActivity(project, tasks), now)} Tagen keine
                Bewegung. Kommt aufs Wochenreview.
              </span>
            </li>
          ) : null}
          {overloaded ? (
            <li className="flex gap-2 rounded-control border border-warning/50 px-3 py-2 text-ui-sm text-warning">
              <AlertTriangle size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />
              <span>
                {activeInArea} aktive Projekte in {area?.name} – Fokus-Regel: höchstens{" "}
                {MAX_ACTIVE_PER_AREA}.
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      <NextStepBox
        project={project}
        tasks={tasks}
        projects={projects.data ?? []}
        onChoose={(taskId) => actions.update(project.id, { next_task_id: taskId })}
        onCreate={(title) => {
          const task = newTaskInProject(title);
          actions.update(project.id, { next_task_id: task.id });
        }}
      />

      <div className="flex flex-col gap-6 max-lg:hidden">
        <OutcomeList
          items={project.outcome}
          onChange={(outcome) => actions.setOutcome(project.id, outcome)}
        />
        <WhyField value={project.why} onChange={(why) => actions.update(project.id, { why })} />
        <LinkList links={project.links} onChange={(links) => actions.setLinks(project.id, links)} />
      </div>
    </div>
  );

  const tabClasses =
    "relative min-h-11 shrink-0 px-1 text-ui text-muted transition-colors hover:text-fg data-[state=active]:font-medium data-[state=active]:text-fg data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-fg md:min-h-10";

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:min-h-[calc(100dvh-var(--tabbar-h,0px))] lg:flex-row">
      {/* Steckbrief-Spalte: am Laptop ziehbar, Breite je Gerät (#43), einklappbar zum Reiter (#80) */}
      {steckbriefFolded ? (
        <Rail
          label="Steckbrief"
          icon={Folder}
          side="left"
          onClick={() => setSteckbriefFolded(false)}
        />
      ) : null}
      <div
        className={cn(
          "relative lg:sticky lg:top-[var(--tabbar-h,0px)] lg:h-[calc(100dvh-var(--tabbar-h,0px))] lg:w-(--steckbrief-w) lg:shrink-0",
          steckbriefFolded && "lg:hidden",
        )}
        style={{ "--steckbrief-w": `${steckbriefWidth}px` } as React.CSSProperties}
      >
        <aside
          aria-label="Steckbrief"
          data-tab-scroll="steckbrief"
          className="scroll-quiet border-border px-4 py-6 md:px-8 lg:h-full lg:overflow-y-auto lg:border-r lg:px-6"
        >
          {steckbrief}
        </aside>
        <ResizeHandle
          label="Breite des Steckbriefs"
          value={steckbriefWidth}
          min={STECKBRIEF_WIDTH.min}
          max={STECKBRIEF_WIDTH.max}
          onChange={setSteckbriefWidth}
          onReset={() => setSteckbriefWidth(STECKBRIEF_WIDTH.initial)}
          className="hidden lg:block"
        />
      </div>
      <Tabs.Root
        value={tab}
        onValueChange={setTab}
        className="flex min-w-0 flex-1 flex-col px-4 pb-8 md:px-8 lg:pt-6"
      >
        <Tabs.List
          aria-label="Projekt-Reiter"
          className="flex gap-5 overflow-x-auto border-b border-border"
        >
          <Tabs.Trigger value="uebersicht" className={tabClasses}>
            Übersicht
          </Tabs.Trigger>
          <Tabs.Trigger value="aufgaben" className={tabClasses}>
            Aufgaben <span className="text-faint tabular-nums">{projectTasks.length}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="notizen" className={tabClasses}>
            Notizen <span className="text-faint tabular-nums">{noteCount}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="abschluss" className={tabClasses}>
            Abschluss
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="uebersicht" className="flex flex-col gap-8 pt-6 outline-none">
          <Overview
            project={project}
            projectTasks={projectTasks}
            openTasks={openTasks}
            milestones={projectMilestones}
            ctx={data.ctx}
            doneCount={progress.done}
            draggable={draggable}
          />
        </Tabs.Content>

        <Tabs.Content value="aufgaben" className="flex flex-col gap-4 pt-6 outline-none">
          <QuickAdd
            className="max-w-page"
            label="Neue Aufgabe im Projekt"
            placeholder="Neue Aufgabe im Projekt …"
            onSubmit={(title, { open }) => {
              const task = newTaskInProject(title);
              if (open) peek.open(task.id);
            }}
          />
          <TaskDatabase
            projectId={project.id}
            newTaskArea={project.area_id}
            savedViews={false}
            storageKey="sz:ansicht:projekt-aufgaben:2"
            defaults={PROJECT_TASK_VIEW}
            storageUpgrade={{ from: "sz:ansicht:projekt-aufgaben", patch: projectTaskViewUpgrade }}
            draggable={draggable}
          />
        </Tabs.Content>

        <Tabs.Content value="notizen" className="flex flex-col gap-4 pt-6 outline-none">
          <div className="flex items-center justify-between gap-3">
            <p className="text-ui-sm text-faint">
              Notizen zu diesem Projekt, zuletzt bearbeitete zuerst.
            </p>
            <Button variant="secondary" size="sm" onClick={() => createProjectNote()}>
              <Plus size={14} strokeWidth={1.5} aria-hidden />
              Neue Notiz
            </Button>
          </div>
          <NoteDatabase
            projectId={project.id}
            savedViews={false}
            storageKey="sz:ansicht:projekt-notizen"
            defaults={PROJECT_NOTE_VIEW}
            onCreate={createProjectNote}
          />
        </Tabs.Content>

        <Tabs.Content value="abschluss" className="flex flex-col gap-6 pt-6 outline-none">
          <ClosingRitual
            project={project}
            openCount={openTasks.length}
            onSave={(reflection) => actions.update(project.id, { closing_reflection: reflection })}
            onClose={(reflection) => actions.close(project.id, reflection)}
            onReopen={() => actions.update(project.id, { status: "aktiv" })}
          />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function Overview({
  project,
  projectTasks,
  openTasks,
  milestones,
  ctx,
  doneCount,
  draggable,
}: {
  project: ProjectRow;
  projectTasks: ReturnType<typeof useTaskData>["tasks"];
  openTasks: ReturnType<typeof useTaskData>["tasks"];
  milestones: MilestoneRow[];
  ctx: ReturnType<typeof useTaskData>["ctx"];
  doneCount: number;
  /** Aufgaben lassen sich auf „Nächster Schritt“ ziehen (#89) */
  draggable: boolean;
}) {
  const actions = useProjectActions();
  const blocked = openTasks.filter((t) => ctx.blocked.has(t.id)).length;
  // mit Meilensteinen stehen deren Aufgaben im Fahrplan; hier nur der Rest (keine Doppelten)
  const withPlan = milestones.length > 0;
  const rest = [...openTasks]
    .filter((t) => !withPlan || !milestones.some((m) => m.id === t.milestone_id))
    .sort(byUrgency);
  const upcoming = withPlan ? rest : rest.slice(0, 6);
  return (
    <>
      <dl className="grid grid-cols-3 gap-2 md:gap-3">
        {[
          ["Offen", openTasks.length],
          ["Erledigt", doneCount],
          ["Blockiert", blocked],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 flex-col gap-1 rounded-card border border-border px-3 py-3 md:px-4"
          >
            <dt className="truncate text-meta uppercase tracking-wide text-faint md:tracking-widest">
              {label}
            </dt>
            <dd className="text-title-sm tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-6 lg:hidden">
        <OutcomeList
          items={project.outcome}
          onChange={(outcome) => actions.setOutcome(project.id, outcome)}
        />
        <LinkList links={project.links} onChange={(links) => actions.setLinks(project.id, links)} />
      </div>
      <MilestonePlan
        project={project}
        milestones={milestones}
        tasks={projectTasks}
        ctx={ctx}
        draggable={draggable}
      />
      {withPlan && upcoming.length === 0 ? null : (
        <section aria-labelledby="als-naechstes" className="flex flex-col gap-2">
          <SectionTitle id="als-naechstes">
            {withPlan ? "Ohne Meilenstein" : "Als Nächstes"}
          </SectionTitle>
          {upcoming.length === 0 ? (
            <p className="text-ui-sm text-faint">Keine offenen Aufgaben.</p>
          ) : (
            <ul className="-mx-2.5 flex flex-col gap-0.5">
              {upcoming.map((t) => (
                <li key={t.id}>
                  <TaskDragSource task={t} scope="plan" disabled={!draggable}>
                    <TaskItem task={t} ctx={ctx} showProject={false} />
                  </TaskDragSource>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ProjectBody project={project} />
      <div className="lg:hidden">
        <WhyField value={project.why} onChange={(why) => actions.update(project.id, { why })} />
      </div>
      {project.why.trim() ? (
        <section aria-labelledby="warum-uebersicht" className="flex flex-col gap-2 max-lg:hidden">
          <SectionTitle id="warum-uebersicht">Warum</SectionTitle>
          <p className="max-w-page whitespace-pre-wrap text-body text-fg/90">{project.why}</p>
        </section>
      ) : null}
    </>
  );
}
