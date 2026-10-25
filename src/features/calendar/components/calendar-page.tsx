"use client";

/**
 * Kalender-Seite `/kalender` (S2b): Umschalter Tag | Woche | Monat | Liste, Zeitraum, Filter,
 * Einplanen-Spalte (Desktop rechts, Handy als Sheet), Tasten ←/→ T D/W/M/L. Adresse trägt
 * `?ansicht=` und `?tag=`, damit sich Ansichten verlinken lassen; Ansicht und Filter sind je
 * Gerät gemerkt. Der Monat scrollt durch (#85): die Seite hält ein Fenster aus Monaten um den
 * Monat der Adresse, verlängert es beim Scrollen und schreibt den Monat im Bild in die Adresse.
 */
import { ChevronLeft, ChevronRight, ListFilter, PanelRight, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { FoldButton, Rail } from "@/components/shell/wide";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  MenuCheckboxItem,
  MenuContent,
  MenuLabel,
  MenuRoot,
  MenuSelectAll,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryLine, type SummaryPart } from "@/components/ui/summary-line";
import { useNow } from "@/features/projects/components/project-database";
import { ProjectPicker } from "@/features/tasks/components/pickers";
import { useMediaQuery } from "@/features/tasks/peek";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinDate, formatDayShort, type IsoDate } from "@/lib/dates";
import { useLocalNumber } from "@/lib/local-pref";
import { useUi } from "@/lib/ui-store";
import { isArrowKeyTarget, isEditableTarget } from "@/lib/undo";
import { writableCalendars } from "../event-create";
import { useCalendarData, useCalendarPrefs } from "../hooks";
import {
  type CalendarView,
  calendarSummary,
  extendMonthWindow,
  inMonthWindow,
  type MonthWindow,
  monthOf,
  monthWindowAround,
  monthWindowRange,
  parseCalendarView,
  parseDateParam,
  periodMeta,
  periodTitle,
  stepDate,
  VIEW_LABELS,
  viewRange,
} from "../model";
import { buildPlan } from "../plan";
import { CalendarProvider, useCalendar } from "./calendar-context";
import { CalendarDnd } from "./calendar-dnd";
import { useFillHeight } from "./day-parts";
import { MonthScroll } from "./month-scroll";
import { PlanSidebar, usePlanFilters } from "./plan-sidebar";
import { AgendaView, DayView, WeekView } from "./views";

const VIEW_KEYS: Record<string, CalendarView> = { d: "tag", w: "woche", m: "monat", l: "liste" };

/**
 * Einplanen-Spalte rechts: bekommt wie das Wochenraster die Resthöhe des Fensters unter ihrem
 * oberen Rand (nicht 100dvh – sie beginnt erst unter dem Seitenkopf), damit bei vielen Aufgaben
 * ohne Datum die Liste in sich scrollt und nicht die Seite.
 */
/** Breite der Einplanen-Spalte (#61): ziehbar, je Gerät gemerkt. */
const PLAN_WIDTH = { initial: 320, min: 240, max: 560 };

function PlanAside({
  width,
  onWidth,
  onClose,
  children,
}: {
  width: number;
  onWidth: (value: number) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const height = useFillHeight(ref, { gap: 40 });
  return (
    <aside
      ref={ref}
      aria-label="Einplanen"
      style={{ maxHeight: height }}
      className="sticky top-[calc(var(--tabbar-h,0px)+1rem)] flex max-h-[calc(100dvh-var(--tabbar-h,0px)-2rem)] min-w-0 flex-col gap-2 border-l border-border pl-6"
    >
      <ResizeHandle
        label="Breite der Einplanen-Spalte"
        value={width}
        min={PLAN_WIDTH.min}
        max={PLAN_WIDTH.max}
        onChange={onWidth}
        onReset={() => onWidth(PLAN_WIDTH.initial)}
        edge="left"
      />
      <div className="flex items-center justify-between gap-2">
        <h2 className="heading text-body-lg/snug">Einplanen</h2>
        <FoldButton label="Einplanen" side="right" onClick={onClose} />
      </div>
      {children}
    </aside>
  );
}

/** „＋ Termin“ in der Kopfzeile: Fenster „Neuer Termin“, vorbelegt mit dem gewählten Tag (N1c). */
function NewEventButton({ date }: { date: IsoDate }) {
  const { calendars, openNewEvent } = useCalendar();
  if (calendars.length === 0) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => openNewEvent({ date })}
      aria-label="Termin anlegen"
      title="Termin in Google anlegen"
    >
      <Plus size={15} strokeWidth={1.5} aria-hidden />
      Termin
    </Button>
  );
}

