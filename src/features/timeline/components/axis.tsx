"use client";

/**
 * Achse (#55, Variante 1): alle Projekte auf einer Zeitachse. Zeile = Projekt (Status-Symbol in
 * Bereichsfarbe, Name, Meta), Balken von Start bis Ziel (gefüllt = Aufgaben-Fortschritt,
 * gestrichelt = Datum nur abgeleitet), Meilensteine als Rauten (erreicht grün gefüllt, offen
 * leer, überfällig rot mit Warnsymbol), Heute-Linie, Monats- und Wochenraster. Am Handy scrollt
 * die Achse in sich waagrecht, die Namen bleiben links stehen.
 */
import { AlertTriangle, AppWindow, ExternalLink, Link2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HoverCard } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { OPEN_IN_NEW_TAB, useOpenInNewTab } from "@/components/shell/tabs/tabs-provider";
import { copyAppLink } from "@/components/ui/copy-link";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { type AreaColor, AreaDot } from "@/components/ui/pill";
import { ProjectStatusIcon } from "@/components/ui/progress-ring";
import type { AreaSummary } from "@/features/areas/defaults";
import { projectProgress } from "@/features/projects/rules";
import { PROJECT_STATUS_LABELS, projectTitle } from "@/features/projects/types";
import type { TaskRow } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { formatDue, type IsoDate } from "@/lib/dates";
import type { TimelineMilestone, TimelineModel, TimelineRow } from "../model";

const BAR_BORDER: Record<AreaColor, string> = {
  orange: "border-area-orange",
  blue: "border-area-blue",
};
const BAR_SOFT: Record<AreaColor, string> = {
  orange: "bg-area-orange/20",
  blue: "bg-area-blue/20",
};
const BAR_FILL: Record<AreaColor, string> = {
  orange: "bg-area-orange/70",
  blue: "bg-area-blue/70",
};

/** Rauten-Punkt eines Meilensteins: Form und Farbe nach Zustand, Warnsymbol bei überfällig. */
export function MilestoneMark({
  state,
  className,
}: {
  state: TimelineMilestone["state"];
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block size-3 shrink-0 rotate-45 border-[1.5px]",
        state === "done" && "border-success bg-success",
        state === "open" && "border-fg bg-bg",
        state === "overdue" && "border-danger bg-bg",
        className,
      )}
    ></span>
  );
}

function milestoneWhen(m: TimelineMilestone, today: IsoDate): { text: string; danger: boolean } {
  if (m.state === "done")
    return { text: `erreicht ${m.doneOn ? formatDue(m.doneOn, today) : ""}`.trim(), danger: false };
  if (m.state === "overdue")
    return { text: `überfällig seit ${formatDue(m.due, today)}`, danger: true };
  return { text: `fällig ${formatDue(m.due, today)}`, danger: false };
}

