"use client";

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Clock,
  FolderKanban,
  Hourglass,
  Inbox,
  ListChecks,
  type LucideIcon,
  Moon,
  Plus,
  Target,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { SectionHeader, SegmentMeter } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryLine, type SummaryPart } from "@/components/ui/summary-line";
import { BackupHint } from "@/features/backup/components/backup-status";
import { CalendarProvider } from "@/features/calendar/components/calendar-context";
import { CALENDAR_BG } from "@/features/calendar/components/calendar-dot";
import { CalendarChip } from "@/features/calendar/components/chips";
import { AllDayList } from "@/features/calendar/components/day-parts";
import { useCalendarData } from "@/features/calendar/hooks";
import { minutesToTime } from "@/features/calendar/layout";
import {
  type CalendarDay,
  DEFAULT_FILTERS,
  type TimedEntry,
  viewRange,
} from "@/features/calendar/model";
import { CaptureField } from "@/features/inbox/capture";
import { AssignPopover } from "@/features/inbox/inbox-page";
import { InstallHint } from "@/features/install/components/install-hint";
import { useNotes } from "@/features/notes/api";
import { useMilestones, useProjects } from "@/features/projects/api";
import { formatProgress } from "@/features/projects/rules";
import { projectTitle } from "@/features/projects/types";
import { DayTimeline } from "@/features/recaps/components/day-timeline";
import { ReviewHints } from "@/features/recaps/components/review-hints";
import { activityEntries, dayActivity, daySummary } from "@/features/recaps/model";
import { useTaskActions } from "@/features/tasks/api";
import { TaskDragSource, TaskDropZone, useDraggedTask } from "@/features/tasks/components/task-dnd";
import { type TaskContext, TaskItem } from "@/features/tasks/components/task-item";
import { PEEK_PANEL_QUERY, useMediaQuery, useTaskPeek } from "@/features/tasks/peek";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinTime, formatDateLong, formatDayShort, parseIsoDate } from "@/lib/dates";
import { useLocalFlag, useLocalNumber } from "@/lib/local-pref";
import { useFocusPlacement, usePick } from "./pick";
import { PickLauncher } from "./pick-panel";
import {
  FOCUS_LIMIT,
  suggestionReason,
  type TimedEntryLike,
  type TodayData,
  timeline,
  todaySummary,
} from "./select";
import { useTodayModel } from "./use-today";

/**
 * Abschnitt auf Heute (Muster 1, #23): „card“ = die eine gefüllte Karte (Fokus), „frame“ =
 * leichter Rahmen ohne Fläche (zusammengehörige Abschnitte), „open“ = ohne Rahmen (rechte
 * Spalte), „highlight“ = Abendplanung ab 19:00.
 */
function Section({
  title,
  icon,
  sub,
  meta,
  variant,
  iconClassName,
  className,
  children,
  ...props
}: {
  title: string;
  icon: LucideIcon;
  sub?: React.ReactNode;
  meta?: React.ReactNode;
  variant: "card" | "frame" | "open" | "highlight";
  iconClassName?: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col gap-3",
        variant !== "open" && "rounded-card border p-4 md:p-5",
        variant === "card" && "border-border bg-surface",
        variant === "frame" && "border-border",
        variant === "highlight" && "border-next-step-border bg-next-step-bg",
        className,
      )}
      {...props}
    >
      <SectionHeader
        icon={icon}
        title={title}
        sub={sub}
        meta={meta}
        iconClassName={iconClassName}
      />
      {children}
    </section>
  );
}

/** Breite der rechten Spalte (Tagesablauf, Erledigt, Projekte), am linken Rand ziehbar (#95). */
const SIDE_WIDTH = { initial: 360, min: 280, max: 640 };

