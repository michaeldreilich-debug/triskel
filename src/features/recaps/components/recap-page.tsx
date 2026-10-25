"use client";

import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CircleCheck,
  Clock,
  Download,
  History,
  Hourglass,
  MoreHorizontal,
  PenLine,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Page } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { SectionHeader, SegmentMeter } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryLine, type SummaryPart } from "@/components/ui/summary-line";
import { useAreas } from "@/features/areas/api";
import { exportAge } from "@/features/export/zip";
import { useNotes } from "@/features/notes/api";
import { useProjects } from "@/features/projects/api";
import { useUserSettings } from "@/features/settings/api";
import { useTasks } from "@/features/tasks/api";
import { isForMe } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { useRefreshOnReturn } from "@/lib/data/fresh";
import { berlinDate, berlinTime, formatDayShort, formatMonth, formatRange } from "@/lib/dates";
import { useLocalNumber } from "@/lib/local-pref";
import { recapsKey, useRecapActions, useRecaps, useWeekStats } from "../api";
import {
  activityEntries,
  aggregateValue,
  answerOf,
  daySummary,
  findRecap,
  formatValue,
  isAnswered,
  monthWeeks,
  onThisDay,
  parsePeriodSlug,
  questionsOf,
  recapRange,
  themeCounts,
  VALUE_KEYS,
  VALUE_LABELS,
  weekActivity,
  weekLabel,
} from "../model";
import type { RecapRow, WeekStats } from "../types";
import { DayTimeline } from "./day-timeline";
import { OnThisDayList } from "./on-this-day";
import { useRecapQuestions } from "./recap-questions";
import { ReflectionFields } from "./reflection-fields";

/** Abschnitt der Rückblick-Seite: „card“ = die eine gefüllte Karte (Reflexion), sonst offen. */
function Block({
  title,
  icon,
  sub,
  meta,
  card,
  children,
}: {
  title: string;
  icon: typeof History;
  sub?: React.ReactNode;
  meta?: React.ReactNode;
  card?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col gap-4",
        card && "rounded-card border border-border bg-surface p-4 md:p-6",
      )}
    >
      <SectionHeader icon={icon} title={title} sub={sub} meta={meta} />
      {children}
    </section>
  );
}

/**
 * Wochen- oder Monatsrückblick (B12, S1a): Reflexion nach Leitfragen, Zahlen, Tagesverlauf bzw.
 * die Wochen des Monats, „An diesem Tag“. Statt einer ID geht auch ein Zeitraum
 * („monat-2026-10“, „woche-2026-10-12“ – Links aus Kalender und Heute): vorhanden → der Rückblick,
 * sonst „schreiben“.
 */
