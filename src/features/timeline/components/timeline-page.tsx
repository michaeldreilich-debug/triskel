"use client";

/**
 * Seite „Projekte › Zeitstrahl“ `/projekte/zeitstrahl` (#55, N2): Kopf mit Farbstrich und
 * Kennzahlen (Variante 3), Achse aller Projekte mit Filtern (Variante 1), Karten „Nächster
 * Schritt“. Keine eigenen Daten – nur Projekte, Meilensteine und Aufgaben. Filter je Gerät
 * gemerkt; der Bereich kommt vom Bereichs-Schalter der App.
 */
import { ChevronLeft, ChevronRight, ListChecks, Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { ProjectStatusIcon } from "@/components/ui/progress-ring";
import { SectionHeader } from "@/components/ui/section-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryLine, type SummaryPart } from "@/components/ui/summary-line";
import { useAreas } from "@/features/areas/api";
import { useMilestones, useProjects } from "@/features/projects/api";
import { useNow } from "@/features/projects/components/project-database";
import { projectProgress } from "@/features/projects/rules";
import { PROJECT_STATUS_LABELS, type ProjectStatus, projectTitle } from "@/features/projects/types";
import { useTasks } from "@/features/tasks/api";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinDate, formatRange, type IsoDate } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import { isArrowKeyTarget, isEditableTarget } from "@/lib/undo";
import { useTimelineFilters } from "../hooks";
import {
  buildTimeline,
  DEFAULT_TIMELINE_FILTERS,
  nextStepCards,
  SORT_LABELS,
  TIMELINE_SORTS,
  TIMELINE_STATUSES,
  TIMELINE_ZOOMS,
  timelineStats,
  ZOOM_LABELS,
  zoomStep,
} from "../model";
import { MilestoneMark, TimelineAxis } from "./axis";
import { NextStepCardView, StatTiles } from "./overview";

const AREA_STRIPE = {
  orange: "border-area-orange",
  blue: "border-area-blue",
} as const;

function Legend() {
  return (
    <ul
      aria-label="Zeichen der Achse"
      className="flex flex-wrap gap-x-5 gap-y-1.5 text-meta text-faint"
    >
      <li className="flex items-center gap-2">
        <MilestoneMark state="done" /> Meilenstein erreicht
      </li>
      <li className="flex items-center gap-2">
        <MilestoneMark state="open" /> offen
      </li>
      <li className="flex items-center gap-2">
        <MilestoneMark state="overdue" /> überfällig
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden className="h-2 w-6 rounded-full border border-fg/60 bg-fg/20" />
        Balken: Start → Ziel, gefüllt = erledigte Aufgaben
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden className="h-2 w-6 rounded-full border border-dashed border-fg/60" />
        gestrichelt: nur Start oder Ziel eingetragen
      </li>
    </ul>
  );
}

