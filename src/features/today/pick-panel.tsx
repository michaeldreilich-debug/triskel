"use client";

import { ListChecks, Plus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { FoldButton, Rail } from "@/components/shell/wide";
import { Button } from "@/components/ui/button";
import { quietControlClasses } from "@/components/ui/input";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlanGroups,
  PlanPartsProvider,
  PlanSearchBar,
  usePlanFilters,
} from "@/features/calendar/components/plan-parts";
import { buildPlan } from "@/features/calendar/plan";
import { useNotePeek } from "@/features/notes/peek";
import type { ProjectRow } from "@/features/projects/types";
import { TaskPicker } from "@/features/tasks/components/pickers";
import { TaskDragSource } from "@/features/tasks/components/task-dnd";
import { PEEK_PANEL_QUERY, useMediaQuery, useTaskPeek } from "@/features/tasks/peek";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { cn } from "@/lib/cn";
import { formatDayShort } from "@/lib/dates";
import { useLocalNumber } from "@/lib/local-pref";
import { type PickTarget, useFocusPlacement, usePick } from "./pick";
import { FOCUS_LIMIT, suggestionReason, type TodayData } from "./select";
import { useTodayModel } from "./use-today";

/** Breite der Spalte, am linken Rand ziehbar wie die anderen Panels (#83, #88). */
const PANEL_WIDTH = { initial: 360, min: 288, max: 640 };

const TARGET_LABEL: Record<PickTarget, string> = {
  morgen: "Für morgen wählen",
  heute: "Fokus heute wählen",
};

/**
 * Aufgabenspalte rechts zum Hineinziehen (#90): Inbox/Projekte nach Meilenstein/lose Aufgaben je
 * Bereich wie die Einplanen-Spalte im Kalender (`plan.ts`), Ziel = die Karte, die sie geöffnet hat
 * (umschaltbar). Eine Aufgabe auf einen freien Platz der Abendplanung bzw. auf „Fokus heute“
 * ziehen – oder in der Spalte antippen. Steht eine Aufgabe oder Notiz daneben offen, tritt die
 * Spalte zurück (bleibt eingehängt). Schmaler als 1280 px gibt es sie nicht: dort die Auswahl.
 */
export function TodayPickPanel() {
  const pick = usePick();
  const task = useTaskPeek();
  const note = useNotePeek();
  const wide = useMediaQuery(PEEK_PANEL_QUERY);
  const pathname = usePathname();
  const [width, setWidth] = useLocalNumber("sz:waehlen-breite", PANEL_WIDTH.initial, PANEL_WIDTH);
  if (!pick.target || !wide || pathname !== "/heute") return null;
  const behind = Boolean(task.taskId || note.noteId);
  return (
    <>
      {pick.folded && !behind ? (
        <Rail
          label="Aufgaben wählen"
          icon={ListChecks}
          side="panel"
          onClick={() => pick.open(pick.target as PickTarget)}
          className="flex"
        />
      ) : null}
      <div
        className={cn("sticky top-0 h-dvh shrink-0", (pick.folded || behind) && "hidden")}
        style={{ width }}
      >
        <ResizeHandle
          label="Breite der Aufgabenspalte"
          edge="left"
          value={width}
          min={PANEL_WIDTH.min}
          max={PANEL_WIDTH.max}
          onChange={setWidth}
          onReset={() => setWidth(PANEL_WIDTH.initial)}
        />
        <aside
          aria-label="Aufgaben wählen"
          data-tab-scroll="waehlen"
          className="flex h-full flex-col border-l border-border bg-bg"
          onKeyDown={(event) => {
            // nur aus der Spalte selbst (nicht aus Menüs, die per Portal darüber liegen)
            if (
              event.key === "Escape" &&
              !event.defaultPrevented &&
              event.currentTarget.contains(event.target as Node)
            ) {
              pick.close();
            }
          }}
        >
          <PickColumn target={pick.target} />
        </aside>
      </div>
    </>
  );
}