export function RecapPage({ recapId }: { recapId: string }) {
  const recaps = useRecaps();
  // zurück am Fenster: Rückblick frisch laden (KI-Gesprächsfelder, iPhone), V-2
  useRefreshOnReturn(recapsKey, () => false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const period = parsePeriodSlug(recapId);
  const recap = period
    ? findRecap(recaps.data ?? [], period.kind, period.start)
    : recaps.data?.find((r) => r.id === recapId);

  if (recaps.isPending || !mounted) {
    return (
      <Page>
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">Rückblick wird geladen</span>
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-72 w-full rounded-card" />
        </div>
      </Page>
    );
  }
  if (!recap && period) return <PeriodStart period={period} />;
  if (!recap) {
    return (
      <Page>
        <EmptyState
          icon={<History strokeWidth={1.5} />}
          title="Rückblick nicht gefunden"
          description="Vielleicht liegt er im Papierkorb."
          action={
            <Link
              href={appPath.recaps()}
              className="text-ui text-muted hover:text-fg hover:underline"
            >
              Zu den Rückblicken
            </Link>
          }
        />
      </Page>
    );
  }
  return <RecapView recap={recap} all={recaps.data ?? []} />;
}

/** Zeitraum ohne Rückblick (Link aus Kalender oder Heute): einmal tippen, dann schreiben. */
function PeriodStart({
  period,
}: {
  period: { kind: RecapRow["kind"]; start: string; end: string };
}) {
  const router = useRouter();
  const actions = useRecapActions();
  const questions = useRecapQuestions();
  const month = period.kind === "monat";
  const label = month ? formatMonth(period.start) : weekLabel(period.start);
  const kindLabel = month ? "Monatsrückblick" : "Wochenrückblick";
  return (
    <Page>
      <Link
        href={appPath.recaps()}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-ui-sm text-faint hover:text-fg md:min-h-0"
      >
        <ArrowLeft size={14} strokeWidth={1.5} aria-hidden />
        Rückblicke
      </Link>
      <EmptyState
        icon={<PenLine strokeWidth={1.5} />}
        title={`${kindLabel} ${label}`}
        description={`${formatRange(period.start, period.end)} · noch nicht geschrieben.`}
        action={
          <Button
            variant="primary"
            onClick={() => {
              const recap = actions.create(period.kind, period.start, period.end, questions);
              router.replace(appPath.recap(recap.id));
            }}
          >
            {kindLabel} schreiben
          </Button>
        }
      />
    </Page>
  );
}

/** Breite der rechten Spalte (Zahlen, Tage, Projekte), am linken Rand ziehbar (#95). */
const SIDE_WIDTH = { initial: 380, min: 280, max: 640 };

function RecapView({ recap, all }: { recap: RecapRow; all: RecapRow[] }) {
  const router = useRouter();
  const actions = useRecapActions();
  const [sideWidth, setSideWidth] = useLocalNumber(
    "sz:rueckblick-rechts-breite",
    SIDE_WIDTH.initial,
    SIDE_WIDTH,
  );
  const today = berlinDate();
  const closed = recap.closed_at !== null;
  // abgeschlossen: Snapshot (stabil); offen: live
  const live = useWeekStats(recap.period_start, recap.period_end, !closed || !recap.stats);
  const stats: WeekStats | null = closed && recap.stats ? recap.stats : (live.data ?? null);
  const questions = questionsOf(recap);
  const answered = questions.filter((q) => isAnswered(recap, q)).length;
  const running = recap.period_end >= today;
  const month = recap.kind === "monat";

  const summary: SummaryPart[] = [];
  if (stats) {
    summary.push({ text: `${stats.tasksDone} erledigt` });
    if (stats.milestonesDone) {
      summary.push({
        text: stats.milestonesDone === 1 ? "1 Meilenstein" : `${stats.milestonesDone} Meilensteine`,
      });
    }
    if (stats.focusDays.planned) {
      summary.push({
        text: `Fokus-Tage ${stats.focusDays.achieved} von ${stats.focusDays.planned}`,
      });
    }
    if (stats.stuckProjects.length) {
      summary.push({ text: `${stats.stuckProjects.length} festgefahren`, tone: "warning" });
    }
  }
  summary.push({
    text: closed
      ? `abgeschlossen ${formatDayShort(berlinDate(recap.closed_at as string))}`
      : running
        ? month
          ? "Monat läuft noch"
          : "Woche läuft noch"
        : "noch offen",
  });

  return (
    <Page>
      <div className="flex items-center justify-between gap-3">
        <Link
          href={appPath.recaps()}
          className="inline-flex min-h-11 items-center gap-1.5 text-ui-sm text-faint hover:text-fg md:min-h-0"
        >
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden />
          Rückblicke
        </Link>
        <MenuRoot>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Rückblick-Aktionen">
              <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              variant="danger"
              onSelect={() => actions.trash(recap.id, () => router.push(appPath.recaps()))}
            >
              <Trash2 aria-hidden />
              In den Papierkorb
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </div>

      <header className="-mt-4 flex flex-col gap-1.5">
        <p className="text-ui-sm text-faint">
          {month
            ? `Monatsrückblick · ${recapRange(recap)}`
            : `Wochenrückblick · ${weekLabel(recap.period_start)}`}
        </p>
        <h1 className="heading text-title-sm tracking-tight md:text-title-lg">
          {month ? formatMonth(recap.period_start) : recapRange(recap)}
        </h1>
        <SummaryLine parts={summary} data-testid="recap-summary" />
      </header>

      <div
        className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_var(--rueckblick-rechts-w)]"
        style={{ "--rueckblick-rechts-w": `${sideWidth}px` } as React.CSSProperties}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <Block
            title="Reflexion"
            icon={PenLine}
            card
            sub="Leitfragen der Vorlage"
            meta={`${answered} von ${questions.length}`}
          >
            <ReflectionFields recap={recap} questions={questions} />
          </Block>
          <CloseRow recap={recap} stats={stats} running={running} />
        </div>

        <div className="relative flex min-w-0 flex-col gap-8 lg:border-l lg:border-border lg:pl-8">
          <ResizeHandle
            label="Breite der rechten Spalte"
            edge="left"
            value={sideWidth}
            min={SIDE_WIDTH.min}
            max={SIDE_WIDTH.max}
            onChange={setSideWidth}
            onReset={() => setSideWidth(SIDE_WIDTH.initial)}
            className="hidden lg:block"
          />
          <StatsBlock
            stats={stats}
            loading={!stats && live.isPending}
            closed={closed}
            month={month}
          />
          {month ? (
            <MonthWeeks recap={recap} all={all} stats={stats} today={today} />
          ) : (
            <WeekActivity stats={stats} today={today} />
          )}
          <RecapOnThisDay recap={recap} all={all} />
        </div>
      </div>
    </Page>
  );
}