export function TimelinePage() {
  const projects = useProjects();
  const milestones = useMilestones();
  const tasks = useTasks();
  const areas = useAreas();
  const area = useUi((s) => s.area);
  const setArea = useUi((s) => s.setArea);
  const now = useNow(60_000);
  const [today, setToday] = useState<IsoDate | null>(null);
  useEffect(() => setToday(berlinDate(new Date(now))), [now]);
  const [filters, setFilters] = useTimelineFilters();
  const [offset, setOffset] = useState(0);

  const areaList = areas.data ?? [];
  const activeArea = area && areaList.some((a) => a.id === area) ? area : null;
  const activeAreaColor = areaList.find((a) => a.id === activeArea)?.color;
  const queries = [projects, milestones, tasks, areas];
  const error = queries.some((q) => q.isError && !q.data);
  const loading = !today || (!error && queries.some((q) => q.isPending));

  const allProjects = projects.data ?? [];
  const allMilestones = milestones.data ?? [];
  const allTasks = tasks.data ?? [];

  const model = useMemo(
    () =>
      today
        ? buildTimeline({
            projects: allProjects,
            milestones: allMilestones,
            tasks: allTasks,
            area: activeArea,
            filters,
            offset,
            today,
          })
        : null,
    [today, allProjects, allMilestones, allTasks, activeArea, filters, offset],
  );
  const stats = useMemo(
    () => (today ? timelineStats(allProjects, allMilestones, allTasks, activeArea, today) : null),
    [today, allProjects, allMilestones, allTasks, activeArea],
  );
  const cards = useMemo(
    () => nextStepCards(allProjects, allMilestones, allTasks, activeArea),
    [allProjects, allMilestones, allTasks, activeArea],
  );

  const step = zoomStep(filters.zoom);
  const move = (direction: -1 | 1) => {
    if (step > 0) setOffset((o) => o + direction);
  };

  // Tasten: ←/→ Zeitraum, T heute – nie in Textfeldern oder mit Modifier
  // biome-ignore lint/correctness/useExhaustiveDependencies: `move` ändert sich mit `step`
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      // Achse und Umschalter behalten ihre Pfeiltasten (U-2)
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        isArrowKeyTarget(event.target)
      )
        return;
      if (event.key === "ArrowLeft") move(-1);
      else if (event.key === "ArrowRight") move(1);
      else if (event.key.toLowerCase() === "t") setOffset(0);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const summary: SummaryPart[] = [];
  if (model) {
    const n = model.rows.length;
    summary.push({ text: `${n} ${n === 1 ? "Projekt" : "Projekte"} im Zeitraum` });
    if (model.undated.length) summary.push({ text: `${model.undated.length} ohne Termin` });
    const overdue = model.rows.reduce((sum, r) => sum + r.overdue, 0);
    if (overdue)
      summary.push({
        text: `${overdue} Meilenstein${overdue === 1 ? "" : "e"} überfällig`,
        tone: "danger",
      });
  }

  const toggleStatus = (status: ProjectStatus) => {
    const set = new Set<string>(filters.statuses);
    if (set.has(status)) set.delete(status);
    else set.add(status);
    setFilters({ statuses: TIMELINE_STATUSES.filter((s) => set.has(s)) });
  };
  const resetFilters = () => {
    setFilters({ ...DEFAULT_TIMELINE_FILTERS });
    setOffset(0);
  };

  return (
    <Page className="gap-5">
      <div
        className={cn(
          "flex flex-col gap-5 border-t-[3px] pt-5",
          activeAreaColor ? AREA_STRIPE[activeAreaColor] : "border-border-strong",
        )}
      >
        <PageHeader
          title="Zeitstrahl"
          meta={
            <>
              <Link href={appPath.projects()} className="hover:text-fg hover:underline">
                Projekte
              </Link>
              {" › Zeitstrahl"}
              {model ? (
                <span className="tabular-nums">
                  {" · "}
                  {formatRange(model.window.start, model.window.end)}
                </span>
              ) : null}
            </>
          }
          summary={
            summary.length ? <SummaryLine parts={summary} data-testid="timeline-summary" /> : null
          }
          actions={
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Zeitraum zurück"
                title="Zurück (←)"
                disabled={step === 0}
                onClick={() => move(-1)}
              >
                <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                title="Heute (T)"
                disabled={offset === 0}
                onClick={() => setOffset(0)}
              >
                Heute
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Zeitraum weiter"
                title="Weiter (→)"
                disabled={step === 0}
                onClick={() => move(1)}
              >
                <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
              </Button>
            </div>
          }
        />
        {stats && today ? <StatTiles stats={stats} today={today} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* biome-ignore lint/a11y/useSemanticElements: Gruppe von Umschaltknöpfen, kein Formular */}
        <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
          {TIMELINE_STATUSES.map((status) => {
            const on = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatus(status)}
                className={cn(
                  "min-h-11 rounded-full border px-3 text-ui-sm transition-colors md:min-h-8",
                  on
                    ? "border-accent bg-accent font-medium text-accent-fg"
                    : "border-border-strong text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {PROJECT_STATUS_LABELS[status]}
              </button>
            );
          })}
        </div>
        <SegmentedControl
          aria-label="Zeitraum"
          value={filters.zoom}
          onValueChange={(zoom) => {
            setFilters({ zoom });
            setOffset(0);
          }}
          options={TIMELINE_ZOOMS.map((zoom) => ({ value: zoom, label: ZOOM_LABELS[zoom] }))}
          className="shrink-0 max-md:w-full [&_button]:whitespace-nowrap"
        />
        <SegmentedControl
          aria-label="Sortierung"
          value={filters.sort}
          onValueChange={(sort) => setFilters({ sort })}
          options={TIMELINE_SORTS.map((sort) => ({ value: sort, label: SORT_LABELS[sort] }))}
          className="shrink-0 max-md:w-full [&_button]:whitespace-nowrap"
        />
        <p className="hidden text-meta text-faint lg:block">
          <Kbd>←</Kbd> <Kbd>→</Kbd> Zeitraum · <Kbd>T</Kbd> heute
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-card border border-danger/50 p-4 text-ui"
        >
          <p className="text-danger">
            Der Zeitstrahl konnte nicht geladen werden. Verbindung prüfen.
          </p>
          <Button
            size="sm"
            onClick={() => {
              for (const q of queries) void q.refetch();
            }}
          >
            Erneut laden
          </Button>
        </div>
      ) : loading || !model || !today ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">Zeitstrahl wird geladen</span>
          <Skeleton className="h-72 rounded-card" />
        </div>
      ) : (
        <>
          {model.rows.length > 0 ? (
            <section aria-label="Achse" className="flex flex-col gap-3">
              <TimelineAxis
                model={model}
                areas={areaList}
                tasks={allTasks}
                today={today}
                zoom={filters.zoom}
              />
              <Legend />
            </section>
          ) : (
            <EmptyState
              icon={<ListChecks strokeWidth={1.5} />}
              title="Keine Projekte im Zeitraum"
              description={
                filters.statuses.length === 0
                  ? "Wähle oben mindestens einen Status."
                  : "Mit diesen Filtern liegt nichts auf der Achse. Zeitraum „Alles“ zeigt jedes Projekt mit Datum."
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={() => setFilters({ zoom: "alles" })}>
                    Alles zeigen
                  </Button>
                  <Button size="sm" variant="ghost" onClick={resetFilters}>
                    Filter zurücksetzen
                  </Button>
                </div>
              }
            />
          )}

          {model.hiddenByArea > 0 ? (
            <p className="px-1 text-ui-sm text-faint">
              {model.hiddenByArea === 1
                ? "1 weiteres Projekt"
                : `${model.hiddenByArea} weitere Projekte`}{" "}
              in anderen Bereichen.{" "}
              <button
                type="button"
                onClick={() => setArea(null)}
                className="text-muted underline underline-offset-2 hover:text-fg"
              >
                Alle Bereiche zeigen
              </button>
            </p>
          ) : null}

          {model.undated.length > 0 ? (
            <section aria-label="Ohne Termin" className="flex flex-col gap-2">
              <h2 className="flex items-baseline gap-2 border-b border-border pb-1.5 text-ui-sm font-medium text-muted">
                Ohne Termin
                <span className="text-faint tabular-nums">{model.undated.length}</span>
              </h2>
              <p className="text-meta text-faint">
                Kein Start, kein Ziel und kein Meilenstein mit Datum – darum nicht auf der Achse.
              </p>
              <ul className="flex flex-col" data-testid="timeline-undated">
                {model.undated.map((project) => {
                  const progress = projectProgress(project.id, allTasks);
                  const color = areaList.find((a) => a.id === project.area_id)?.color;
                  return (
                    <li key={project.id}>
                      <Link
                        href={appPath.project(project.id)}
                        className="flex min-h-11 items-center gap-3 rounded-card px-2.5 py-2 hover:bg-surface"
                      >
                        <ProjectStatusIcon
                          status={project.status}
                          color={color}
                          progress={progress.ratio}
                        />
                        <span className="min-w-0 flex-1 truncate text-ui font-medium">
                          {projectTitle(project)}
                        </span>
                        <span className="text-meta text-faint">
                          {PROJECT_STATUS_LABELS[project.status]}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {cards.length > 0 ? (
            <section aria-label="Nächster Schritt" className="flex flex-col gap-3">
              <SectionHeader
                icon={Target}
                title="Nächster Schritt"
                sub="Aktive Projekte, frühestes Ziel zuerst"
                meta={cards.length}
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {cards.map((card) => (
                  <NextStepCardView
                    key={card.project.id}
                    card={card}
                    area={areaList.find((a) => a.id === card.project.area_id)}
                    tasks={allTasks}
                    today={today}
                    now={now}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </Page>
  );
}
