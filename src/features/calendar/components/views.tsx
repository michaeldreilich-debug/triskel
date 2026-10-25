"use client";

/**
 * Die vier Ansichten (S2b): Woche (Spalten mit Zeitraster; am Handy Tagesliste), Monat (Raster,
 * am Handy kompakt mit Punkten und Tagesliste darunter), Tag (großes Raster + Nebenspalte),
 * Liste (nächste 14 Tage). Alle aus denselben Bausteinen (`day-parts.tsx`).
 */
import { ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useMediaQuery } from "@/features/tasks/peek";
import { cn } from "@/lib/cn";
import { formatDayShort, formatMonth, type IsoDate } from "@/lib/dates";
import { useLocalNumber } from "@/lib/local-pref";
import { formatMinutes, visibleHours, WEEK_TASK_BAND, weekTaskLimit } from "../layout";
import { type CalendarDay, MONTHS_SHORT } from "../model";
import { useCalendar } from "./calendar-context";
import { DropZone } from "./calendar-dnd";
import { CALENDAR_BG } from "./calendar-dot";
import { CalendarChip } from "./chips";
import {
  AddTaskRow,
  AllDayList,
  DayHeader,
  DayList,
  dayNumber,
  LoadBar,
  TaskList,
  TimeGrid,
  useFillHeight,
  useNowMinutes,
  weekdayLabel,
} from "./day-parts";

const allTimed = (days: CalendarDay[]) => days.flatMap((d) => d.timed);

/* ------------------------------------------------------------------ */
/* Woche                                                              */
/* ------------------------------------------------------------------ */

export function WeekView({ days }: { days: CalendarDay[] }) {
  const wide = useMediaQuery("(min-width: 768px)");
  if (!wide) return <StackedDays days={days} />;
  return <WeekColumns days={days} />;
}

const WEEK_HOUR_HEIGHT = 40;

/**
 * Aufgaben je Tag im Band über dem Raster (#97): wächst mit der Fensterhöhe, mindestens 3; der
 * Rest steht hinter „N weitere“. Zeilenhöhe in rem (Schriftgröße je Gerät): kompakte Zeile 1,5 rem
 * plus 1 px Abstand.
 */
function useWeekTaskLimit() {
  const [limit, setLimit] = useState(WEEK_TASK_BAND.min);
  useEffect(() => {
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setLimit(weekTaskLimit(window.innerHeight, 1.5 * rem + 1));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return limit;
}

/**
 * Breite der Bildlaufleiste eines Elements (`scroll-quiet` hält ihr mit `scrollbar-gutter: stable`
 * immer Platz frei). Kopf und Band über dem Raster rücken um genau so viel ein, sonst stünden die
 * Tagesspalten bei klassischen Bildlaufleisten (Maus, Windows) versetzt unter ihrem Kopf (M3-5).
 * Mit eingeblendeten Leisten (Trackpad am Mac) ist sie 0.
 */
export function useScrollbarWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.offsetWidth - element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Woche am Desktop: Kopf → ganztägig + Fristen → **Aufgaben ohne Uhrzeit als Band** (Überfälliges
 * zuerst, je nach Fensterhöhe mindestens 3 je Tag) → Zeitraster, das in sich scrollt und die Resthöhe
 * des Fensters bekommt. So ist die ganze Woche samt Aufgaben auch bei 1440×800 ohne
 * Seiten-Scrollen erfassbar; das Raster beginnt um 07:00 (früher bei früheren Terminen).
 */
function WeekColumns({ days }: { days: CalendarDay[] }) {
  const nowMinutes = useNowMinutes();
  const hours = visibleHours(allTimed(days));
  const grid = useRef<HTMLElement>(null);
  // 40 px = unterer Seitenrand (md:py-8) plus etwas Luft, damit die Seite selbst nicht scrollt;
  // mindestens 5 Stunden sichtbar, erst darunter darf die Seite scrollen
  const height = useFillHeight(grid, { gap: 40, min: 5 * WEEK_HOUR_HEIGHT });
  const gutter = useScrollbarWidth(grid);
  const taskLimit = useWeekTaskLimit();
  // beim Einhängen: Jetzt-Linie ins Bild holen, wenn sie unter dem sichtbaren Teil läge
  const scrolled = useRef(false);
  useEffect(() => {
    const element = grid.current;
    if (scrolled.current || !element || height === undefined || nowMinutes === null) return;
    if (!days.some((d) => d.isToday)) return;
    scrolled.current = true;
    const y = ((nowMinutes - hours.from * 60) / 60) * WEEK_HOUR_HEIGHT;
    element.scrollTop = Math.max(0, y - height * 0.6);
  }, [height, nowMinutes, days, hours.from]);
  return (
    <div className="flex flex-col" data-calendar-view="woche">
      {/* Kopf und ganztägig + Fristen */}
      <div
        className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] border-b border-border pb-2"
        style={{ paddingRight: gutter }}
      >
        <div />
        {days.map((day) => (
          <div key={day.date} className="min-w-0 border-l border-border px-1.5">
            <DayHeader day={day} />
          </div>
        ))}
        <div className="pt-2 text-right pr-2 text-meta text-faint">
          <span className="sr-only">Ganztägig und Fristen</span>
        </div>
        {days.map((day) => (
          <DropZone
            key={day.date}
            target={{ kind: "day", date: day.date, zone: "allday" }}
            className="min-h-6 min-w-0 border-l border-border px-1 pt-2"
          >
            <AllDayList day={day} variant="compact" />
          </DropZone>
        ))}
      </div>
      {/* Aufgaben ohne Uhrzeit: Band über dem Raster, Überfälliges zuerst */}
      <div
        className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] border-b border-border pb-2"
        style={{ paddingRight: gutter }}
      >
        <div className="pt-2 pr-2 text-right text-meta text-faint">
          <span className="sr-only">Aufgaben</span>
        </div>
        {days.map((day) => (
          <div key={day.date} className="min-w-0 border-l border-border px-1 pt-2">
            <TaskList day={day} variant="compact" limit={taskLimit} />
          </div>
        ))}
      </div>
      <section
        ref={grid}
        aria-label="Zeitraster"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Scroll-Container muss per Tastatur scrollbar sein, auch ohne Einträge darin
        tabIndex={0}
        // pt-2: die erste Stundenbeschriftung sitzt halb über der Linie und würde sonst abgeschnitten
        className="scroll-quiet overflow-y-auto pt-2"
        style={{ maxHeight: height }}
        data-calendar-grid
        data-tab-scroll="raster"
      >
        <TimeGrid days={days} hours={hours} hourHeight={WEEK_HOUR_HEIGHT} nowMinutes={nowMinutes} />
      </section>
    </div>
  );
}