/** Abschließen → Snapshot; danach der wöchentliche Export-Hinweis (Obsidian-Vault zum Mitnehmen). */
function CloseRow({
  recap,
  stats,
  running,
}: {
  recap: RecapRow;
  stats: WeekStats | null;
  running: boolean;
}) {
  const actions = useRecapActions();
  const settings = useUserSettings();
  const lastExport = exportAge(settings.data?.last_export_at);
  if (recap.closed_at) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-ui text-muted" data-testid="recap-closed">
          <CircleCheck size={16} strokeWidth={1.5} aria-hidden className="text-success" />
          Abgeschlossen am {formatDayShort(berlinDate(recap.closed_at))},{" "}
          {berlinTime(recap.closed_at)} · Zahlen festgehalten
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border p-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-ui font-medium">Export erstellt?</p>
            <p className="text-ui-sm text-muted" data-testid="recap-last-export">
              {lastExport.days === null
                ? "Noch kein Export."
                : `Letzter Export ${lastExport.label}.${lastExport.days >= 7 ? " Zeit für einen neuen." : ""}`}
            </p>
          </div>
          <Link href={appPath.settings("export")} className="inline-flex">
            <span className="inline-flex h-11 items-center gap-2 rounded-control border border-border bg-surface px-4 text-ui font-medium hover:bg-surface-2 md:h-9">
              <Download size={16} strokeWidth={1.5} aria-hidden />
              Zum Export
            </span>
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="primary" onClick={() => actions.close(recap.id, stats)}>
        <CircleCheck size={16} strokeWidth={1.5} aria-hidden />
        Rückblick abschließen
      </Button>
      <p className="text-meta text-faint">
        Hält die Zahlen fest. Deine Antworten kannst du danach weiter ändern.
        {running
          ? ` ${recap.kind === "monat" ? "Der Monat" : "Die Woche"} läuft noch – gezählt wird bis jetzt.`
          : ""}
      </p>
    </div>
  );
}

function StatsBlock({
  stats,
  loading,
  closed,
  month = false,
}: {
  stats: WeekStats | null;
  loading: boolean;
  closed: boolean;
  month?: boolean;
}) {
  const areas = useAreas();
  return (
    <Block
      title="Zahlen"
      icon={BarChart3}
      sub={
        closed
          ? "Festgehalten beim Abschließen"
          : month
            ? "Automatisch aus dem Monat"
            : "Automatisch aus der Woche"
      }
    >
      {loading ? (
        <Skeleton className="h-32 w-full rounded-card" />
      ) : !stats ? (
        <p className="text-ui-sm text-faint">Zahlen gerade nicht erreichbar.</p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 text-ui">
          <dt className="text-muted">Erledigt</dt>
          <dd className="text-right font-medium tabular-nums">{stats.tasksDone}</dd>
          {stats.byArea.length > 0 ? (
            <dd className="col-span-2 -mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-meta text-faint">
              {stats.byArea.map((a) => {
                const area = areas.data?.find((x) => x.id === a.area_id);
                return (
                  <span key={a.area_id ?? "inbox"} className="inline-flex items-center gap-1.5">
                    {area ? <AreaDot color={area.color} /> : null}
                    {a.name ?? "Inbox"} {a.count}
                  </span>
                );
              })}
            </dd>
          ) : null}
          <dt className="text-muted">Meilensteine erreicht</dt>
          <dd className="text-right font-medium tabular-nums">{stats.milestonesDone}</dd>
          <dt className="text-muted">Fokus-Tage (alle 3 erledigt)</dt>
          <dd className="flex items-center justify-end gap-2 font-medium tabular-nums">
            {stats.focusDays.planned > 0 ? (
              <SegmentMeter value={stats.focusDays.achieved} total={stats.focusDays.planned} />
            ) : null}
            {stats.focusDays.achieved} von {stats.focusDays.planned}
          </dd>
          {stats.notesCreated !== null ? (
            <>
              <dt className="text-muted">Neue Notizen</dt>
              <dd className="text-right font-medium tabular-nums">{stats.notesCreated}</dd>
            </>
          ) : null}
          <ProjectList label="Festgefahren" icon={AlertTriangle} projects={stats.stuckProjects} />
          <ProjectList label="14 Tage still" icon={Hourglass} projects={stats.staleProjects} />
        </dl>
      )}
    </Block>
  );
}