/** Kärtchen beim Drüberfahren (wie `TaskHover` im Kalender): Titel, Projekt, Zustand, Aufgaben. */
function MilestoneHover({
  milestone,
  row,
  area,
  today,
  children,
}: {
  milestone: TimelineMilestone;
  row: TimelineRow;
  area: AreaSummary | undefined;
  today: IsoDate;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const when = milestoneWhen(milestone, today);
  return (
    <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={300} closeDelay={80}>
      <HoverCard.Trigger asChild onPointerDown={() => setOpen(false)}>
        {children}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          data-testid="milestone-hover"
          className="z-50 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-card border border-border bg-surface p-3 text-fg shadow-float data-[state=open]:animate-pop-in"
        >
          <p className="text-ui font-medium break-words">
            {milestone.title.trim() || "Meilenstein"}
          </p>
          <p className="flex items-center gap-1.5 text-ui-sm text-muted">
            {area ? <AreaDot color={area.color} /> : null}
            <span className="min-w-0 break-words">{projectTitle(row.project)}</span>
          </p>
          <p className={cn("text-meta tabular-nums", when.danger ? "text-danger" : "text-faint")}>
            {when.text}
            {milestone.tasksTotal > 0
              ? ` · ${milestone.tasksDone} von ${milestone.tasksTotal} Aufgaben`
              : ""}
          </p>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

/** Monatsbeschriftung; bei sehr schmalen Monaten nur zum Quartalsanfang. */
const showMonthLabel = (width: number, date: IsoDate) =>
  width >= 5 || ["01", "04", "07", "10"].includes(date.slice(5, 7));

function ProjectRowView({
  row,
  area,
  tasks,
  today,
}: {
  row: TimelineRow;
  area: AreaSummary | undefined;
  tasks: TaskRow[];
  today: IsoDate;
}) {
  const router = useRouter();
  const openInNewTab = useOpenInNewTab();
  const { project, bar } = row;
  const title = projectTitle(project);
  const progress = projectProgress(project.id, tasks);
  const color = area?.color ?? "blue";
  const dim = project.status !== "aktiv" && project.status !== "geplant";
  const href = appPath.project(project.id);
  const meta = [
    area?.name,
    PROJECT_STATUS_LABELS[project.status],
    row.milestoneTotal > 0 ? `${row.milestoneDone} von ${row.milestoneTotal} Meilensteinen` : null,
  ].filter(Boolean);
  const barLabel = bar
    ? `${title}: ${bar.inferred ? "Zeitraum abgeleitet, " : ""}${bar.from} bis ${bar.to}`
    : title;
  return (
    <ContextMenuRoot modal={false}>
      <ContextMenuTrigger asChild>
        <li
          data-timeline-row={project.id}
          className="grid min-h-14 grid-cols-[var(--lab)_minmax(0,1fr)] items-center border-b border-border last:border-b-0"
        >
          <div className="sticky left-0 z-20 flex min-h-14 min-w-0 items-center gap-2.5 bg-bg py-2 pr-3 pl-3 md:pl-4">
            <ProjectStatusIcon
              status={project.status}
              color={color}
              progress={progress.ratio}
              className="shrink-0"
            />
            <span className="flex min-w-0 flex-col">
              <Link
                href={href}
                className="truncate text-ui-sm font-medium hover:underline md:text-ui"
              >
                {title}
              </Link>
              <span className="truncate text-meta text-faint">
                {meta.join(" · ")}
                {row.overdue > 0 ? (
                  <span className="text-danger">
                    {" · "}
                    {row.overdue} überfällig
                  </span>
                ) : null}
              </span>
            </span>
          </div>
          <div className="relative z-10 h-14">
            {bar ? (
              <Link
                href={href}
                aria-label={barLabel}
                title={barLabel}
                data-timeline-bar={project.id}
                data-inferred={bar.inferred || undefined}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                className="absolute top-1/2 flex h-8 min-w-3 -translate-y-1/2 items-center"
              >
                <span
                  className={cn(
                    "relative block h-2.5 w-full overflow-hidden border",
                    BAR_BORDER[color],
                    bar.inferred ? "border-dashed" : BAR_SOFT[color],
                    !bar.cutLeft && "rounded-l-full",
                    !bar.cutRight && "rounded-r-full",
                    bar.cutLeft && "border-l-0",
                    bar.cutRight && "border-r-0",
                    dim && "opacity-60",
                  )}
                >
                  {!bar.inferred && progress.ratio ? (
                    <span
                      className={cn("absolute inset-y-0 left-0", BAR_FILL[color])}
                      style={{ width: `${progress.ratio * 100}%` }}
                    />
                  ) : null}
                </span>
              </Link>
            ) : null}
            {row.milestones.map((m) => {
              const when = milestoneWhen(m, today);
              const label = `Meilenstein „${m.title.trim() || "Meilenstein"}“, ${when.text}, ${title}`;
              return (
                <MilestoneHover key={m.id} milestone={m} row={row} area={area} today={today}>
                  <Link
                    href={href}
                    aria-label={label}
                    data-milestone={m.id}
                    data-state={m.state}
                    style={{ left: `${m.pos}%` }}
                    className="absolute top-1/2 z-10 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center pointer-coarse:size-11"
                  >
                    <MilestoneMark state={m.state} />
                    {m.state === "overdue" ? (
                      <AlertTriangle
                        size={11}
                        strokeWidth={2}
                        aria-hidden
                        className="absolute -top-0.5 -right-0.5 text-danger"
                      />
                    ) : null}
                  </Link>
                </MilestoneHover>
              );
            })}
          </div>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => router.push(href)}>
          <ExternalLink aria-hidden />
          Öffnen
        </ContextMenuItem>
        {openInNewTab ? (
          <ContextMenuItem onSelect={() => openInNewTab(href)}>
            <AppWindow aria-hidden />
            {OPEN_IN_NEW_TAB}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => void copyAppLink(href)}>
          <Link2 aria-hidden />
          Link kopieren
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}

export function TimelineAxis({
  model,
  areas,
  tasks,
  today,
  zoom,
}: {
  model: TimelineModel;
  areas: AreaSummary[];
  tasks: TaskRow[];
  today: IsoDate;
  zoom: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Handy: Heute-Linie beim Öffnen und nach dem Verschieben in die Mitte holen
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur bei neuem Fenster neu ausrichten
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const lab = Number.parseFloat(getComputedStyle(el).getPropertyValue("--lab")) * 16 || 0;
    const track = el.scrollWidth - lab;
    const target =
      model.todayPos === null ? 0 : lab + (track * model.todayPos) / 100 - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, target);
  }, [model.window.start, model.window.end, zoom]);

  return (
    <section
      ref={scroller}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Scroll-Container muss per Tastatur scrollbar sein
      tabIndex={0}
      aria-label="Zeitstrahl, waagrecht scrollbar"
      data-testid="timeline-axis"
      data-tab-scroll="zeitachse"
      className="scroll-quiet overflow-x-auto rounded-card border border-border [--lab:8.5rem] md:[--lab:15rem]"
    >
      <div className="relative min-w-[46rem]">
        {/* Raster und Heute-Linie über alle Zeilen, hinter den Balken */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 left-[var(--lab)] z-0"
        >
          {model.months.map((month) => (
            <span
              key={month.date}
              className="absolute inset-y-0 border-l border-border"
              style={{ left: `${month.left}%` }}
            />
          ))}
          {model.weeks.map((left) => (
            <span
              key={left}
              className="absolute inset-y-0 border-l border-border/50"
              style={{ left: `${left}%` }}
            />
          ))}
          {model.todayPos !== null ? (
            <span
              data-testid="timeline-today"
              className="absolute inset-y-0 z-[5] w-0 border-l-2 border-fg"
              style={{ left: `${model.todayPos}%` }}
            />
          ) : null}
        </div>
        <div className="relative z-10 grid h-9 grid-cols-[var(--lab)_minmax(0,1fr)] border-b border-border">
          <div className="sticky left-0 z-20 bg-bg" />
          <div className="relative">
            {model.months.map((month) =>
              showMonthLabel(month.width, month.date) ? (
                <span
                  key={month.date}
                  className="absolute top-2 overflow-hidden pl-1.5 text-meta whitespace-nowrap text-faint"
                  style={{ left: `${month.left}%`, maxWidth: `${month.width}%` }}
                >
                  {month.label}
                </span>
              ) : null,
            )}
            {model.todayPos !== null ? (
              <span
                className="absolute bottom-0.5 z-[6] -translate-x-1/2 rounded-control bg-fg px-1.5 text-meta font-medium text-bg"
                style={{ left: `${model.todayPos}%` }}
              >
                heute
              </span>
            ) : null}
          </div>
        </div>
        <ul aria-label="Projekte auf dem Zeitstrahl" className="relative z-10">
          {model.rows.map((row) => (
            <ProjectRowView
              key={row.project.id}
              row={row}
              area={areas.find((a) => a.id === row.project.area_id)}
              tasks={tasks}
              today={today}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
