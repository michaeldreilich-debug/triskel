"use client";

/**
 * Geführtes Wochenreview (S1c): Schritt für Schritt Inbox leeren → Projekte durchgehen →
 * Fälliges der nächsten Woche → Wochenrückblick schreiben → Fokus nächste Woche. Jederzeit
 * abbrechbar; der Stand liegt am Wochenrückblick der Woche (recaps.review) und gilt auf jedem
 * Gerät. „Fälliges“ zeigt die nächste Woche mit denselben Kalender-Bausteinen wie /kalender
 * (Monatsraster als eine Woche, mit Tageslast).
 */
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleCheck,
  FolderKanban,
  Hourglass,
  Inbox,
  type LucideIcon,
  PenLine,
  Plus,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ProgressRing } from "@/components/ui/progress-ring";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryLine, type SummaryPart } from "@/components/ui/summary-line";
import { CalendarProvider } from "@/features/calendar/components/calendar-context";
import { MonthView } from "@/features/calendar/components/views";
import { useCalendarData } from "@/features/calendar/hooks";
import { calendarSummary, DEFAULT_FILTERS } from "@/features/calendar/model";
import { InboxItem, inboxItems } from "@/features/inbox/inbox-page";
import { useProjectActions } from "@/features/projects/api";
import { useNow } from "@/features/projects/components/project-database";
import { projectProgress, stuckText } from "@/features/projects/rules";
import { projectTitle } from "@/features/projects/types";
import { useTaskActions } from "@/features/tasks/api";
import { TaskPicker } from "@/features/tasks/components/pickers";
import type { TaskContext } from "@/features/tasks/components/task-item";
import { useTaskData } from "@/features/tasks/hooks";
import { useTaskPeek } from "@/features/tasks/peek";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinDate, formatDayShort, formatRange, type IsoDate } from "@/lib/dates";
import { useRecapActions, useRecaps, useWeekStats } from "../api";
import { DEFAULT_QUESTIONS, findRecap, questionsOf, weekLabel } from "../model";
import {
  EMPTY_REVIEW,
  focusSuggestions,
  nextWeek,
  REVIEW_STEPS,
  type ReviewProject,
  reviewProjects,
  reviewWeek,
} from "../review";
import type { RecapRow, ReviewState, WeekStats } from "../types";
import { useRecapQuestions } from "./recap-questions";
import { ReflectionFields } from "./reflection-fields";

const STEP_ICONS: LucideIcon[] = [Inbox, FolderKanban, CalendarDays, PenLine, Target];

type Week = { start: IsoDate; end: IsoDate };

export function WeeklyReviewPage() {
  const params = useSearchParams();
  const recaps = useRecaps();
  const data = useTaskData({ forMe: true });
  // Datum erst im Browser (der Server kennt die Uhr des Geräts nicht)
  const [today, setToday] = useState<IsoDate | null>(null);
  useEffect(() => setToday(berlinDate()), []);
  const requested = params.get("woche");
  const week = useMemo(() => (today ? reviewWeek(today, requested) : null), [today, requested]);

  if (!today || !week || recaps.isPending || data.loading) {
    return (
      <Page>
        <div className="flex flex-col gap-4" aria-busy="true">
          <span className="sr-only">Wochenreview wird geladen</span>
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-72 w-full rounded-card" />
        </div>
      </Page>
    );
  }
  if (recaps.isError || data.error) {
    return (
      <Page>
        <p role="alert" className="text-ui text-danger">
          Wochenreview konnte nicht geladen werden. Verbindung prüfen.
        </p>
      </Page>
    );
  }
  const recap = findRecap(recaps.data ?? [], "woche", week.start);
  const review = recap?.review ?? EMPTY_REVIEW;
  return (
    <Page>
      <PageHeader
        title="Wochenreview"
        meta={`${weekLabel(week.start)} · ${formatRange(week.start, week.end)}`}
        summary={<ReviewSummary review={review} recap={recap} tasks={data.tasks} ctx={data.ctx} />}
      />
      {!recap || !review.started_at ? (
        <ReviewIntro week={week} recap={recap} />
      ) : review.finished_at ? (
        <ReviewDone recap={recap} />
      ) : (
        <ReviewSteps recap={recap} review={review} week={week} today={today} data={data} />
      )}
    </Page>
  );
}

