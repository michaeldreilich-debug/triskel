"use client";

/**
 * Einplanen-Spalte (S2b, #61, #62 Variante D): oben „Jetzt einplanen“ (die eine getönte Fläche),
 * darunter Inbox, Projekte nach Meilenstein und lose Aufgaben je Bereich – zum Ziehen auf einen
 * Tag oder eine Uhrzeit. Zurückziehen in die Spalte entfernt das Datum. Am Handy als Sheet; dort
 * und ohne Maus geht „Verschieben auf …“ über ⋯ bzw. Rechtsklick. Die Gruppierung steht in
 * `../plan.ts` (rein, getestet); Klappzustände und Filter gelten je Gerät.
 */
import { CalendarX2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { TaskRow } from "@/features/tasks/types";
import { cn } from "@/lib/cn";
import { placeTask } from "../model";
import { buildPlan, type PlanFilters, type PlanModel } from "../plan";
import { useCalendar } from "./calendar-context";
import { DraggableTask, DropZone } from "./calendar-dnd";
import { TaskChip } from "./chips";
import { PlanGroups, PlanPartsProvider, PlanSearchBar, usePlanFilters } from "./plan-parts";

export { usePlanFilters };

/** Das Modell der Spalte aus den Daten des Kalenders (Sidebar und Zähler am Reiter). */
export function usePlanModel(tasks: TaskRow[], query: string, filters: PlanFilters): PlanModel {
  const { ctx, today, area, projectId } = useCalendar();
  return useMemo(
    () =>
      buildPlan(tasks, {
        today,
        area,
        projectId,
        query,
        filters,
        projects: ctx.projects,
        milestones: ctx.milestones,
        areas: ctx.areas,
      }),
    [tasks, today, area, projectId, query, filters, ctx.projects, ctx.milestones, ctx.areas],
  );
}

const ROW_CLASS = "max-md:min-h-11";

function PlanRow({ task, hidePlace = false }: { task: TaskRow; hidePlace?: boolean }) {
  const { today } = useCalendar();
  const item = placeTask(task, today) ?? {
    kind: "task" as const,
    id: `task:${task.id}`,
    date: today,
    task,
    time: null,
    duration: null,
    overdueSince: null,
    focus: false,
    dueElsewhere: null,
    done: false,
  };
  const overdue = task.due_date && task.due_date < today ? task.due_date : null;
  return (
    <DraggableTask task={task}>
      <TaskChip
        item={{ ...item, overdueSince: overdue, dueElsewhere: task.due_date }}
        variant="row"
        wrap
        hidePlace={hidePlace}
        hoverSide="left"
        className={ROW_CLASS}
      />
    </DraggableTask>
  );
}

export function PlanSidebar({
  tasks,
  className,
  onShowAllAreas,
}: {
  tasks: TaskRow[];
  className?: string;
  /** „Alle Bereiche zeigen“ im Hinweis auf ausgeblendete Aufgaben */
  onShowAllAreas?: () => void;
}) {
  const { ctx } = useCalendar();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = usePlanFilters();
  const plan = usePlanModel(tasks, query, filters);
  const hiddenByFilter = !filters.inbox || !filters.projects || !filters.ai;
  const empty = plan.shown === 0;
  const parts = useMemo(
    () => ({
      renderRow: (task: TaskRow, { hidePlace }: { hidePlace?: boolean }) => (
        <PlanRow task={task} hidePlace={hidePlace} />
      ),
      areaColor: (areaId: string) => ctx.areas.find((a) => a.id === areaId)?.color,
      storagePrefix: "plan",
      nowTitle: "Jetzt einplanen",
    }),
    [ctx.areas],
  );
  return (
    <DropZone
      target={{ kind: "unschedule" }}
      label="Einplanen: Aufgaben ohne Datum"
      className={cn("flex min-h-0 flex-col gap-3 rounded-card", className)}
      overClassName="outline outline-1 outline-dashed outline-border-strong bg-surface-2"
    >
      <p data-testid="plan-summary" className="px-1.5 text-ui-sm text-muted tabular-nums">
        {plan.open} offen · {plan.nowCount} jetzt
      </p>
      <PlanSearchBar
        query={query}
        onQuery={setQuery}
        filters={filters}
        onFilters={setFilters}
        searchLabel="Aufgaben zum Einplanen suchen"
        menuLabel="Einplanen-Anzeige"
      />
      <p className="flex items-center gap-1.5 text-meta text-faint">
        <CalendarX2 size={12} strokeWidth={1.5} aria-hidden />
        Hierher ziehen = Datum entfernen
      </p>
      <div
        data-tab-scroll="einplanen"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-quiet"
      >
        {empty ? (
          <p className="px-1.5 text-ui-sm text-faint">
            {plan.searching
              ? "Nichts gefunden."
              : hiddenByFilter && plan.open === 0
                ? "Nichts zu sehen – das Filter-Menü blendet etwas aus."
                : "Alles eingeplant – nichts offen ohne Uhrzeit."}
          </p>
        ) : null}
        <PlanPartsProvider value={parts}>
          <PlanGroups plan={plan} />
        </PlanPartsProvider>
        {plan.hiddenByArea > 0 ? (
          <p data-testid="plan-hidden-areas" className="px-1.5 text-ui-sm text-faint">
            {plan.hiddenByArea === 1
              ? "1 weitere Aufgabe"
              : `${plan.hiddenByArea} weitere Aufgaben`}{" "}
            in anderen Bereichen.{" "}
            {onShowAllAreas ? (
              <button
                type="button"
                onClick={onShowAllAreas}
                className="text-muted underline underline-offset-2 hover:text-fg"
              >
                Alle Bereiche zeigen
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </DropZone>
  );
}