function ProjectList({
  label,
  icon: Icon,
  projects,
}: {
  label: string;
  icon: typeof AlertTriangle;
  projects: { id: string; title: string }[];
}) {
  if (projects.length === 0) return null;
  return (
    <>
      <dt className="col-span-2 mt-2 flex items-center gap-1.5 text-ui-sm text-warning">
        <Icon size={14} strokeWidth={1.5} aria-hidden />
        {label}
      </dt>
      <dd className="col-span-2 -mt-1 flex flex-col">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={appPath.project(p.id)}
            className="flex min-h-11 items-center truncate text-ui text-muted hover:text-fg hover:underline md:min-h-8"
          >
            {p.title.trim() || "Ohne Titel"}
          </Link>
        ))}
      </dd>
    </>
  );
}

/** Tagesverlauf je Tag (E24): Kurzfassung, aufklappbar zur Zeitleiste. */
function WeekActivity({ stats, today }: { stats: WeekStats | null; today: string }) {
  const days = stats?.activity ?? null;
  return (
    <Block title="Tagesverlauf" icon={Clock} sub="Was an welchem Tag passiert ist">
      {!days ? (
        <p className="text-ui-sm text-faint">
          {stats ? "Für diesen Rückblick nicht festgehalten." : "Wird geladen …"}
        </p>
      ) : (
        <ul aria-label="Tagesverlauf der Woche" className="flex flex-col">
          {days.map((day) => {
            const entries = activityEntries(day);
            const text = daySummary(day);
            const future = day.date > today;
            return (
              <li key={day.date} className="border-b border-border last:border-b-0">
                {entries.length === 0 ? (
                  <p className="flex min-h-11 items-center gap-3 text-ui-sm md:min-h-9">
                    <span className="w-16 shrink-0 text-faint tabular-nums">
                      {formatDayShort(day.date)}
                    </span>
                    <span className="text-faint">{future ? "–" : "nichts erfasst"}</span>
                  </p>
                ) : (
                  <details className="group" open={day.date === today}>
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 text-ui-sm md:min-h-9 [&::-webkit-details-marker]:hidden">
                      <span className="w-16 shrink-0 font-medium tabular-nums">
                        {formatDayShort(day.date)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted">{text}</span>
                      <span
                        aria-hidden
                        className="text-faint transition-transform group-open:rotate-90"
                      >
                        ›
                      </span>
                    </summary>
                    <DayTimeline
                      entries={entries}
                      label={`Verlauf ${formatDayShort(day.date)}`}
                      className="pb-2"
                    />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}

/**
 * Monatsrückblick (S1a): die Wochen des Monats mit ihren Rückblicken – Werte, Reflexion zum
 * Aufklappen, Lücken mit „Nachholen“ – darüber Durchschnitt der Werte und wiederkehrende Themen.
 */
function MonthWeeks({
  recap,
  all,
  stats,
  today,
}: {
  recap: RecapRow;
  all: RecapRow[];
  stats: WeekStats | null;
  today: string;
}) {
  const weeks = monthWeeks(recap.period_start, all);
  const written = weeks.map((w) => w.recap).filter((r): r is RecapRow => r !== null);
  const values = VALUE_KEYS.map((key) => ({ key, value: aggregateValue(written, key) })).filter(
    (v) => v.value !== null,
  );
  const themes = themeCounts(written).filter((t) => t.count > 1);
  const due = weeks.filter((w) => !w.recap && w.end < today).length;
  return (
    <Block
      title="Wochen des Monats"
      icon={History}
      sub={`${written.length} von ${weeks.length} Wochen mit Rückblick${due ? ` · ${due === 1 ? "1 Lücke" : `${due} Lücken`}` : ""}`}
    >
      {values.length > 0 ? (
        <p className="text-ui-sm text-muted tabular-nums" data-testid="month-week-values">
          {values
            .map(
              (v) =>
                `${v.key === "sport" ? "Sport" : `Ø ${VALUE_LABELS[v.key]}`} ${formatValue(v.value as number)}`,
            )
            .join(" · ")}
        </p>
      ) : null}
      {themes.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Wiederkehrende Themen">
          {themes.map((t) => (
            <li
              key={t.theme}
              className="inline-flex h-6 items-center rounded-full border border-border-strong px-2.5 text-meta text-muted"
            >
              #{t.theme} · {t.count}×
            </li>
          ))}
        </ul>
      ) : null}
      <ul aria-label="Wochen des Monats" className="flex flex-col">
        {weeks.map((week) => (
          <MonthWeekRow key={week.start} week={week} stats={stats} today={today} />
        ))}
      </ul>
    </Block>
  );
}

function MonthWeekRow({
  week,
  stats,
  today,
}: {
  week: ReturnType<typeof monthWeeks>[number];
  stats: WeekStats | null;
  today: string;
}) {
  const router = useRouter();
  const actions = useRecapActions();
  const questions = useRecapQuestions();
  const activity = weekActivity(stats?.activity ?? null, week);
  // ohne Jahr (steht im Kopf des Monats), damit die Zeile auch am Handy nicht abschneidet
  const range = formatRange(week.start, week.end).replace(/\d{4}$/, "");
  const head = (
    <>
      <span className="w-14 shrink-0 font-medium tabular-nums">KW {week.week}</span>
      <span className="min-w-0 flex-1 truncate text-faint tabular-nums">
        {range}
        {stats ? ` · ${activity.done} erledigt` : ""}
      </span>
    </>
  );
  const recap = week.recap;
  if (!recap) {
    const future = week.start > today;
    return (
      <li className="flex min-h-11 items-center gap-3 border-b border-border text-ui-sm last:border-b-0 md:min-h-9">
        {head}
        {future ? (
          <span className="text-faint">–</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`KW ${week.week} ${week.end < today ? "nachholen" : "schreiben"}`}
            onClick={() => {
              const created = actions.createWeek(week.start, week.end, questions);
              router.push(appPath.recap(created.id));
            }}
          >
            {week.end < today ? "Nachholen" : "Schreiben"}
          </Button>
        )}
      </li>
    );
  }
  const values = [
    recap.mood !== null ? `Stimmung ${recap.mood}` : null,
    recap.energy !== null ? `Energie ${recap.energy}` : null,
  ].filter(Boolean);
  const texts = questionsOf(recap)
    .filter((q) => q.type === "text" || q.type === "list")
    .map((q) => ({ question: q, value: answerOf(recap, q) }))
    .filter(({ value }) =>
      Array.isArray(value)
        ? value.some((v) => v.trim())
        : typeof value === "string" && value.trim(),
    );
  return (
    <li className="border-b border-border last:border-b-0">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 text-ui-sm md:min-h-9 [&::-webkit-details-marker]:hidden">
          {head}
          <span className="shrink-0 text-meta text-muted tabular-nums">
            {values.length ? values.join(" · ") : recap.closed_at ? "abgeschlossen" : "offen"}
          </span>
          <span aria-hidden className="text-faint transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="flex flex-col gap-3 pb-3 pl-[68px] max-md:pl-0">
          {texts.length === 0 ? (
            <p className="text-ui-sm text-faint">Noch keine Antworten.</p>
          ) : (
            <dl className="flex flex-col gap-2">
              {texts.map(({ question, value }) => (
                <div key={question.key} className="flex flex-col gap-0.5">
                  <dt className="text-meta text-faint">{question.label}</dt>
                  <dd className="whitespace-pre-line text-ui-sm text-muted">
                    {Array.isArray(value)
                      ? value
                          .filter((v) => v.trim())
                          .map((v, i) => `${i + 1}. ${v.trim()}`)
                          .join("\n")
                      : value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <Link
            href={appPath.recap(recap.id)}
            className="self-start text-ui-sm text-link hover:underline"
          >
            Wochenrückblick KW {week.week} öffnen
          </Link>
        </div>
      </details>
    </li>
  );
}

function RecapOnThisDay({ recap, all }: { recap: RecapRow; all: RecapRow[] }) {
  const notes = useNotes();
  const projects = useProjects();
  const tasks = useTasks();
  const groups = onThisDay(
    { start: recap.period_start, end: recap.period_end },
    { notes: notes.data, projects: projects.data, recaps: all, tasks: tasks.data?.filter(isForMe) },
    recap.id,
  );
  if (groups.length === 0) return null;
  return (
    <Block title="An diesem Tag" icon={CalendarClock} sub="Was vor 1, 3 und 12 Monaten entstand">
      <OnThisDayList groups={groups} label="An diesem Tag" />
    </Block>
  );
}