/** Handy: Tage untereinander, vergangene Tage der laufenden Woche zusammengeklappt, heute oben. */
export function StackedDays({ days, past = true }: { days: CalendarDay[]; past?: boolean }) {
  const { today } = useCalendar();
  const hasToday = days.some((d) => d.isToday);
  const earlier = hasToday && past ? days.filter((d) => d.date < today) : [];
  const rest = hasToday && past ? days.filter((d) => d.date >= today) : days;
  const [showPast, setShowPast] = useState(false);
  const pastCount = earlier.reduce(
    (n, d) => n + d.allDay.length + d.timed.length + d.tasks.length,
    0,
  );
  return (
    <div className="flex flex-col gap-5" data-calendar-view="tagesliste">
      {earlier.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start px-1.5 text-faint"
            aria-expanded={showPast}
            onClick={() => setShowPast(!showPast)}
          >
            <ChevronDown
              size={14}
              strokeWidth={1.5}
              aria-hidden
              className={cn("transition-transform", !showPast && "-rotate-90")}
            />
            {formatDayShort(earlier[0]?.date ?? today)}
            {earlier.length > 1
              ? ` – ${formatDayShort(earlier[earlier.length - 1]?.date ?? today)}`
              : ""}
            {` · vergangen, ${pastCount} ${pastCount === 1 ? "Eintrag" : "Einträge"}`}
          </Button>
          {showPast ? earlier.map((day) => <StackedDay key={day.date} day={day} />) : null}
        </div>
      ) : null}
      {rest.map((day) => (
        <StackedDay key={day.date} day={day} />
      ))}
    </div>
  );
}

