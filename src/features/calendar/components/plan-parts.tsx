"use client";

/**
 * Bausteine der Aufgabenspalten „Einplanen“ (Kalender, #61/#62) und „Wählen“ (Heute, #90): Suche
 * mit Filter-Menü, „Jetzt“-Block, Inbox, Projekte nach Meilenstein, lose Aufgaben je Bereich. Die
 * Gruppierung steht in `../plan.ts` (rein, getestet); hier nur die Darstellung. Was in einer Zeile
 * steht, bestimmt die Spalte (`renderRow`), Klappzustände und Filter gelten je Gerät
 * (`storagePrefix` trennt die Spalten voneinander).
 */
import { ChevronRight, ListFilter, Search } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/input";
import {
  MenuCheckboxItem,
  MenuContent,
  MenuLabel,
  MenuRoot,
  MenuSelectAll,
  MenuTrigger,
} from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import type { TaskRow } from "@/features/tasks/types";
import { cn } from "@/lib/cn";
import { useLocalFlag, useLocalFlagOr } from "@/lib/local-pref";
import {
  ALL_PLAN_FILTERS,
  PLAN_NOW_MAX,
  type PlanFilters,
  type PlanMilestone,
  type PlanModel,
  type PlanProject,
} from "../plan";

/** Filter-Menü der Spalten, je Gerät gemerkt (alles an = alles zeigen). */
export function usePlanFilters(): [PlanFilters, (patch: Partial<PlanFilters>) => void] {
  const [inbox, setInbox] = useLocalFlag("sz:plan-inbox", ALL_PLAN_FILTERS.inbox);
  const [projects, setProjects] = useLocalFlag("sz:plan-projekte", ALL_PLAN_FILTERS.projects);
  const [ai, setAi] = useLocalFlag("sz:plan-ki", ALL_PLAN_FILTERS.ai);
  const set = (patch: Partial<PlanFilters>) => {
    if (patch.inbox !== undefined) setInbox(patch.inbox);
    if (patch.projects !== undefined) setProjects(patch.projects);
    if (patch.ai !== undefined) setAi(patch.ai);
  };
  return [{ inbox, projects, ai }, set];
}

interface PartsContext {
  /** eine Zeile der Spalte (ohne `<li>`) */
  renderRow: (task: TaskRow, options: { hidePlace?: boolean }) => React.ReactNode;
  /** Bereichsfarbe für den Punkt am Gruppenkopf */
  areaColor: (areaId: string) => Parameters<typeof AreaDot>[0]["color"] | undefined;
  /** Vorsatz der Schlüssel für Klappzustände (`sz:<prefix>-projekt-…`) */
  storagePrefix: string;
  /** Titel des Blocks mit dem Dringendsten */
  nowTitle: string;
}

const PartsCtx = createContext<PartsContext | null>(null);

function useParts(): PartsContext {
  const ctx = useContext(PartsCtx);
  if (!ctx) throw new Error("PlanParts: kein PlanPartsProvider");
  return ctx;
}

export function PlanPartsProvider({
  value,
  children,
}: {
  value: PartsContext;
  children: React.ReactNode;
}) {
  return <PartsCtx.Provider value={value}>{children}</PartsCtx.Provider>;
}

function Rows({ tasks, hidePlace }: { tasks: TaskRow[]; hidePlace?: boolean }) {
  const { renderRow } = useParts();
  return (
    <ul className="flex flex-col gap-px">
      {tasks.map((task) => (
        <li key={task.id}>{renderRow(task, { hidePlace })}</li>
      ))}
    </ul>
  );
}

const headClass =
  "flex min-h-9 w-full items-center gap-1.5 rounded-control px-1.5 text-left text-meta uppercase tracking-widest text-faint hover:text-muted max-md:min-h-11";

/** Gruppenkopf, der auf- und zuklappt (je Gerät gemerkt, Standard berechnet). */
function FoldHead({
  open,
  onToggle,
  title,
  count,
  dot,
  plain = false,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: number;
  dot?: React.ReactNode;
  /** Projektname in normaler Schrift statt Versalien */
  plain?: boolean;
}) {
  return (
    <h3>
      <button type="button" aria-expanded={open} onClick={onToggle} className={headClass}>
        <ChevronRight
          size={12}
          strokeWidth={1.75}
          aria-hidden
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        {dot}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            plain && "text-ui-sm normal-case tracking-normal text-muted",
          )}
        >
          {title}
        </span>
        <span className="tabular-nums">{count}</span>
      </button>
    </h3>
  );
}