/** Heute (B9, Feinschliff #23): Fokus, Fälliges, Inbox, Abendplanung, Tagesablauf, Projekte. */
export function TodayPage() {
  const { data, now, mounted, activeArea, today, ctx, loading } = useTodayModel();
  // #90: steht rechts die Aufgabenspalte, bekommt die Seite eine Spalte statt zwei – sonst würden
  // Fokus und Abendplanung schmal; die rechte Hälfte (Tagesablauf …) rückt darunter
  const pickWide = useMediaQuery(PEEK_PANEL_QUERY);
  const pick = usePick();
  const pickOpen = pickWide && pick.target !== null && !pick.folded;
  const [sideWidth, setSideWidth] = useLocalNumber(
    "sz:heute-rechts-breite",
    SIDE_WIDTH.initial,
    SIDE_WIDTH,
  );
  const day = parseIsoDate(today.today);
  const nowTime = berlinTime(new Date(now));

  // Tagesablauf aus dem Kalendermodell (S2c): Google-Termine, Zeitblöcke, ganztägig + Fristen –
  // dieselben Bausteine und Regeln wie /kalender; blockierte Aufgaben bleiben wie überall auf
  // Heute außen vor (Fokus-Regel 3)
  const range = useMemo(() => viewRange("tag", today.today), [today.today]);
  const calendar = useCalendarData(range, DEFAULT_FILTERS, today.today);
  const calendarDay = useMemo<CalendarDay | null>(() => {
    const first = calendar.days[0];
    if (!first) return null;
    const visible = (entry: TimedEntry) =>
      entry.item.kind !== "task" || entry.item.done || !data.ctx.blocked.has(entry.item.task.id);
    return { ...first, timed: first.timed.filter(visible) };
  }, [calendar.days, data.ctx.blocked]);
  const appointments = useMemo<TimedEntryLike[]>(
    () =>
      (calendarDay?.timed ?? []).map((entry) => ({
        time: minutesToTime(entry.from),
        done: entry.item.kind === "task" && entry.item.done,
      })),
    [calendarDay],
  );

  const evening = <EveningCard data={today} ctx={ctx} />;

  return (
    <div className="flex w-full flex-col gap-6 px-4 py-6 md:px-8 md:py-8 lg:px-10">
      <header className="flex flex-col gap-1.5">
        <p className="min-h-[18px] text-ui-sm text-faint">
          {mounted && day ? formatDateLong(day) : ""}
        </p>
        <h1 className="heading text-title-sm tracking-tight md:text-title-lg">Heute</h1>
        {loading || data.error ? null : (
          <DaySummary data={today} nowTime={nowTime} appointments={appointments} />
        )}
        {loading ? null : <BackupHint now={now} />}
        {loading ? null : <ReviewHints now={now} />}
      </header>
      <CaptureField />
      <InstallHint />

      {data.error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-card border border-danger/50 p-4 text-ui"
        >
          <p className="text-danger">Heute konnte nicht geladen werden. Verbindung prüfen.</p>
          <Button size="sm" onClick={data.retry}>
            Erneut laden
          </Button>
        </div>
      ) : loading ? (
        <div
          className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_var(--heute-rechts-w)]"
          style={{ "--heute-rechts-w": `${sideWidth}px` } as React.CSSProperties}
          aria-busy="true"
        >
          <span className="sr-only">Heute wird geladen</span>
          <Skeleton className="h-56 rounded-card" />
          <Skeleton className="h-56 rounded-card" />
        </div>
      ) : (
        <>
          {/* ab 19:00 steht die Abendplanung oben */}
          {today.evening ? evening : null}
          <div
            className={cn(
              "grid grid-cols-1 items-start gap-8",
              !pickOpen && "lg:grid-cols-[minmax(0,1fr)_var(--heute-rechts-w)]",
            )}
            style={{ "--heute-rechts-w": `${sideWidth}px` } as React.CSSProperties}
          >
            <div className="flex min-w-0 flex-col gap-5">
              <FocusCard data={today} ctx={ctx} />
              <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
                <DueCard data={today} ctx={ctx} />
                <InboxCard data={today} ctx={ctx} />
              </div>
              {today.evening ? null : evening}
            </div>
            <div
              className={cn(
                "relative flex min-w-0 flex-col gap-8",
                !pickOpen && "lg:border-l lg:border-border lg:pl-8",
              )}
            >
              <ResizeHandle
                label="Breite der rechten Spalte"
                edge="left"
                value={sideWidth}
                min={SIDE_WIDTH.min}
                max={SIDE_WIDTH.max}
                onChange={setSideWidth}
                onReset={() => setSideWidth(SIDE_WIDTH.initial)}
                className={cn("hidden", !pickOpen && "lg:block")}
              />
              <CalendarProvider ctx={ctx} today={today.today} area={activeArea} projectId={null}>
                <ScheduleCard data={today} day={calendarDay} nowTime={nowTime} />
              </CalendarProvider>
              <DoneTodayCard day={today.today} area={activeArea} tasks={data.tasks} />
              <ProjectsCard data={today} ctx={ctx} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Eine Zeile unter dem Titel: Fokus, Überfälliges, Inbox, nächster Termin (Muster 1). */
function DaySummary({
  data,
  nowTime,
  appointments,
}: {
  data: TodayData;
  nowTime: string;
  appointments: TimedEntryLike[];
}) {
  const summary = todaySummary(data, nowTime, appointments);
  const parts: SummaryPart[] = [
    {
      text: summary.focus
        ? `${summary.focus} im Fokus${summary.focusDone ? `, ${summary.focusDone} erledigt` : ""}`
        : "Noch kein Fokus",
    },
  ];
  if (summary.overdue) parts.push({ text: `${summary.overdue} überfällig`, tone: "danger" });
  if (summary.inbox) parts.push({ text: `${summary.inbox} in der Inbox` });
  if (summary.nextAppointment) parts.push({ text: `nächster Termin ${summary.nextAppointment}` });
  return <SummaryLine parts={parts} data-testid="today-summary" />;
}

function FocusCard({ data, ctx }: { data: TodayData; ctx: TaskContext }) {
  const actions = useTaskActions();
  const placement = useFocusPlacement(data);
  const dragged = useDraggedTask();
  return (
    <TaskDropZone
      id="fokus:heute"
      accepts={(task) => placement.problem(task, "heute") === null}
      onDropTask={(task) => placement.place(task, "heute")}
      onReject={(task) => placement.place(task, "heute")}
      readyClassName="outline outline-2 outline-offset-2 outline-dashed outline-border-strong"
      overClassName="outline outline-2 outline-offset-2 outline-fg/60"
      className="rounded-card"
    >
      <Section
        title="Fokus heute"
        icon={Target}
        variant="card"
        sub={data.focus.length ? "Die drei, die heute zählen" : "Noch nichts gewählt"}
        meta={
          data.focus.length ? (
            <>
              <SegmentMeter value={data.focusDone} total={data.focus.length} />
              {data.focusDone} von {data.focus.length}
            </>
          ) : undefined
        }
      >
        {data.focus.length === 0 ? (
          <p className="text-ui text-muted">
            Die Abendplanung wählt ihn für morgen. Jetzt bis zu {FOCUS_LIMIT} wählen:
          </p>
        ) : (
          <ul aria-label="Fokus heute" className="-mx-2.5 flex flex-col gap-0.5">
            {data.focus.map((task) => (
              <li key={task.id}>
                <TaskItem task={task} ctx={ctx} />
              </li>
            ))}
          </ul>
        )}
        {dragged && placement.problem(dragged, "heute") === null ? (
          <p
            data-testid="focus-drop-hint"
            className="flex min-h-8 items-center text-ui-sm font-medium text-muted"
          >
            Hier ablegen: kommt in den Fokus von heute
          </p>
        ) : data.focus.length < FOCUS_LIMIT ? (
          <div>
            <PickLauncher
              target="heute"
              label="Fokus wählen"
              ariaLabel="Fokus für heute wählen"
              tasks={data.candidates.filter((t) => t.focus_date !== data.today)}
              projects={ctx.projects}
              onSelect={(id) => actions.setFocus(id, data.today)}
            />
          </div>
        ) : null}
      </Section>
    </TaskDropZone>
  );
}

function DueCard({ data, ctx }: { data: TodayData; ctx: TaskContext }) {
  const overdue = data.due.filter((t) => (t.due_date ?? "") < data.today).length;
  const dueToday = data.due.length - overdue;
  return (
    <Section
      title="Fällig & überfällig"
      icon={CalendarClock}
      variant="frame"
      sub={
        data.due.length === 0 ? (
          "Nichts fällig"
        ) : (
          <>
            {overdue ? <span className="text-danger">{overdue} überfällig</span> : null}
            {overdue && dueToday ? ", " : null}
            {dueToday ? `${dueToday} heute` : null}
          </>
        )
      }
      meta={data.due.length || undefined}
    >
      {data.due.length === 0 ? (
        <p className="text-ui-sm text-faint">Nichts fällig.</p>
      ) : (
        <ul aria-label="Fällig & überfällig" className="-mx-2.5 flex flex-col gap-0.5">
          {data.due.map((task) => (
            <li key={task.id}>
              <TaskItem task={task} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}
      {data.hiddenBlocked > 0 ? (
        <p className="text-meta text-faint">
          {data.hiddenBlocked === 1
            ? "1 blockierte Aufgabe"
            : `${data.hiddenBlocked} blockierte Aufgaben`}{" "}
          ausgeblendet.
        </p>
      ) : null}
    </Section>
  );
}

function InboxCard({ data, ctx }: { data: TodayData; ctx: TaskContext }) {
  const peek = useTaskPeek();
  return (
    <Section
      title="Inbox"
      icon={Inbox}
      variant="frame"
      sub={data.inbox.length ? "Noch ohne Bereich oder Projekt" : "Leer – alles zugeordnet"}
      meta={data.inbox.length || undefined}
    >
      {data.inbox.length === 0 ? (
        <p className="text-ui-sm text-faint">Leer – alles zugeordnet.</p>
      ) : (
        <ul aria-label="Inbox-Vorschau" className="flex flex-col">
          {data.inbox.slice(0, 3).map((task) => (
            <li
              key={task.id}
              className="flex min-h-11 items-center justify-between gap-2 border-b border-border last:border-b-0 md:min-h-10"
            >
              <Link
                href={peek.hrefFor(task.id)}
                scroll={false}
                className="min-w-0 truncate text-ui hover:underline"
              >
                {taskTitle(task)}
              </Link>
              <AssignPopover task={task} areas={ctx.areas} projects={ctx.projects} />
            </li>
          ))}
        </ul>
      )}
      {data.inbox.length > 3 ? (
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1 text-ui-sm text-muted hover:text-fg"
        >
          Alle {data.inbox.length} in der Inbox
          <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
        </Link>
      ) : null}
    </Section>
  );
}

/**
 * Tagesablauf als Zeitleiste mit Jetzt-Linie (Muster 6): ganztägig + Fristen oben, dann Google-
 * Termine und Zeitblöcke gemeinsam nach Uhrzeit (Chips wie im Kalender, Termin-Klick öffnet das
 * Detail mit „In Google öffnen“), dazwischen Jetzt-Linie und Abendplanung.
 */
function ScheduleCard({
  data,
  day,
  nowTime,
}: {
  data: TodayData;
  day: CalendarDay | null;
  nowTime: string;
}) {
  const timed = day?.timed ?? [];
  const entries = timed.map((entry) => ({ time: minutesToTime(entry.from), entry }));
  const items = timeline(entries, nowTime, data.eveningTime);
  const count = timed.length;
  const allDay = day?.allDay.length ?? 0;
  return (
    <Section
      title="Tagesablauf"
      icon={Clock}
      variant="open"
      sub={allDay ? "Ganztägig, Fristen, Uhrzeiten" : "Termine mit Uhrzeit"}
      meta={count ? (count === 1 ? "1 Termin" : `${count} Termine`) : undefined}
    >
      {day && allDay ? <AllDayList day={day} variant="row" /> : null}
      <ol aria-label="Tagesablauf" className="relative flex flex-col">
        {/* senkrechte Linie durch die Punkte (Mitte der zweiten Spalte: 2,75 rem + 0,625 rem Abstand
          + 7 px; in rem, damit sie bei jeder Schriftgröße durch die Punkte läuft, M3-4) */}
        <span
          aria-hidden
          className="absolute top-5 bottom-5 left-[calc(3.375rem+6.5px)] w-px bg-border-strong"
        />
        {items.map((item) => {
          if (item.kind === "now") {
            return (
              <li
                key="jetzt"
                className="grid min-h-7 grid-cols-[2.75rem_14px_minmax(0,1fr)] items-center gap-2.5"
              >
                <span className="text-ui-sm font-semibold tabular-nums">{item.time}</span>
                <span className="relative z-10 size-2.5 justify-self-center rounded-full bg-fg" />
                <span className="flex items-center gap-2 text-meta text-muted">
                  jetzt
                  <span aria-hidden className="h-px flex-1 bg-fg/35" />
                </span>
              </li>
            );
          }
          if (item.kind === "evening") {
            return (
              <li
                key="abend"
                className="grid min-h-11 grid-cols-[2.75rem_14px_minmax(0,1fr)] items-center gap-2.5 md:min-h-10"
              >
                <span
                  className={cn(
                    "text-ui-sm tabular-nums",
                    data.evening ? "text-next-step-label" : "text-faint",
                  )}
                >
                  {item.time}
                </span>
                <span className="relative z-10 size-2.5 justify-self-center rounded-full border-[1.5px] border-next-step-label bg-bg" />
                <span className="flex min-w-0 items-center gap-2 text-ui">
                  <Moon
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden
                    className="shrink-0 text-next-step-label"
                  />
                  <span className="truncate">Abendplanung: {FOCUS_LIMIT} für morgen wählen</span>
                </span>
              </li>
            );
          }
          const { entry } = item.entry;
          const done = entry.item.kind === "task" && entry.item.done;
          return (
            <li
              key={entry.item.id}
              className="grid min-h-11 grid-cols-[2.75rem_14px_minmax(0,1fr)] items-center gap-2.5 md:min-h-10"
            >
              <span className="text-ui-sm text-faint tabular-nums">
                {entry.continuesBefore ? "…" : item.time}
              </span>
              <span
                className={cn(
                  "relative z-10 size-2.5 justify-self-center rounded-full border-[1.5px]",
                  entry.item.kind === "event"
                    ? cn("border-transparent", CALENDAR_BG[entry.item.event.color])
                    : cn("border-faint", done ? "bg-faint" : "bg-bg"),
                )}
              />
              <CalendarChip item={entry.item} variant="timeline" className="-mx-1.5" />
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/**
 * Tagesverlauf „Erledigt heute“ (E24, Muster 6): was heute erledigt, erreicht, angelegt oder
 * bearbeitet wurde – als Zeitleiste, einklappbar (Zustand je Gerät).
 */
function DoneTodayCard({
  day,
  area,
  tasks,
}: {
  day: string;
  area: string | null;
  tasks: TaskRow[];
}) {
  const notes = useNotes();
  const milestones = useMilestones();
  const projects = useProjects();
  const [collapsed, setCollapsed] = useLocalFlag("sz:heute-erledigt-zu", false);
  const activity = dayActivity({
    day,
    area,
    tasks,
    notes: notes.data ?? [],
    milestones: milestones.data ?? [],
    projects: projects.data ?? [],
  });
  const entries = activityEntries(activity);
  const done = activity.done.length + activity.milestones.length;
  const listId = "erledigt-heute-liste";
  return (
    <Section
      title="Erledigt heute"
      icon={ListChecks}
      variant="open"
      sub={entries.length ? daySummary(activity) : "Noch nichts erledigt oder bearbeitet"}
      meta={
        <>
          {done ? <span>{done}</span> : null}
          {entries.length ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={!collapsed}
              aria-controls={listId}
              aria-label={collapsed ? "Erledigt heute ausklappen" : "Erledigt heute einklappen"}
              onClick={() => setCollapsed(!collapsed)}
            >
              <ChevronDown
                size={16}
                strokeWidth={1.5}
                aria-hidden
                className={cn("transition-transform", collapsed && "-rotate-90")}
              />
            </Button>
          ) : null}
        </>
      }
    >
      {entries.length > 0 ? (
        <div id={listId} hidden={collapsed}>
          {collapsed ? null : <DayTimeline entries={entries} label="Verlauf heute" />}
        </div>
      ) : null}
    </Section>
  );
}

/** Projekte im Blick: Fortschrittsring in Bereichsfarbe, nächster Schritt oder Grund (Muster 5). */
function ProjectsCard({ data, ctx }: { data: TodayData; ctx: TaskContext }) {
  return (
    <Section
      title="Projekte im Blick"
      icon={FolderKanban}
      variant="open"
      sub="Aktiv, mit Fortschritt und nächstem Schritt"
      meta={data.projects.length || undefined}
    >
      {data.projects.length === 0 ? (
        <p className="text-ui-sm text-faint">Keine aktiven Projekte.</p>
      ) : (
        <ul aria-label="Projekte im Blick" className="flex flex-col gap-2">
          {data.projects.map(({ project, progress, stale, stuck, next }) => {
            const area = ctx.areas.find((a) => a.id === project.area_id);
            const warning = stale
              ? { icon: Hourglass, text: "14 Tage still – kommt aufs Wochenreview" }
              : !next && stuck
                ? { icon: AlertTriangle, text: "Festgefahren: nächster Schritt fehlt" }
                : null;
            return (
              <li
                key={project.id}
                className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-3 py-1"
              >
                <ProgressRing
                  value={progress.ratio}
                  color={area?.color}
                  label={`Fortschritt ${projectTitle(project)}`}
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={appPath.project(project.id)}
                    className="truncate text-ui font-medium hover:underline"
                  >
                    {projectTitle(project)}
                  </Link>
                  {warning ? (
                    <p className="flex min-w-0 items-center gap-1.5 text-meta text-warning">
                      <warning.icon size={13} strokeWidth={1.5} aria-hidden className="shrink-0" />
                      <span className="truncate">{warning.text}</span>
                    </p>
                  ) : (
                    <p className="truncate text-meta text-faint">
                      {next ? `Nächster Schritt: ${taskTitle(next)}` : "Kein nächster Schritt"}
                    </p>
                  )}
                </div>
                <span className="pt-0.5 text-meta text-faint tabular-nums">
                  {formatProgress(progress)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * Abendplanung (Fokus-Regel 5, Muster 7): höchstens 3 Aufgaben als Fokus für morgen, als drei
 * Plätze. Vorschläge nennen ihren Grund. Ab 19:00 hervorgehoben und oben; morgen stehen sie
 * unter „Fokus heute“ ganz oben.
 */
function EveningCard({ data, ctx }: { data: TodayData; ctx: TaskContext }) {
  const actions = useTaskActions();
  const placement = useFocusPlacement(data);
  const dragged = useDraggedTask();
  const full = data.planned.length >= FOCUS_LIMIT;
  const choose = (task: TaskRow) => {
    if (!full) actions.setFocus(task.id, data.tomorrow);
  };
  const slots = Array.from({ length: FOCUS_LIMIT }, (_, i) => data.planned[i] ?? null);
  // beim Ziehen: nimmt der Plan die Aufgabe an, leuchten die freien Plätze auf
  const accepting = dragged !== null && placement.problem(dragged, "morgen") === null;
  return (
    <Section
      title="Abendplanung"
      icon={Moon}
      variant={data.evening ? "highlight" : "frame"}
      iconClassName={data.evening ? "text-next-step-label" : undefined}
      data-highlighted={data.evening ? "true" : "false"}
      sub={
        <span className={data.evening ? "text-next-step-label" : undefined}>
          {data.evening ? "Jetzt wählen" : `ab ${data.eveningTime}`} · Fokus für{" "}
          {formatDayShort(data.tomorrow)}
        </span>
      }
      meta={`${data.planned.length} von ${FOCUS_LIMIT}`}
    >
      <TaskDropZone
        as="div"
        id="abend:plaetze"
        accepts={(task) => placement.problem(task, "morgen") === null}
        onDropTask={(task) => placement.place(task, "morgen")}
        onReject={(task) => placement.place(task, "morgen")}
        readyClassName=""
        overClassName=""
        blockedClassName=""
        className="rounded-card"
      >
        <ol aria-label="Fokus für morgen" className="flex flex-wrap gap-2">
          {slots.map((task, index) =>
            task ? (
              <li
                key={task.id}
                className="group flex h-11 min-w-0 basis-full items-center gap-2.5 rounded-card border border-border bg-surface pr-1 pl-3 sm:flex-1 sm:basis-0"
              >
                <span className="text-ui-sm font-semibold text-muted tabular-nums">
                  {index + 1}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-ui",
                    task.status === "erledigt" && "text-faint line-through",
                  )}
                >
                  {taskTitle(task)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`„${taskTitle(task)}“ aus dem Plan nehmen`}
                  onClick={() => actions.setFocus(task.id, null)}
                >
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </Button>
              </li>
            ) : (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: freie Plätze haben keine eigene ID
                key={`frei-${index}`}
                data-drop-slot={accepting ? "bereit" : undefined}
                className={cn(
                  "flex h-11 min-w-0 flex-1 basis-0 items-center gap-2.5 rounded-card border border-dashed px-3 text-ui-sm",
                  accepting
                    ? "border-next-step-label bg-surface text-fg"
                    : "border-border-strong text-faint",
                )}
              >
                <span className="font-semibold text-muted tabular-nums">{index + 1}</span>
                {accepting ? "hier ablegen" : "frei"}
              </li>
            ),
          )}
        </ol>
      </TaskDropZone>
      {full ? (
        <p className="text-ui-sm text-muted">
          Morgen steht. Mehr als {FOCUS_LIMIT} verwässert den Fokus.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.suggestions.length > 0 ? (
            <>
              <p className="pt-1 text-meta uppercase tracking-widest text-faint">Vorschläge</p>
              <ul aria-label="Vorschläge für morgen" className="-mx-2 flex flex-col">
                {data.suggestions.map((task) => {
                  const reason = suggestionReason(task, data.today, data.tomorrow);
                  return (
                    <li key={task.id}>
                      <TaskDragSource task={task} scope="vorschlag">
                        <button
                          type="button"
                          onClick={() => choose(task)}
                          className="grid min-h-11 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-control px-2 text-left transition-colors hover:bg-surface-2 md:min-h-9"
                        >
                          <Plus size={15} strokeWidth={1.5} aria-hidden className="text-faint" />
                          <span className="truncate text-ui">{taskTitle(task)}</span>
                          {reason.label ? (
                            <span
                              className={cn(
                                "whitespace-nowrap text-meta",
                                reason.urgent ? "text-danger" : "text-faint",
                              )}
                            >
                              {reason.label}
                            </span>
                          ) : (
                            <span />
                          )}
                        </button>
                      </TaskDragSource>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <div>
            <PickLauncher
              target="morgen"
              label="Andere Aufgabe wählen"
              ariaLabel="Aufgabe für morgen wählen"
              tasks={data.candidates}
              projects={ctx.projects}
              onSelect={(id) => {
                const task = data.candidates.find((t) => t.id === id);
                if (task) choose(task);
              }}
            />
          </div>
        </div>
      )}
    </Section>
  );
}