function StackedDay({ day }: { day: CalendarDay }) {
  return (
    <section
      aria-label={`${weekdayLabel(day, true)} ${dayNumber(day.date)}.`}
      className="flex flex-col gap-2"
    >
      <DayHeader day={day} variant="row" />
      <DayList day={day} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Tag                                                                */
/* ------------------------------------------------------------------ */

/** Breite der Nebenspalte der Tag-Ansicht (Tageslast, Aufgaben), am linken Rand ziehbar (#95). */
const DAY_SIDE_WIDTH = { initial: 320, min: 240, max: 640 };

export function DayView({ day }: { day: CalendarDay }) {
  const nowMinutes = useNowMinutes();
  const hours = visibleHours(day.timed);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [sideWidth, setSideWidth] = useLocalNumber(
    "sz:kalender-tag-breite",
    DAY_SIDE_WIDTH.initial,
    DAY_SIDE_WIDTH,
  );
  const minutes = day.load.busyMinutes + day.load.taskMinutes;
  const side = (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-label="Tageslast" className="flex flex-col gap-1.5">
        <h3 className="text-meta uppercase tracking-widest text-faint">Tageslast</h3>
        <LoadBar load={day.load} />
        <p className="text-ui-sm text-muted">
          {minutes ? formatMinutes(minutes) : "nichts"}
          {minutes
            ? ` · ${[
                day.load.busyMinutes ? `${formatMinutes(day.load.busyMinutes)} Termine` : "",
                day.load.taskMinutes ? `${formatMinutes(day.load.taskMinutes)} Aufgaben` : "",
              ]
                .filter(Boolean)
                .join(", ")}`
            : ""}
          {day.load.level === "ueberladen" ? (
            <span className="text-warning"> · überladen</span>
          ) : day.load.level === "voll" ? (
            " · voll"
          ) : null}
        </p>
      </section>
      <section aria-label="Ganztägig und Fristen" className="flex flex-col gap-1.5">
        <h3 className="text-meta uppercase tracking-widest text-faint">Ganztägig und Fristen</h3>
        {day.allDay.length ? (
          <AllDayList day={day} variant="row" />
        ) : (
          <p className="px-1.5 text-ui-sm text-faint">Keine</p>
        )}
      </section>
      <section aria-label="Aufgaben" className="flex flex-col gap-1.5">
        <h3 className="text-meta uppercase tracking-widest text-faint">Aufgaben</h3>
        <TaskList day={day} />
      </section>
    </div>
  );
  if (!wide) {
    return (
      <div className="flex flex-col gap-6" data-calendar-view="tag">
        <DayHeader day={day} variant="row" />
        {side}
        <TimeGrid days={[day]} hours={hours} hourHeight={48} nowMinutes={nowMinutes} />
      </div>
    );
  }
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_var(--kalender-tag-w)] items-start gap-8"
      style={{ "--kalender-tag-w": `${sideWidth}px` } as React.CSSProperties}
      data-calendar-view="tag"
    >
      <div className="flex flex-col gap-3">
        <DayHeader day={day} variant="row" />
        <TimeGrid days={[day]} hours={hours} hourHeight={56} nowMinutes={nowMinutes} />
      </div>
      <div className="relative border-l border-border pl-8">
        <ResizeHandle
          label="Breite der Nebenspalte"
          edge="left"
          value={sideWidth}
          min={DAY_SIDE_WIDTH.min}
          max={DAY_SIDE_WIDTH.max}
          onChange={setSideWidth}
          onReset={() => setSideWidth(DAY_SIDE_WIDTH.initial)}
        />
        {side}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monat                                                              */
/* ------------------------------------------------------------------ */

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const CELL_LIMIT = 4;

export function MonthView({
  days,
  month,
  onPickDay,
}: {
  days: CalendarDay[];
  /** „YYYY-MM“ des angezeigten Monats (Nachbartage gedämpft) */
  month: string;
  onPickDay: (date: IsoDate) => void;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const [picked, setPicked] = useState<IsoDate | null>(null);
  const pickedDay = days.find((d) => d.date === picked) ?? null;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <div className="flex flex-col gap-4" data-calendar-view="monat">
      <div className="grid grid-cols-7 border-b border-border pb-1">
        {WEEKDAYS.map((w) => (
          <span key={w} className="px-1 text-meta uppercase tracking-widest text-faint">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-card bg-border">
        {weeks.flat().map((day) => (
          <MonthCell
            key={day.date}
            day={day}
            outside={!day.date.startsWith(month)}
            compact={!wide}
            picked={picked === day.date}
            onPick={() => {
              if (wide) onPickDay(day.date);
              else setPicked(picked === day.date ? null : day.date);
            }}
          />
        ))}
      </div>
      {!wide && pickedDay ? (
        <section
          aria-label={`${weekdayLabel(pickedDay, true)} ${dayNumber(pickedDay.date)}.`}
          className="flex flex-col gap-2"
        >
          <DayHeader day={pickedDay} variant="row" />
          <DayList day={pickedDay} />
        </section>
      ) : null}
    </div>
  );
}

export function MonthCell({
  day,
  outside,
  compact,
  picked,
  onPick,
  withMonth = false,
}: {
  day: CalendarDay;
  outside: boolean;
  compact: boolean;
  picked: boolean;
  onPick: () => void;
  /** Monat zum Durchscrollen (#85): am 1. steht der Monat („1. Nov“), im Namen immer */
  withMonth?: boolean;
}) {
  const items = [...day.allDay, ...day.timed.map((e) => e.item), ...day.tasks];
  const visible = items.slice(0, CELL_LIMIT);
  const more = items.length - visible.length;
  const month = withMonth ? formatMonth(day.date, { year: false }) : "";
  const label = `${weekdayLabel(day, true)}, ${dayNumber(day.date)}.${month ? ` ${month}` : ""}${day.holiday ? ` ${day.holiday}` : ""}, ${items.length} ${items.length === 1 ? "Eintrag" : "Einträge"}`;
  // am Handy ist die Zelle zu schmal für Zahl und Monat: dort steht am 1. nur der Monat (außer heute)
  const first = withMonth && day.date.endsWith("-01");
  const monthOnly = first && compact && !day.isToday;
  // Der Monat liegt auf `surface` (hebt sich in beiden Themen ab), Tage anderer Monate auf dem
  // Seitenhintergrund mit blasser Zahl – nicht halbtransparent: so fiel die Schrift unter den
  // Mindestkontrast (#85: im Durchscrollen ist das der größte Teil des Rasters)
  const tone = day.isToday
    ? "bg-accent font-medium text-accent-fg"
    : outside
      ? "text-faint"
      : day.weekday >= 5 && !monthOnly
        ? "text-muted"
        : "text-fg";
  return (
    <DropZone
      target={{ kind: "day", date: day.date }}
      className={cn(
        "group/day flex min-w-0 flex-col gap-0.5 p-1 transition-colors",
        compact ? "min-h-14" : "min-h-24",
        picked ? "bg-surface-2" : outside ? "bg-bg" : "bg-surface",
      )}
      overClassName="bg-surface-2 ring-1 ring-inset ring-border-strong"
    >
      <button
        type="button"
        onClick={onPick}
        aria-label={label}
        className={cn(
          "flex items-center gap-1 rounded-control px-0.5 text-left hover:bg-surface-2",
          compact && "flex-col items-start gap-1",
        )}
      >
        <span
          className={cn(
            "inline-flex h-6 items-center justify-center rounded-full text-ui-sm tabular-nums",
            monthOnly ? "font-medium" : "w-6",
            tone,
          )}
        >
          {monthOnly ? MONTHS_SHORT[Number(day.date.slice(5, 7)) - 1] : dayNumber(day.date)}
        </span>
        {first && !compact ? (
          <span className={cn("text-ui-sm font-medium", outside ? "text-faint" : "text-fg")}>
            {MONTHS_SHORT[Number(day.date.slice(5, 7)) - 1]}
          </span>
        ) : null}
        {day.holiday && !compact ? (
          <span className="truncate text-meta text-faint">{day.holiday}</span>
        ) : null}
        {day.load.level === "ueberladen" && !compact ? (
          <span className="ml-auto text-meta text-warning">überladen</span>
        ) : null}
        {compact ? (
          <span className="flex flex-wrap gap-0.5" aria-hidden>
            {items.slice(0, 6).map((item) => (
              <span
                key={item.id}
                className={cn(
                  "size-1.5 rounded-full",
                  item.kind === "event"
                    ? CALENDAR_BG[item.event.color]
                    : item.kind === "milestone" || item.kind === "target"
                      ? "bg-warning"
                      : item.kind === "task" && item.overdueSince
                        ? "bg-danger"
                        : "bg-faint",
                )}
              />
            ))}
          </span>
        ) : null}
      </button>
      {!compact ? (
        <>
          <ul className="flex flex-col gap-px">
            {visible.map((item) => (
              <li key={item.id}>
                <CalendarChip item={item} variant="chip" warn={day.deadlineOnFullDay} />
              </li>
            ))}
          </ul>
          {more > 0 ? (
            <button
              type="button"
              onClick={onPick}
              className="px-1 text-left text-meta text-faint hover:text-fg"
            >
              + {more} weitere
            </button>
          ) : null}
          <LoadBar load={day.load} className="mt-auto" />
        </>
      ) : (
        <LoadBar load={day.load} className="mt-auto" />
      )}
    </DropZone>
  );
}

/* ------------------------------------------------------------------ */
/* Liste (Agenda)                                                     */
/* ------------------------------------------------------------------ */

export function AgendaView({ days }: { days: CalendarDay[] }) {
  return (
    <div className="flex flex-col gap-4" data-calendar-view="liste">
      {days.map((day) => {
        const count = day.allDay.length + day.timed.length + day.tasks.length;
        return (
          <section
            key={day.date}
            aria-label={`${weekdayLabel(day, true)} ${dayNumber(day.date)}.`}
            className={cn(
              "group/day grid grid-cols-1 gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0 md:grid-cols-[180px_minmax(0,1fr)] md:gap-6",
              count === 0 ? "md:items-center" : "md:items-start",
            )}
          >
            <DayHeader day={day} variant="row" />
            {count === 0 ? (
              <div className="flex items-center gap-2 px-1.5 text-ui-sm text-faint">
                frei
                <AddTaskRow date={day.date} />
              </div>
            ) : (
              <DayList day={day} />
            )}
          </section>
        );
      })}
    </div>
  );
}