function Milestone({ group, hidePlace }: { group: PlanMilestone; hidePlace?: boolean }) {
  return (
    <div className="flex flex-col gap-px">
      <p className="flex items-center justify-between px-1.5 pt-1 text-meta text-faint">
        <span className="min-w-0 truncate">{group.title}</span>
        <span className="tabular-nums">{group.tasks.length}</span>
      </p>
      <Rows tasks={group.tasks} hidePlace={hidePlace} />
    </div>
  );
}

function AreaDotFor({ areaId }: { areaId: string }) {
  const color = useParts().areaColor(areaId);
  return color ? <AreaDot color={color} /> : null;
}

function ProjectGroup({ project, searching }: { project: PlanProject; searching: boolean }) {
  const { storagePrefix } = useParts();
  const [stored, setOpen] = useLocalFlagOr(
    `sz:${storagePrefix}-projekt-${project.id}`,
    !project.big,
  );
  const [moreStored, setMore] = useLocalFlagOr(`sz:${storagePrefix}-mehr-${project.id}`, false);
  const open = searching || stored;
  const more = searching || moreStored;
  return (
    <section aria-label={project.title} className="flex flex-col gap-px">
      <FoldHead
        open={open}
        onToggle={() => setOpen(!stored)}
        title={project.title}
        count={project.count}
        plain
        dot={<AreaDotFor areaId={project.areaId} />}
      />
      {open ? (
        <div className="flex flex-col gap-px pl-2">
          {project.loose.length > 0 ? <Rows tasks={project.loose} hidePlace /> : null}
          {project.current ? <Milestone group={project.current} hidePlace /> : null}
          {project.later.length > 0 ? (
            more ? (
              <>
                {project.later.map((group) => (
                  <Milestone key={group.id ?? "ohne"} group={group} hidePlace />
                ))}
                {searching ? null : (
                  <button
                    type="button"
                    onClick={() => setMore(false)}
                    className="min-h-9 rounded-control px-1.5 text-left text-meta text-faint hover:text-muted max-md:min-h-11"
                  >
                    Spätere Meilensteine zuklappen
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setMore(true)}
                className="min-h-9 rounded-control px-1.5 text-left text-meta text-faint hover:bg-surface-2 hover:text-muted max-md:min-h-11"
              >
                + {project.later.length}{" "}
                {project.later.length === 1 ? "Meilenstein" : "Meilensteine"} · {project.laterTasks}{" "}
                {project.laterTasks === 1 ? "Aufgabe" : "Aufgaben"}
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Group({
  id,
  title,
  tasks,
  searching,
  dot,
}: {
  id: string;
  title: string;
  tasks: TaskRow[];
  searching: boolean;
  dot?: React.ReactNode;
}) {
  const { storagePrefix } = useParts();
  const [stored, setOpen] = useLocalFlagOr(`sz:${storagePrefix}-gruppe-${id}`, true);
  const open = searching || stored;
  return (
    <section aria-label={title} className="flex flex-col gap-px">
      <FoldHead
        open={open}
        onToggle={() => setOpen(!stored)}
        title={title}
        count={tasks.length}
        dot={dot}
      />
      {open ? <Rows tasks={tasks} /> : null}
    </section>
  );
}

/** Der Block mit dem Dringendsten: höchstens 7 Zeilen, der Rest hinter „N weitere“. */
function NowBlock({ tasks, searching }: { tasks: TaskRow[]; searching: boolean }) {
  const { nowTitle } = useParts();
  const [all, setAll] = useState(false);
  if (tasks.length === 0) return null;
  const limit = searching || all ? tasks.length : PLAN_NOW_MAX;
  const hidden = tasks.length - limit;
  return (
    <section
      aria-label={nowTitle}
      data-testid="plan-now"
      className="flex flex-col gap-px rounded-card bg-surface-2 p-1.5"
    >
      <h3 className="flex items-center justify-between px-1.5 py-1 text-meta uppercase tracking-widest text-muted">
        <span>{nowTitle}</span>
        <span className="tabular-nums">{tasks.length}</span>
      </h3>
      <Rows tasks={tasks.slice(0, limit)} />
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-9 rounded-control px-1.5 text-left text-meta text-muted hover:text-fg max-md:min-h-11"
        >
          {hidden} weitere
        </button>
      ) : null}
      {!searching && all && tasks.length > PLAN_NOW_MAX ? (
        <button
          type="button"
          onClick={() => setAll(false)}
          className="min-h-9 rounded-control px-1.5 text-left text-meta text-muted hover:text-fg max-md:min-h-11"
        >
          Weniger zeigen
        </button>
      ) : null}
    </section>
  );
}

/** Alle Gruppen der Spalte in der Reihenfolge des Modells (Jetzt, Inbox, Projekte, Bereiche). */
export function PlanGroups({ plan }: { plan: PlanModel }) {
  const { areaColor } = useParts();
  return (
    <>
      <NowBlock tasks={plan.now} searching={plan.searching} />
      {plan.inbox.length > 0 ? (
        <Group id="inbox" title="Inbox" tasks={plan.inbox} searching={plan.searching} />
      ) : null}
      {plan.projects.map((project) => (
        <ProjectGroup key={project.id} project={project} searching={plan.searching} />
      ))}
      {plan.areas.map((area) => {
        const color = areaColor(area.id);
        return (
          <Group
            key={area.id}
            id={`bereich-${area.id}`}
            title={`${area.name} · ohne Projekt`}
            tasks={area.tasks}
            searching={plan.searching}
            dot={color ? <AreaDot color={color} /> : undefined}
          />
        );
      })}
    </>
  );
}

/** Suchfeld und Filter-Menü über den Gruppen. */
export function PlanSearchBar({
  query,
  onQuery,
  filters,
  onFilters,
  searchLabel,
  menuLabel,
}: {
  query: string;
  onQuery: (query: string) => void;
  filters: PlanFilters;
  onFilters: (patch: Partial<PlanFilters>) => void;
  searchLabel: string;
  menuLabel: string;
}) {
  const hiddenByFilter = !filters.inbox || !filters.projects || !filters.ai;
  return (
    <div className="flex items-center gap-1.5">
      <label className="relative block min-w-0 flex-1">
        <Search
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label={searchLabel}
          placeholder="Suchen …"
          className={cn(controlClasses, "h-9 pl-8 text-ui-sm max-md:h-11")}
        />
      </label>
      <MenuRoot modal={false}>
        <MenuTrigger asChild>
          <Button
            variant={hiddenByFilter ? "secondary" : "ghost"}
            size="icon-sm"
            className="size-9 shrink-0 max-md:size-11"
            aria-label={menuLabel}
            title="Anzeige der Spalte"
          >
            <ListFilter size={15} strokeWidth={1.5} aria-hidden />
          </Button>
        </MenuTrigger>
        <MenuContent align="end" aria-label={menuLabel}>
          <MenuLabel>Zeigen</MenuLabel>
          <MenuSelectAll
            all={filters.inbox && filters.projects && filters.ai}
            none={!filters.inbox && !filters.projects && !filters.ai}
            onAll={() => onFilters({ inbox: true, projects: true, ai: true })}
            onNone={() => onFilters({ inbox: false, projects: false, ai: false })}
          />
          <MenuCheckboxItem
            checked={filters.inbox}
            onCheckedChange={(v) => onFilters({ inbox: v === true })}
            onSelect={(e) => e.preventDefault()}
          >
            Inbox
          </MenuCheckboxItem>
          <MenuCheckboxItem
            checked={filters.projects}
            onCheckedChange={(v) => onFilters({ projects: v === true })}
            onSelect={(e) => e.preventDefault()}
          >
            Projekte
          </MenuCheckboxItem>
          <MenuCheckboxItem
            checked={filters.ai}
            onCheckedChange={(v) => onFilters({ ai: v === true })}
            onSelect={(e) => e.preventDefault()}
          >
            Von KI angelegt
          </MenuCheckboxItem>
        </MenuContent>
      </MenuRoot>
    </div>
  );
}