function PickColumn({ target }: { target: PickTarget }) {
  const pick = usePick();
  const { today, ctx, loading } = useTodayModel();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = usePlanFilters();
  const placement = useFocusPlacement(today);
  const full = placement.full(target);

  // Kandidaten wie die Auswahl: offen, nicht blockiert, nicht schon gewählt (Bereich beachtet)
  const tasks = useMemo(
    () =>
      target === "heute"
        ? today.candidates.filter((t) => t.focus_date !== today.today)
        : today.candidates,
    [today, target],
  );
  const plan = useMemo(
    () =>
      buildPlan(tasks, {
        today: today.today,
        area: null,
        projectId: null,
        query,
        filters,
        projects: ctx.projects,
        milestones: ctx.milestones,
        areas: ctx.areas,
        pool: () => true,
      }),
    [tasks, today.today, query, filters, ctx.projects, ctx.milestones, ctx.areas],
  );
  const parts = useMemo(
    () => ({
      renderRow: (row: TaskRow, { hidePlace }: { hidePlace?: boolean }) => (
        <PickRow
          task={row}
          hidePlace={hidePlace}
          target={target}
          data={today}
          projectTitle={ctx.projects.find((p) => p.id === row.project_id)?.title}
          disabled={full}
          onPlace={() => placement.place(row, target)}
        />
      ),
      areaColor: (areaId: string) => ctx.areas.find((a) => a.id === areaId)?.color,
      storagePrefix: "waehlen",
      nowTitle: "Dringend",
    }),
    [target, today, ctx.projects, ctx.areas, full, placement],
  );
  const count = placement.count(target);
  const hiddenByFilter = !filters.inbox || !filters.projects || !filters.ai;

  return (
    <>
      <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-ui font-medium">{TARGET_LABEL[target]}</h2>
          <div className="flex shrink-0 items-center">
            <FoldButton label="Aufgaben wählen" side="right" onClick={() => pick.fold(true)} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Aufgaben wählen schließen"
              onClick={pick.close}
            >
              <X size={16} strokeWidth={1.5} aria-hidden />
            </Button>
          </div>
        </div>
        <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0">
          <legend className="sr-only">Ziel</legend>
          {(["morgen", "heute"] as const).map((option) => (
            <Button
              key={option}
              variant={option === target ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={option === target}
              onClick={() => option !== target && pick.open(option)}
            >
              {option === "morgen" ? `Morgen (${formatDayShort(today.tomorrow)})` : "Fokus heute"}
            </Button>
          ))}
        </fieldset>
        <p
          data-testid="pick-summary"
          className={cn("text-ui-sm tabular-nums", full ? "text-warning" : "text-muted")}
        >
          {full
            ? `${count} von ${FOCUS_LIMIT} – voll, erst eine herausnehmen`
            : `${count} von ${FOCUS_LIMIT} gewählt · auf die Karte ziehen oder antippen`}
        </p>
        <PlanSearchBar
          query={query}
          onQuery={setQuery}
          filters={filters}
          onFilters={setFilters}
          searchLabel="Aufgaben zum Wählen suchen"
          menuLabel="Anzeige der Aufgabenspalte"
        />
      </div>
      <div
        data-tab-scroll="waehlen-liste"
        className="scroll-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-6"
      >
        {loading ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">Aufgaben werden geladen</span>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : plan.shown === 0 ? (
          <p className="px-1.5 text-ui-sm text-faint">
            {plan.searching
              ? "Nichts gefunden."
              : hiddenByFilter && plan.open === 0
                ? "Nichts zu sehen – das Filter-Menü blendet etwas aus."
                : "Keine weiteren Aufgaben zum Wählen."}
          </p>
        ) : null}
        <PlanPartsProvider value={parts}>
          <PlanGroups plan={plan} />
        </PlanPartsProvider>
      </div>
    </>
  );
}

/** Eine Aufgabe der Spalte: antippen legt sie ab, ziehen auch (nicht, wenn der Tag voll ist). */
function PickRow({
  task,
  hidePlace,
  target,
  data,
  projectTitle,
  disabled,
  onPlace,
}: {
  task: TaskRow;
  hidePlace?: boolean;
  target: PickTarget;
  data: TodayData;
  projectTitle?: string;
  disabled: boolean;
  onPlace: () => void;
}) {
  const reason = suggestionReason(task, data.today, data.tomorrow);
  const meta = [hidePlace ? "" : projectTitle?.trim(), reason.label].filter(Boolean).join(" · ");
  return (
    <TaskDragSource task={task} scope="waehlen" disabled={disabled}>
      <button
        type="button"
        onClick={onPlace}
        aria-label={`„${taskTitle(task)}“ ${target === "heute" ? "in den Fokus heute" : "für morgen"} wählen`}
        className="grid min-h-9 w-full grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-control px-1.5 py-1 text-left transition-colors hover:bg-surface-2 max-md:min-h-11"
      >
        <Plus size={15} strokeWidth={1.5} aria-hidden className="text-faint" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui">{taskTitle(task)}</span>
          {meta ? (
            <span
              className={cn("truncate text-meta", reason.urgent ? "text-danger" : "text-faint")}
            >
              {meta}
            </span>
          ) : null}
        </span>
      </button>
    </TaskDragSource>
  );
}

/**
 * „Andere Aufgabe wählen“ bzw. „Fokus wählen“: ab 1280 px öffnet der Knopf die Aufgabenspalte
 * rechts (nochmal drücken schließt sie), schmaler bleibt es die Auswahl mit Suche.
 */
export function PickLauncher({
  target,
  label,
  ariaLabel,
  tasks,
  projects,
  onSelect,
}: {
  target: PickTarget;
  label: string;
  ariaLabel: string;
  tasks: TaskRow[];
  projects: ProjectRow[];
  onSelect: (taskId: string) => void;
}) {
  const wide = useMediaQuery(PEEK_PANEL_QUERY);
  const pick = usePick();
  if (!wide) {
    return (
      <TaskPicker
        variant="add"
        label={label}
        ariaLabel={ariaLabel}
        tasks={tasks}
        projects={projects}
        onSelect={onSelect}
      />
    );
  }
  const open = pick.target === target && !pick.folded;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={open}
      onClick={() => (open ? pick.close() : pick.open(target))}
      className={cn(
        quietControlClasses,
        "inline-flex h-11 items-center gap-1.5 text-left hover:text-fg md:h-8",
        open ? "text-fg" : "text-faint",
      )}
    >
      <Plus size={14} strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