function ReviewSummary({
  review,
  recap,
  tasks,
  ctx,
}: {
  review: ReviewState;
  recap: RecapRow | null;
  tasks: TaskRow[];
  ctx: TaskContext;
}) {
  const now = useNow();
  const inbox = inboxItems(tasks).length;
  const stuck = reviewProjects(ctx.projects, tasks, now).filter((p) => p.stuck.length || p.stale);
  const parts: SummaryPart[] = [];
  if (review.finished_at) parts.push({ text: "abgeschlossen" });
  else if (review.started_at)
    parts.push({ text: `Schritt ${review.step + 1} von ${REVIEW_STEPS.length}` });
  else parts.push({ text: "noch nicht gestartet" });
  parts.push({ text: inbox === 1 ? "1 in der Inbox" : `${inbox} in der Inbox` });
  if (stuck.length) {
    parts.push({
      text:
        stuck.length === 1 ? "1 Projekt braucht Blick" : `${stuck.length} Projekte brauchen Blick`,
      tone: "warning",
    });
  }
  if (recap?.closed_at) parts.push({ text: "Rückblick abgeschlossen" });
  return <SummaryLine parts={parts} data-testid="review-summary" />;
}

/** Vor dem Start: was kommt, ein Knopf. Legt den Wochenrückblick an, falls es ihn noch nicht gibt. */
function ReviewIntro({ week, recap }: { week: Week; recap: RecapRow | null }) {
  const actions = useRecapActions();
  const questions = useRecapQuestions();
  const start = () => {
    const target = recap ?? actions.createWeek(week.start, week.end, questions);
    actions.review(target.id, (current) => ({
      ...current,
      step: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
    }));
  };
  return (
    <section
      aria-label="Wochenreview starten"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 md:p-6"
    >
      <SectionHeader
        icon={Target}
        title={`Wochenreview ${weekLabel(week.start)}`}
        sub="Fünf Schritte, etwa 20 Minuten – jederzeit abbrechbar, der Stand bleibt."
      />
      <ol className="flex flex-col gap-2">
        {REVIEW_STEPS.map((step, i) => {
          const Icon = STEP_ICONS[i] ?? Target;
          return (
            <li key={step.key} className="flex items-start gap-3 text-ui">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-meta tabular-nums text-muted">
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Icon size={14} strokeWidth={1.5} aria-hidden className="text-faint" />
                  {step.title}
                </span>
                <span className="text-ui-sm text-muted">{step.sub}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div>
        <Button variant="primary" onClick={start}>
          Wochenreview starten
        </Button>
      </div>
    </section>
  );
}

function ReviewDone({ recap }: { recap: RecapRow }) {
  const actions = useRecapActions();
  // je Punkt einmal (gleiche Punkte doppelt sind ohnehin sinnlos)
  const focus = [...new Set(recap.focus_next.map((f) => f.trim()).filter(Boolean))];
  return (
    <section
      aria-label="Wochenreview abgeschlossen"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 md:p-6"
    >
      <SectionHeader
        icon={CircleCheck}
        iconClassName="text-success"
        title={`Wochenreview ${weekLabel(recap.period_start)} abgeschlossen`}
        sub={recap.closed_at ? "Die Zahlen der Woche sind festgehalten." : undefined}
      />
      {focus.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-meta uppercase tracking-widest text-faint">Fokus nächste Woche</p>
          <ol className="flex flex-col gap-1 text-ui">
            {focus.map((item, i) => (
              <li key={item} className="flex gap-2">
                <span className="w-4 shrink-0 text-faint tabular-nums">{i + 1}</span>
                {item}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={appPath.recap(recap.id)}
          className="inline-flex h-11 items-center gap-2 rounded-control bg-accent px-4 text-ui font-medium text-accent-fg hover:bg-accent/90 md:h-9"
        >
          Rückblick ansehen
        </Link>
        <Link
          href="/heute"
          className="inline-flex h-11 items-center rounded-control border border-border px-4 text-ui hover:bg-surface-2 md:h-9"
        >
          Zu Heute
        </Link>
        <Button
          variant="ghost"
          onClick={() =>
            actions.review(recap.id, (current) => ({ ...current, step: 0, finished_at: null }))
          }
        >
          Nochmal durchgehen
        </Button>
      </div>
    </section>
  );
}

function ReviewSteps({
  recap,
  review,
  week,
  today,
  data,
}: {
  recap: RecapRow;
  review: ReviewState;
  week: Week;
  today: IsoDate;
  data: ReturnType<typeof useTaskData>;
}) {
  const actions = useRecapActions();
  const top = useRef<HTMLDivElement>(null);
  const step = review.step;
  const current = REVIEW_STEPS[step] ?? REVIEW_STEPS[0];
  const Icon = STEP_ICONS[step] ?? Target;
  const live = useWeekStats(recap.period_start, recap.period_end, !recap.closed_at);
  const stats: WeekStats | null =
    recap.closed_at && recap.stats ? recap.stats : (live.data ?? null);
  const go = (next: number) => {
    actions.review(recap.id, (state) => ({ ...state, step: next }));
    top.current?.scrollIntoView({ block: "start" });
  };
  const finish = () => {
    actions.review(recap.id, (state) => ({ ...state, finished_at: new Date().toISOString() }));
    if (!recap.closed_at) actions.close(recap.id, stats);
  };
  const last = step === REVIEW_STEPS.length - 1;
  return (
    <div ref={top} className="flex min-w-0 scroll-mt-8 flex-col gap-6">
      <ol aria-label="Schritte" className="flex flex-wrap items-center gap-1.5">
        {REVIEW_STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={i === step ? "step" : undefined}
              aria-label={`Schritt ${i + 1}: ${s.title}${i < step ? " (erledigt)" : ""}`}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full px-1.5 text-ui-sm transition-colors md:min-h-8 md:pr-3",
                i === step ? "text-fg" : "text-faint hover:text-fg",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-meta tabular-nums",
                  i === step
                    ? "border-accent bg-accent text-accent-fg"
                    : i < step
                      ? "border-success text-success"
                      : "border-border-strong",
                )}
              >
                {i < step ? <Check size={12} strokeWidth={2.5} aria-hidden /> : i + 1}
              </span>
              <span className={cn("max-md:hidden", i === step && "font-medium")}>{s.title}</span>
            </button>
            {i < REVIEW_STEPS.length - 1 ? (
              <span aria-hidden className="h-px w-3 bg-border md:w-5" />
            ) : null}
          </li>
        ))}
      </ol>

      <section
        aria-label={current.title}
        className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-surface p-4 md:p-6"
      >
        <SectionHeader icon={Icon} title={`${step + 1} · ${current.title}`} sub={current.sub} />
        {current.key === "inbox" ? (
          <InboxStep data={data} />
        ) : current.key === "projekte" ? (
          <ProjectsStep recap={recap} review={review} data={data} />
        ) : current.key === "faellig" ? (
          <DueStep week={week} today={today} tasks={data.tasks} />
        ) : current.key === "rueckblick" ? (
          <RecapStep recap={recap} stats={stats} />
        ) : (
          <FocusStep recap={recap} week={week} data={data} />
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => go(step - 1)}>
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
            Zurück
          </Button>
        ) : null}
        {last ? (
          <Button variant="primary" onClick={finish}>
            <CircleCheck size={16} strokeWidth={1.5} aria-hidden />
            Wochenreview abschließen
          </Button>
        ) : (
          <Button variant="primary" onClick={() => go(step + 1)}>
            Weiter
            <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        )}
        <Link href="/heute" className="text-ui-sm text-muted hover:text-fg hover:underline">
          Später weitermachen
        </Link>
      </div>
      {last ? (
        <p className="-mt-3 text-meta text-faint">
          {recap.closed_at
            ? "Der Rückblick ist schon abgeschlossen."
            : "Schließt auch den Wochenrückblick ab und hält die Zahlen fest. Antworten kannst du danach weiter ändern."}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Die fünf Schritte                                                   */
/* ------------------------------------------------------------------ */

function InboxStep({ data }: { data: ReturnType<typeof useTaskData> }) {
  const items = inboxItems(data.tasks);
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-ui text-muted" data-testid="review-inbox-empty">
        <CircleCheck size={16} strokeWidth={1.5} aria-hidden className="text-success" />
        Inbox ist leer – alles zugeordnet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ui-sm text-muted">
        {items.length === 1 ? "1 Eintrag" : `${items.length} Einträge`} – zuordnen, als Notiz
        anlegen, erledigen oder in den Papierkorb.
      </p>
      <ul aria-label="Inbox" className="-mx-2.5 flex flex-col gap-0.5">
        {items.map((task) => (
          <li key={task.id}>
            <InboxItem task={task} areas={data.ctx.areas} projects={data.ctx.projects} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectsStep({
  recap,
  review,
  data,
}: {
  recap: RecapRow;
  review: ReviewState;
  data: ReturnType<typeof useTaskData>;
}) {
  const now = useNow();
  const list = reviewProjects(data.ctx.projects, data.tasks, now);
  const seen = new Set(review.projects);
  const done = list.filter((p) => seen.has(p.project.id)).length;
  if (list.length === 0) {
    return <p className="text-ui text-muted">Keine aktiven Projekte.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ui-sm text-muted tabular-nums" data-testid="review-projects-progress">
        {done} von {list.length} durchgesehen · Festgefahrene und stille stehen oben.
      </p>
      <ul aria-label="Aktive Projekte" className="flex flex-col border-t border-border">
        {list.map((item) => (
          <ReviewProjectRow
            key={item.project.id}
            item={item}
            recapId={recap.id}
            reviewed={seen.has(item.project.id)}
            data={data}
          />
        ))}
      </ul>
    </div>
  );
}

function ReviewProjectRow({
  item,
  recapId,
  reviewed,
  data,
}: {
  item: ReviewProject;
  recapId: string;
  reviewed: boolean;
  data: ReturnType<typeof useTaskData>;
}) {
  const actions = useRecapActions();
  const projectActions = useProjectActions();
  const taskActions = useTaskActions();
  const peek = useTaskPeek();
  const { project, stuck, stale, next } = item;
  const title = projectTitle(project);
  const area = data.ctx.areas.find((a) => a.id === project.area_id);
  const progress = projectProgress(project.id, data.tasks);
  const candidates = data.tasks.filter(
    (t) => t.project_id === project.id && t.status !== "erledigt" && !t.deleted_at,
  );
  const checkboxId = `review-${project.id}`;
  const toggle = (checked: boolean) =>
    actions.review(recapId, (state) => ({
      ...state,
      projects: checked
        ? [...new Set([...state.projects, project.id])]
        : state.projects.filter((id) => id !== project.id),
    }));
  return (
    <li
      className="flex flex-col gap-2 border-b border-border py-3"
      data-review-project={project.id}
    >
      <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-3">
        <ProgressRing value={progress.ratio} color={area?.color} label={`Fortschritt ${title}`} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={appPath.project(project.id)}
            className={cn("truncate text-ui font-medium hover:underline", reviewed && "text-muted")}
          >
            {title}
          </Link>
          {stuck.length ? (
            <p className="flex items-center gap-1.5 text-meta text-warning">
              <AlertTriangle size={13} strokeWidth={1.5} aria-hidden className="shrink-0" />
              {stuckText(stuck)}
            </p>
          ) : null}
          {stale ? (
            <p className="flex items-center gap-1.5 text-meta text-warning">
              <Hourglass size={13} strokeWidth={1.5} aria-hidden className="shrink-0" />
              14 Tage still
            </p>
          ) : null}
          <p className="min-w-0 truncate text-meta text-faint">
            Nächster Schritt:{" "}
            {next ? (
              <Link
                href={peek.hrefFor(next.id)}
                scroll={false}
                className="text-muted hover:underline"
              >
                {taskTitle(next)}
              </Link>
            ) : (
              "fehlt"
            )}
          </p>
        </div>
        <label
          htmlFor={checkboxId}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-ui-sm text-muted md:min-h-8"
        >
          <Checkbox
            id={checkboxId}
            checked={reviewed}
            onCheckedChange={(value) => toggle(value === true)}
            aria-label={`„${title}“ durchgesehen`}
          />
          <span className="max-md:sr-only">durchgesehen</span>
        </label>
      </div>
      <div className="pl-[34px]">
        <TaskPicker
          variant="add"
          label={next ? "Nächsten Schritt ändern" : "Nächsten Schritt festlegen"}
          ariaLabel={`Nächsten Schritt für „${title}“ ${next ? "ändern" : "festlegen"}`}
          tasks={candidates}
          projects={data.ctx.projects}
          selectedIds={next ? [next.id] : []}
          onSelect={(taskId) => projectActions.update(project.id, { next_task_id: taskId })}
          onCreate={(text) => {
            const task = taskActions.create({
              title: text,
              project_id: project.id,
              area_id: project.area_id,
              in_inbox: false,
            });
            projectActions.update(project.id, { next_task_id: task.id });
          }}
        />
      </div>
    </li>
  );
}

/** Die nächste Woche mit denselben Bausteinen wie /kalender: eine Zeile des Monatsrasters. */
function DueStep({ week, today, tasks }: { week: Week; today: IsoDate; tasks: TaskRow[] }) {
  const router = useRouter();
  const range = useMemo(() => nextWeek(week), [week]);
  const calendar = useCalendarData(range, DEFAULT_FILTERS, today);
  const summary = calendarSummary(calendar.days, range);
  const overdue = tasks.filter(
    (t) =>
      !t.deleted_at && t.status !== "erledigt" && !t.in_inbox && t.due_date && t.due_date < today,
  ).length;
  const parts: SummaryPart[] = [
    { text: `${summary.events} ${summary.events === 1 ? "Termin" : "Termine"}` },
    { text: `${summary.tasks} ${summary.tasks === 1 ? "Aufgabe" : "Aufgaben"}` },
  ];
  if (summary.fullest) {
    parts.push({
      text: `${formatDayShort(summary.fullest.date)} ${summary.fullest.load.level === "ueberladen" ? "überladen" : "voll"}`,
      tone: summary.fullest.load.level === "ueberladen" ? "warning" : undefined,
    });
  }
  if (overdue) parts.push({ text: `${overdue} überfällig`, tone: "danger" });
  return (
    <CalendarProvider ctx={calendar.ctx} today={today} area={calendar.area} projectId={null}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ui font-medium">
            {weekLabel(range.start)} · {formatRange(range.start, range.end)}
          </p>
          <Link
            href={appPath.calendar(range.start, "woche")}
            className="inline-flex min-h-11 items-center gap-1 text-ui-sm text-muted hover:text-fg md:min-h-0"
          >
            Im Kalender öffnen
            <ArrowRight size={13} strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
        {calendar.loading ? (
          <Skeleton className="h-28 w-full rounded-card" />
        ) : (
          <>
            <SummaryLine parts={parts} data-testid="review-next-week" />
            <MonthView
              days={calendar.days}
              month=""
              onPickDay={(day) => router.push(appPath.calendar(day, "tag"))}
            />
          </>
        )}
        {calendar.eventsError ? (
          <p className="text-meta text-faint">{calendar.eventsError}</p>
        ) : null}
        <p className="text-meta text-faint">
          Zu voll? Aufgaben im Kalender verschieben – ziehen oder „⋯ › Verschieben auf …“.
          {overdue ? " Überfälliges steht auf Heute oben." : ""}
        </p>
      </div>
    </CalendarProvider>
  );
}

function RecapStep({ recap, stats }: { recap: RecapRow; stats: WeekStats | null }) {
  const questions = questionsOf(recap).filter((q) => q.key !== "focus_next");
  const parts: SummaryPart[] = [];
  if (stats) {
    parts.push({ text: `${stats.tasksDone} erledigt` });
    if (stats.milestonesDone)
      parts.push({
        text: stats.milestonesDone === 1 ? "1 Meilenstein" : `${stats.milestonesDone} Meilensteine`,
      });
    if (stats.focusDays.planned)
      parts.push({ text: `Fokus-Tage ${stats.focusDays.achieved} von ${stats.focusDays.planned}` });
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {parts.length ? <SummaryLine parts={parts} data-testid="review-week-stats" /> : <span />}
        <Link
          href={appPath.recap(recap.id)}
          className="inline-flex min-h-11 items-center gap-1 text-ui-sm text-muted hover:text-fg md:min-h-0"
        >
          Ganzer Rückblick mit Zahlen und Tagesverlauf
          <ArrowRight size={13} strokeWidth={1.5} aria-hidden />
        </Link>
      </div>
      <ReflectionFields recap={recap} questions={questions} />
    </div>
  );
}

function FocusStep({
  recap,
  week,
  data,
}: {
  recap: RecapRow;
  week: Week;
  data: ReturnType<typeof useTaskData>;
}) {
  const actions = useRecapActions();
  const now = useNow();
  const question =
    questionsOf(recap).find((q) => q.key === "focus_next") ??
    (DEFAULT_QUESTIONS.find((q) => q.key === "focus_next") as (typeof DEFAULT_QUESTIONS)[number]);
  const count = question.count ?? 3;
  const filled = recap.focus_next.filter((f) => f.trim()).length;
  const suggestions = focusSuggestions({
    projects: reviewProjects(data.ctx.projects, data.tasks, now),
    tasks: data.tasks,
    week: nextWeek(week),
    taken: recap.focus_next,
    formatDay: formatDayShort,
  });
  const take = (title: string) =>
    actions.answer(recap.id, question, (current) => {
      const list = Array.isArray(current) ? [...current] : [];
      while (list.length < count) list.push("");
      const free = list.findIndex((v) => !v.trim());
      if (free === -1) return list;
      list[free] = title;
      return list;
    });
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReflectionFields recap={recap} questions={[question]} themes={false} />
      {suggestions.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-meta uppercase tracking-widest text-faint">Vorschläge</p>
          <ul aria-label="Vorschläge für den Fokus" className="flex flex-col gap-0.5">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={filled >= count}
                  onClick={() => take(s.title)}
                  aria-label={`„${s.title}“ als Fokus übernehmen`}
                  className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-ui hover:bg-surface-2 disabled:opacity-50 md:min-h-9"
                >
                  <Plus size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
                  <span className="truncate">{s.title}</span>
                  <span className="ml-auto shrink-0 text-meta text-faint max-md:hidden">
                    {s.reason}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