export function CalendarPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlView = parseCalendarView(params.get("ansicht"));
  const urlDate = parseDateParam(params.get("tag"));
  const prefs = useCalendarPrefs(urlView);
  const view = urlView ?? prefs.view;
  const now = useNow(60_000);
  const [today, setToday] = useState<IsoDate | null>(null);
  useEffect(() => setToday(berlinDate(new Date(now))), [now]);
  const date = urlDate ?? today ?? "";
  // Monat (#85): Fenster um den Monat der Adresse; springt die Adresse hinaus, ein neues um sie
  const [storedWindow, setStoredWindow] = useState<MonthWindow | null>(null);
  const monthWindow = useMemo(() => {
    if (view !== "monat" || !date) return null;
    return storedWindow && inMonthWindow(storedWindow, date)
      ? storedWindow
      : monthWindowAround(date);
  }, [view, date, storedWindow]);
  useEffect(() => {
    if (monthWindow) setStoredWindow(monthWindow);
  }, [monthWindow]);
  const extendWindow = useCallback(
    (direction: -1 | 1) => setStoredWindow((w) => (w ? extendMonthWindow(w, direction) : w)),
    [],
  );
  // Zusammenfassung und „N weitere“ gelten dem Zeitraum im Bild, geladen wird im Monat das Fenster
  const range = useMemo(() => viewRange(view, date || "2000-01-01"), [view, date]);
  const dataRange = useMemo(
    () => (monthWindow ? monthWindowRange(monthWindow) : range),
    [monthWindow, range],
  );
  const data = useCalendarData(
    dataRange,
    prefs.filters,
    today ?? "",
    monthWindow ? monthOf(date) : null,
  );
  const wide = useMediaQuery("(min-width: 1024px)");
  const [planSheet, setPlanSheet] = useState(false);
  const [planWidth, setPlanWidth] = useLocalNumber(
    "sz:einplanen-breite",
    PLAN_WIDTH.initial,
    PLAN_WIDTH,
  );
  const setArea = useUi((s) => s.setArea);

  const navigate = useCallback(
    (next: { view?: CalendarView; date?: IsoDate | null }) => {
      const search = new URLSearchParams(params.toString());
      if (next.view) {
        prefs.setView(next.view);
        search.set("ansicht", next.view);
      }
      if (next.date !== undefined) {
        if (next.date && next.date !== today) search.set("tag", next.date);
        else search.delete("tag");
      }
      const query = search.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, prefs, router, today],
  );

  /**
   * Monat im Bild hat durchs Scrollen gewechselt: nur die Adresse nachziehen (ohne Navigation,
   * also ohne Abruf beim Server) – Überschrift, Zusammenfassung und Reiter folgen ihr. Zustand
   * `null`: Mit dem bisherigen (`history.state`) hielte Next den Aufruf für seinen eigenen und
   * gäbe die neue Adresse nicht an `useSearchParams` weiter.
   */
  const showMonth = useCallback(
    (month: IsoDate) => {
      const url = new URL(window.location.href);
      if (today && month === monthOf(today)) url.searchParams.delete("tag");
      else url.searchParams.set("tag", month);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    },
    [today],
  );

  // Tasten: ←/→ Zeitraum, T heute, D/W/M/L Ansicht – nie in Textfeldern oder mit Modifier
  useEffect(() => {
    if (!today) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      // Scroll-Bereiche und Umschalter behalten ihre Pfeiltasten (U-2)
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        isArrowKeyTarget(event.target)
      )
        return;
      const key = event.key.toLowerCase();
      if (event.key === "ArrowLeft") navigate({ date: stepDate(view, date, -1) });
      else if (event.key === "ArrowRight") navigate({ date: stepDate(view, date, 1) });
      else if (key === "t") navigate({ date: null });
      else if (VIEW_KEYS[key]) navigate({ view: VIEW_KEYS[key] });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [today, view, date, navigate]);

  const summary = useMemo(() => calendarSummary(data.days, range), [data.days, range]);
  const hidden = monthWindow
    ? data.hiddenDates.filter((d) => d >= range.start && d <= range.end).length
    : data.hiddenByArea;
  const parts: SummaryPart[] = [];
  if (!data.loading && today) {
    parts.push({ text: `${summary.events} ${summary.events === 1 ? "Termin" : "Termine"}` });
    parts.push({ text: `${summary.tasks} ${summary.tasks === 1 ? "Aufgabe" : "Aufgaben"}` });
    if (summary.overdue) parts.push({ text: `${summary.overdue} überfällig`, tone: "danger" });
    if (summary.fullest) {
      parts.push({
        text: `${summary.fullest.isToday ? "heute" : formatDayShort(summary.fullest.date)} ${summary.fullest.load.level === "ueberladen" ? "überladen" : "voll"}`,
        tone: summary.fullest.load.level === "ueberladen" ? "warning" : undefined,
      });
    }
  }
  const calendars = useMemo(() => writableCalendars(data.sources), [data.sources]);
  const failed = data.sources.filter((s) => s.error && !s.reconnect);
  const reconnect = data.sources.filter((s) => s.reconnect);
  const loading = !today || data.loading;
  const ready = today !== null;

  // min-h-0 flex-1 statt h-full: die Spalte hat nur eine Höchsthöhe (max-h), eine Prozenthöhe
  // wirkte darin wie auto – bei vielen Aufgaben ohne Datum wuchs sie über das Fenster hinaus
  const plan = ready ? (
    <PlanSidebar
      tasks={data.tasks}
      className="min-h-0 flex-1"
      onShowAllAreas={() => setArea(null)}
    />
  ) : null;
  const [planFilters] = usePlanFilters();
  // erst mit bekanntem heutigen Tag (wie die Spalte): addDays("") wirft „Invalid time value“
  const planCount = useMemo(
    () =>
      data.today
        ? buildPlan(data.tasks, {
            today: data.today,
            area: data.area,
            projectId: prefs.filters.projectId,
            query: "",
            filters: planFilters,
            projects: data.ctx.projects,
            milestones: data.ctx.milestones,
            areas: data.ctx.areas,
          }).open
        : 0,
    [data.tasks, data.today, data.area, data.ctx, prefs.filters.projectId, planFilters],
  );

  return (
    <CalendarProvider
      ctx={data.ctx}
      today={today ?? "2000-01-01"}
      area={data.area}
      projectId={prefs.filters.projectId}
      calendars={calendars}
    >
      <CalendarDnd>
        <Page className="gap-5">
          <PageHeader
            title={ready ? periodTitle(view, date) : "Kalender"}
            meta={ready ? periodMeta(view, date) : "Kalender"}
            summary={
              parts.length ? <SummaryLine parts={parts} data-testid="calendar-summary" /> : null
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Zurück"
                    title="Zurück (←)"
                    onClick={() => navigate({ date: stepDate(view, date, -1) })}
                    disabled={!ready}
                  >
                    <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate({ date: null })}
                    disabled={!ready || date === today}
                    title="Heute (T)"
                  >
                    Heute
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Weiter"
                    title="Weiter (→)"
                    onClick={() => navigate({ date: stepDate(view, date, 1) })}
                    disabled={!ready}
                  >
                    <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
                  </Button>
                </div>
                {ready ? <NewEventButton date={date as IsoDate} /> : null}
                <SegmentedControl
                  aria-label="Ansicht"
                  value={view}
                  onValueChange={(next) => navigate({ view: next })}
                  options={(["tag", "woche", "monat", "liste"] as CalendarView[]).map((v) => ({
                    value: v,
                    label: VIEW_LABELS[v],
                  }))}
                  className="max-md:w-full"
                />
                <MenuRoot modal={false}>
                  <MenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label="Filter">
                      <ListFilter size={15} strokeWidth={1.5} aria-hidden />
                      <span className="max-md:sr-only">Filter</span>
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end" aria-label="Filter">
                    <MenuLabel>Anzeigen</MenuLabel>
                    <MenuSelectAll
                      all={prefs.filters.events && prefs.filters.tasks && prefs.filters.done}
                      none={!prefs.filters.events && !prefs.filters.tasks && !prefs.filters.done}
                      onAll={() => prefs.setFilters({ events: true, tasks: true, done: true })}
                      onNone={() => prefs.setFilters({ events: false, tasks: false, done: false })}
                    />
                    <MenuCheckboxItem
                      checked={prefs.filters.events}
                      onCheckedChange={(v) => prefs.setFilters({ events: v === true })}
                      onSelect={(e) => e.preventDefault()}
                    >
                      Termine
                    </MenuCheckboxItem>
                    <MenuCheckboxItem
                      checked={prefs.filters.tasks}
                      onCheckedChange={(v) => prefs.setFilters({ tasks: v === true })}
                      onSelect={(e) => e.preventDefault()}
                    >
                      Aufgaben
                    </MenuCheckboxItem>
                    <MenuCheckboxItem
                      checked={prefs.filters.done}
                      onCheckedChange={(v) => prefs.setFilters({ done: v === true })}
                      onSelect={(e) => e.preventDefault()}
                    >
                      Erledigte
                    </MenuCheckboxItem>
                    <MenuSeparator />
                    <MenuLabel>Tasten</MenuLabel>
                    <p className="flex flex-wrap items-center gap-1.5 px-2 pb-2 text-meta text-faint">
                      <Kbd>←</Kbd>
                      <Kbd>→</Kbd> Zeitraum · <Kbd>T</Kbd> heute · <Kbd>D</Kbd>
                      <Kbd>W</Kbd>
                      <Kbd>M</Kbd>
                      <Kbd>L</Kbd> Ansicht
                    </p>
                  </MenuContent>
                </MenuRoot>
                <ProjectPicker
                  value={prefs.filters.projectId}
                  projects={data.ctx.projects}
                  areas={data.ctx.areas}
                  variant="button"
                  label={prefs.filters.projectId ? undefined : "Projekt"}
                  onSelect={(id) => prefs.setFilters({ projectId: id })}
                />
                {wide ? (
                  <Button
                    variant={prefs.planOpen ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={prefs.planOpen}
                    onClick={() => prefs.setPlanOpen(!prefs.planOpen)}
                  >
                    <PanelRight size={15} strokeWidth={1.5} aria-hidden />
                    Einplanen
                  </Button>
                ) : (
                  <Sheet
                    open={planSheet}
                    onOpenChange={setPlanSheet}
                    side="bottom"
                    title="Einplanen"
                    description="Aufgaben ohne Datum – über ⋯ auf einen Tag verschieben"
                    trigger={
                      <Button variant="ghost" size="sm">
                        <PanelRight size={15} strokeWidth={1.5} aria-hidden />
                        Einplanen
                      </Button>
                    }
                  >
                    <div className="max-h-[65dvh] overflow-y-auto">{plan}</div>
                  </Sheet>
                )}
              </div>
            }
          />

          {data.error ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-card border border-danger/50 p-4 text-ui"
            >
              <p className="text-danger">
                Der Kalender konnte nicht geladen werden. Verbindung prüfen.
              </p>
              <Button size="sm" onClick={data.retry}>
                Erneut laden
              </Button>
            </div>
          ) : loading ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <span className="sr-only">Kalender wird geladen</span>
              <Skeleton className="h-10 rounded-card" />
              <Skeleton className="h-96 rounded-card" />
            </div>
          ) : (
            <div
              className={cn(
                "grid grid-cols-1 items-start gap-8",
                wide && prefs.planOpen && "lg:grid-cols-[minmax(0,1fr)_var(--plan-w)]",
                wide && !prefs.planOpen && "lg:grid-cols-[minmax(0,1fr)_2.5rem] lg:gap-4",
              )}
              style={{ "--plan-w": `${planWidth}px` } as React.CSSProperties}
            >
              <div className="flex min-w-0 flex-col gap-3">
                {data.eventsError || failed.length ? (
                  <p role="status" className="text-ui-sm text-warning">
                    {data.eventsError ??
                      `${failed.map((s) => `Kalender „${s.name}“`).join(", ")} ließ sich nicht laden – Aufgaben sind vollständig.`}
                  </p>
                ) : null}
                {reconnect.length ? (
                  <p
                    role="status"
                    data-testid="google-reconnect"
                    className="text-ui-sm text-warning"
                  >
                    Google neu verbinden – Termine lassen sich so lange nicht verschieben
                    {reconnect.length === 1 ? "" : " (mehrere Kalender)"}; falls eine iCal-Adresse
                    da ist, stehen sie nur lesbar darüber.{" "}
                    <Link
                      href={appPath.settings("kalender")}
                      className="text-link underline underline-offset-2"
                    >
                      Neu verbinden
                    </Link>
                  </p>
                ) : null}
                {view === "woche" ? <WeekView days={data.days} /> : null}
                {view === "monat" ? (
                  <MonthScroll
                    days={data.days}
                    month={monthOf(date)}
                    onMonth={showMonth}
                    onExtend={extendWindow}
                    onPickDay={(day) => navigate({ view: "tag", date: day })}
                  />
                ) : null}
                {view === "tag" && data.days[0] ? <DayView day={data.days[0]} /> : null}
                {view === "liste" ? <AgendaView days={data.days} /> : null}
                {hidden > 0 ? (
                  <p className="px-1.5 text-ui-sm text-faint">
                    {hidden === 1 ? "1 weitere Aufgabe" : `${hidden} weitere Aufgaben`} in anderen
                    Bereichen oder der Inbox.{" "}
                    <button
                      type="button"
                      onClick={() => setArea(null)}
                      className="text-muted underline underline-offset-2 hover:text-fg"
                    >
                      Alle Bereiche zeigen
                    </button>
                  </p>
                ) : null}
              </div>
              {wide && prefs.planOpen ? (
                <PlanAside
                  width={planWidth}
                  onWidth={setPlanWidth}
                  onClose={() => prefs.setPlanOpen(false)}
                >
                  {plan}
                </PlanAside>
              ) : null}
              {wide && !prefs.planOpen ? (
                <Rail
                  label="Einplanen"
                  icon={PanelRight}
                  side="right"
                  count={planCount}
                  onClick={() => prefs.setPlanOpen(true)}
                  hint={`Einplanen aufklappen – ${planCount} ${planCount === 1 ? "Aufgabe" : "Aufgaben"}`}
                  className="flex"
                />
              ) : null}
            </div>
          )}
        </Page>
      </CalendarDnd>
    </CalendarProvider>
  );
}
