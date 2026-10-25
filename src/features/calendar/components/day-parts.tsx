"use client";

/**
 * Bausteine eines Tages (S2b): Tageskopf mit Feiertag und Tageslast, ganztägig + Fristen,
 * Zeitraster (Termine und Zeitblöcke nebeneinander, freie Fenster, Jetzt-Linie, Ablegen auf eine
 * Uhrzeit, Dauer ziehen) und die Aufgabenliste ohne Uhrzeit (Ablegen auf den Tag, „+ Aufgabe“).
 * Woche, Tag, Liste, Heute (S2c) und die Datenbank-Ansicht setzen sich daraus zusammen.
 */
import { AlertTriangle, CalendarPlus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/input";
import { addKeyIntent } from "@/features/tasks/components/quick-add";
import { useTaskPeek } from "@/features/tasks/peek";
import { cn } from "@/lib/cn";
import { berlinMinutes, type IsoDate } from "@/lib/dates";
import { gridRange } from "../event-create";
import {
  formatMinutes,
  freeWindows,
  MIN_VISUAL_MIN,
  minutesToTime,
  placeEntries,
  snapMinutes,
} from "../layout";
import {
  type CalendarDay,
  type CalendarItem,
  type DayLoad,
  LOAD_LABELS,
  type TimedEntry,
} from "../model";
import { isMovable } from "../move";
import { useCalendar } from "./calendar-context";
import { DraggableEvent, DraggableTask, DropZone } from "./calendar-dnd";
import { CalendarChip, TaskChip } from "./chips";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAYS_LONG = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];
/** Tageslast-Balken: 8 h = volle Breite */
const LOAD_SCALE_MIN = 8 * 60;

export const weekdayLabel = (day: Pick<CalendarDay, "weekday">, long = false) =>
  (long ? WEEKDAYS_LONG : WEEKDAYS)[day.weekday] ?? "";
export const dayNumber = (date: IsoDate) => String(Number(date.slice(8, 10)));

/** Tageslast als ruhiger Balken (Termine + Aufgaben über 8 h); „überladen“ nur als Text in Warnfarbe. */
export function LoadBar({ load, className }: { load: DayLoad; className?: string }) {
  const minutes = load.busyMinutes + load.taskMinutes;
  const width = Math.min(100, (minutes / LOAD_SCALE_MIN) * 100);
  const text = `Tageslast ${LOAD_LABELS[load.level]}: ${formatMinutes(minutes)}${
    minutes
      ? ` (${formatMinutes(load.busyMinutes)} Termine, ${formatMinutes(load.taskMinutes)} Aufgaben)`
      : ""
  }`;
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-load={load.level}
      className={cn("flex h-1 w-full overflow-hidden rounded-full bg-border", className)}
    >
      <span
        className={cn(
          "h-full rounded-full",
          load.level === "ueberladen" ? "bg-warning" : load.level === "voll" ? "bg-fg" : "bg-faint",
        )}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

/** Tageskopf: Wochentag, Zahl (heute als Pille), Feiertag, Tageslast; Frist am vollen Tag warnt. */
export function DayHeader({
  day,
  variant = "column",
  onPick,
}: {
  day: CalendarDay;
  variant?: "column" | "row";
  onPick?: () => void;
}) {
  const number = (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full text-ui font-medium tabular-nums",
        day.isToday ? "bg-accent text-accent-fg" : "text-fg",
        day.weekday >= 5 && !day.isToday && "text-muted",
      )}
    >
      {dayNumber(day.date)}
    </span>
  );
  const content = (
    <>
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "text-meta uppercase tracking-widest",
            day.isToday ? "text-fg" : "text-faint",
          )}
        >
          {weekdayLabel(day)}
        </span>
        {number}
        {day.deadlineOnFullDay ? (
          <AlertTriangle
            size={13}
            strokeWidth={1.5}
            className="text-warning"
            aria-label="Frist an einem vollen Tag"
          />
        ) : null}
        {day.load.level === "ueberladen" ? (
          <span className="text-meta text-warning">überladen</span>
        ) : null}
      </span>
      {day.holiday ? <span className="truncate text-meta text-faint">{day.holiday}</span> : null}
      <LoadBar load={day.load} className="mt-1" />
    </>
  );
  const className = cn(
    "flex min-w-0 flex-col gap-0.5",
    variant === "row" &&
      "flex-row items-center gap-3 [&>span:last-child]:mt-0 [&>span:last-child]:w-16",
  );
  if (onPick) {
    return (
      <button
        type="button"
        onClick={onPick}
        aria-label={`${weekdayLabel(day, true)}, ${day.date}${day.holiday ? `, ${day.holiday}` : ""}`}
        className={cn(className, "w-full rounded-control text-left hover:bg-surface-2")}
      >
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

/** Ganztägige Termine, Fristen, Rückblick-Tage – als Zeilen (Woche/Tag) oder Chips (Monat). */
export function AllDayList({
  day,
  variant,
  limit,
}: {
  day: CalendarDay;
  variant: "row" | "compact" | "chip";
  limit?: number;
}) {
  const items = limit ? day.allDay.slice(0, limit) : day.allDay;
  if (items.length === 0) return null;
  return (
    <ul aria-label="Ganztägig und Fristen" className="flex flex-col gap-px">
      {items.map((item) => (
        <li key={item.id}>
          {item.kind === "event" ? (
            <DraggableEvent event={item.event} segmentDate={day.date}>
              <CalendarChip item={item} variant={variant} />
            </DraggableEvent>
          ) : (
            <CalendarChip
              item={item}
              variant={variant}
              warn={day.deadlineOnFullDay && (item.kind === "milestone" || item.kind === "target")}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * „+ Aufgabe“ in einem Tag: Zeile wird zum Eingabefeld, Enter legt an und öffnet die Aufgabe
 * (#75), ⇧Enter legt nur an.
 */
export function AddTaskRow({ date, minutes = null }: { date: IsoDate; minutes?: number | null }) {
  const { createOn, calendars, openNewEvent } = useCalendar();
  const peek = useTaskPeek();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  if (!open) {
    // Bleibt in der Tageszelle (N4): In schmalen Spalten (Woche) nur die Symbole – mit Text ragten
    // die am Desktop unsichtbaren, aber klickbaren Knöpfe in den Nachbartag und fingen dort Klicks
    // auf Aufgaben ab. Container-Abfrage, denn die Spaltenbreite hängt nicht am Fenster.
    return (
      <div className="@container w-full min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 justify-start px-1.5 text-faint md:h-7 md:opacity-0 md:group-hover/day:opacity-100 md:focus-visible:opacity-100"
            onClick={() => setOpen(true)}
            aria-label={`Aufgabe für ${date} anlegen`}
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            <span className="@max-[11rem]:sr-only">Aufgabe</span>
          </Button>
          {calendars.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 justify-start px-1.5 text-faint md:h-7 md:opacity-0 md:group-hover/day:opacity-100 md:focus-visible:opacity-100"
              onClick={() => openNewEvent({ date })}
              aria-label={`Termin für ${date} anlegen`}
            >
              <CalendarPlus size={14} strokeWidth={1.5} aria-hidden />
              <span className="@max-[11rem]:sr-only">Termin</span>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <input
      ref={input}
      value={title}
      aria-label={`Neue Aufgabe für ${date}`}
      placeholder="Neue Aufgabe …"
      className={cn(controlClasses, "h-8 text-ui-sm")}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => {
        if (!title.trim()) setOpen(false);
      }}
      onKeyDown={(e) => {
        const intent = addKeyIntent(e);
        if (e.key === "Escape") {
          setTitle("");
          setOpen(false);
        } else if (intent && title.trim()) {
          e.preventDefault();
          const task = createOn(date, minutes, title.trim());
          setTitle("");
          if (intent.open) peek.open(task.id);
        }
      }}
    />
  );
}

/**
 * Aufgaben ohne Uhrzeit (überfällig zuerst) – Ablegen setzt die Fälligkeit auf diesen Tag.
 * Mit `limit` (Band über dem Wochenraster) zeigt die Liste nur die ersten Einträge und
 * „N weitere“ zum Aufklappen – Überfälliges steht damit immer im Blick.
 */
export function TaskList({
  day,
  showAdd = true,
  variant = "row",
  limit,
  className,
}: {
  day: CalendarDay;
  showAdd?: boolean;
  /** compact in schmalen Wochenspalten */
  variant?: "row" | "compact";
  /** höchstens so viele Einträge, der Rest hinter „N weitere“ */
  limit?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = limit && !expanded ? day.tasks.slice(0, limit) : day.tasks;
  const hidden = day.tasks.length - visible.length;
  return (
    <DropZone
      target={{ kind: "day", date: day.date }}
      label={`Aufgaben am ${day.date}`}
      className={cn("group/day flex min-h-10 flex-col gap-px rounded-control", className)}
      overClassName="bg-surface-2 outline outline-1 outline-dashed outline-border-strong"
    >
      {visible.length > 0 ? (
        <ul
          aria-label={`Aufgaben ${weekdayLabel(day)} ${dayNumber(day.date)}.`}
          className="flex flex-col gap-px"
        >
          {visible.map((item) => (
            <li key={item.id}>
              {item.kind === "task" ? (
                <DraggableTask task={item.task} disabled={item.done}>
                  <TaskChip item={item} variant={variant} />
                </DraggableTask>
              ) : (
                <CalendarChip item={item} variant={variant} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {limit && day.tasks.length > limit ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="rounded-control px-1 py-0.5 text-left text-meta text-faint hover:bg-surface-2 hover:text-fg"
        >
          {expanded ? "weniger" : `+ ${hidden} weitere`}
        </button>
      ) : null}
      {showAdd ? <AddTaskRow date={day.date} /> : null}
    </DropZone>
  );
}

/* ------------------------------------------------------------------ */
/* Zeitraster                                                         */
/* ------------------------------------------------------------------ */

export interface TimeGridProps {
  days: CalendarDay[];
  /** sichtbare Stunden */
  hours: { from: number; to: number };
  /** Pixel je Stunde */
  hourHeight: number;
  /** Jetzt-Linie in der Spalte von heute (Minuten seit Mitternacht) */
  nowMinutes?: number | null;
  /** Stundenbeschriftung links */
  gutter?: boolean;
  className?: string;
}

const SLOT_MIN = 30;

function TimedBlock({
  entry,
  column,
  columns,
  hours,
  hourHeight,
}: {
  entry: TimedEntry;
  column: number;
  columns: number;
  hours: { from: number; to: number };
  hourHeight: number;
}) {
  const { move, eventMove } = useCalendar();
  const peek = useTaskPeek();
  const [previewTo, setPreviewTo] = useState<number | null>(null);
  const top = ((entry.from - hours.from * 60) / 60) * hourHeight;
  const to = previewTo ?? Math.max(entry.to, entry.from + MIN_VISUAL_MIN);
  const height = Math.max(((to - entry.from) / 60) * hourHeight, 18);
  const width = 100 / columns;
  const task = entry.item.kind === "task" ? entry.item.task : null;
  // Google-Termin mit Schreibrecht: Dauer ziehbar, solange der Abschnitt der letzte Tag ist (N1b)
  const event =
    entry.item.kind === "event" && isMovable(entry.item.event) && !entry.continuesAfter
      ? entry.item.event
      : null;
  const resizable = task !== null || event !== null;
  const resizeTitle = task?.title.trim() || event?.title || "Ohne Titel";

  // Dauer am unteren Rand ziehen (Zeitblöcke von Aufgaben, Google-Termine): Zeiger-Ereignisse mit
  // Capture; geschrieben wird erst beim Loslassen
  const onResizeStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!task && !event) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startTo = entry.to;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let next = startTo;
    const onMove = (ev: PointerEvent) => {
      const delta = ((ev.clientY - startY) / hourHeight) * 60;
      next = Math.max(entry.from + 15, snapMinutes(startTo + delta));
      setPreviewTo(next);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setPreviewTo(null);
      if (next === startTo) return;
      if (task) move.setDuration(task, next - entry.from);
      else if (event) eventMove.setEnd(event, entry.item.date, next);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const block = (
    <div
      className="absolute z-10 pr-0.5"
      style={{ top, height, left: `${column * width}%`, width: `${width}%` }}
    >
      {entry.item.kind === "task" ? (
        <DraggableTask task={entry.item.task} disabled={entry.item.done} className="h-full">
          <TaskChip item={entry.item} variant="block" />
        </DraggableTask>
      ) : entry.item.kind === "event" ? (
        <DraggableEvent event={entry.item.event} segmentDate={entry.item.date} className="h-full">
          <CalendarChip item={entry.item} variant="block" className="h-full" />
        </DraggableEvent>
      ) : (
        <CalendarChip item={entry.item} variant="block" className="h-full" />
      )}
      {resizable && peek ? (
        <button
          type="button"
          aria-label={`Dauer von „${resizeTitle}“ ändern (${formatMinutes(to - entry.from)})`}
          title="Dauer ziehen"
          onPointerDown={onResizeStart}
          className="absolute inset-x-1 bottom-0 h-2 cursor-ns-resize rounded-b-control hover:bg-border-strong/60"
        />
      ) : null}
      {previewTo !== null ? (
        <span className="absolute -bottom-4 right-0 rounded-control bg-surface px-1 text-meta text-muted tabular-nums shadow-float">
          bis {minutesToTime(previewTo)}
        </span>
      ) : null}
    </div>
  );
  return block;
}

/** Eine Tagesspalte im Raster: Ablagefelder je halbe Stunde, freie Fenster, Einträge, Jetzt-Linie. */
function GridColumn({
  day,
  hours,
  hourHeight,
  nowMinutes,
}: {
  day: CalendarDay;
  hours: { from: number; to: number };
  hourHeight: number;
  nowMinutes: number | null;
}) {
  const placed = placeEntries(day.timed);
  const windows = freeWindows(day.timed);
  const slots: number[] = [];
  for (let m = hours.from * 60; m < hours.to * 60; m += SLOT_MIN) slots.push(m);
  const y = (minutes: number) => ((minutes - hours.from * 60) / 60) * hourHeight;
  const { calendars, openNewEvent } = useCalendar();
  const column = useRef<HTMLDivElement>(null);
  const [draftRange, setDraftRange] = useState<{ from: number; to: number } | null>(null);
  const canCreate = calendars.length > 0;

  // Klick auf freie Zeit = 1 h ab dem Halbstundenfeld, Ziehen = Zeitraum aufziehen (N1c). Beginnt
  // nur auf einer leeren Ablagefläche (Aufgaben und Termine liegen darüber und bleiben ziehbar),
  // nur mit der Maus; ist gerade ein Fenster/Menü offen, schließt der Klick nur dieses.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canCreate || e.button !== 0 || e.pointerType !== "mouse") return;
    const target = e.target as HTMLElement;
    if (!target.closest('[data-drop-target^="slot:"]')) return;
    if (document.querySelector("[role=dialog], [role=menu]")) return;
    const element = column.current;
    if (!element) return;
    const rectTop = element.getBoundingClientRect().top;
    const minutesAt = (clientY: number) =>
      Math.min(
        hours.to * 60 - 1,
        Math.max(hours.from * 60, hours.from * 60 + ((clientY - rectTop) / hourHeight) * 60),
      );
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const press = minutesAt(startY);
    let dragged = false;
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      setDraftRange(null);
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragged && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      dragged = true;
      const r = gridRange(press, minutesAt(ev.clientY));
      setDraftRange({ from: r.start, to: r.start + r.duration });
    };
    const onUp = (ev: PointerEvent) => {
      const release = dragged ? minutesAt(ev.clientY) : null;
      stop();
      openNewEvent({ date: day.date, press, release });
    };
    const onCancel = () => stop();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") stop();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
  };
  return (
    <div
      ref={column}
      onPointerDown={onPointerDown}
      className={cn(
        "relative min-w-0 border-l border-border",
        day.isToday && "bg-surface/60",
        day.weekday >= 5 && "bg-surface-2/40",
        canCreate && "select-none",
      )}
      style={{ height: (hours.to - hours.from) * hourHeight }}
      data-calendar-day={day.date}
    >
      {draftRange ? (
        <span
          aria-hidden
          data-new-event-range={`${minutesToTime(draftRange.from)}-${minutesToTime(draftRange.to)}`}
          className="pointer-events-none absolute inset-x-1 z-10 rounded-control border border-dashed border-border-strong bg-surface-2/80 px-1 text-meta text-muted tabular-nums"
          style={{ top: y(draftRange.from), height: y(draftRange.to) - y(draftRange.from) }}
        >
          {minutesToTime(draftRange.from)}–{minutesToTime(draftRange.to)}
        </span>
      ) : null}
      {/* freie Fenster (≥ 60 min zwischen 8 und 18 Uhr) */}
      {windows.map((w) => (
        <span
          key={w.from}
          aria-hidden
          data-free-window={`${minutesToTime(w.from)}-${minutesToTime(w.to)}`}
          title={`frei ${minutesToTime(w.from)}–${minutesToTime(w.to)}`}
          className="pointer-events-none absolute inset-x-1 rounded-control border border-dashed border-border-strong/40"
          style={{ top: y(w.from) + 1, height: y(w.to) - y(w.from) - 2 }}
        />
      ))}
      {/* Ablagefelder: halbe Stunden, Stundenlinien */}
      {slots.map((m) => (
        <DropZone
          key={m}
          target={{ kind: "slot", date: day.date, minutes: m }}
          className={cn(
            "absolute inset-x-0",
            m % 60 === 0 ? "border-t border-border" : "border-t border-dashed border-border/50",
          )}
          overClassName="bg-surface-2 ring-1 ring-inset ring-border-strong"
          style={{ top: y(m), height: hourHeight / 2 }}
        />
      ))}
      {placed.map(({ entry, column, columns }) => (
        <TimedBlock
          key={entry.item.id}
          entry={entry}
          column={column}
          columns={columns}
          hours={hours}
          hourHeight={hourHeight}
        />
      ))}
      {day.isToday &&
      nowMinutes !== null &&
      nowMinutes >= hours.from * 60 &&
      nowMinutes <= hours.to * 60 ? (
        <span
          aria-hidden
          data-now-line
          className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
          style={{ top: y(nowMinutes) }}
        >
          <span className="-ml-1 size-2 rounded-full bg-fg" />
          <span className="h-px flex-1 bg-fg" />
        </span>
      ) : null}
    </div>
  );
}

/** Zeitraster über eine oder mehrere Tagesspalten (Woche, Tag; Heute mit einer Spalte). */
export function TimeGrid({
  days,
  hours,
  hourHeight,
  nowMinutes = null,
  gutter = true,
  className,
}: TimeGridProps) {
  const labels: number[] = [];
  for (let h = hours.from; h <= hours.to; h++) labels.push(h);
  return (
    <section
      className={cn("grid", className)}
      style={{
        // Stundenspalte in rem: wächst mit der Schriftgröße, sonst ragt „07:00“ links hinaus (M3-4)
        gridTemplateColumns: `${gutter ? "2.75rem " : ""}repeat(${days.length}, minmax(0, 1fr))`,
      }}
      aria-label="Zeitraster"
    >
      {gutter ? (
        <div className="relative" style={{ height: (hours.to - hours.from) * hourHeight }}>
          {labels.map((h) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 text-meta text-faint tabular-nums"
              style={{ top: (h - hours.from) * hourHeight }}
            >
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
      ) : null}
      {days.map((day) => (
        <GridColumn
          key={day.date}
          day={day}
          hours={hours}
          hourHeight={hourHeight}
          nowMinutes={nowMinutes}
        />
      ))}
    </section>
  );
}

/**
 * Resthöhe des Fensters unter einem Element (Pixel): das Wochenraster scrollt damit in sich, die
 * ganze Woche samt Aufgaben-Band bleibt ohne Seiten-Scrollen erfassbar. Misst beim Einhängen, bei
 * Größenänderung des Fensters und wenn sich darüber etwas aufklappt (ResizeObserver am Elternteil).
 */
export function useFillHeight(
  ref: React.RefObject<HTMLElement | null>,
  { min = 280, gap = 24 }: { min?: number; gap?: number } = {},
): number | undefined {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(min, Math.round(window.innerHeight - top - gap)));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    if (element.parentElement) observer?.observe(element.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [ref, min, gap]);
  return height;
}

/** Aktuelle Minuten in Europe/Berlin (für die Jetzt-Linie), null vor dem Einhängen. */
export function useNowMinutes(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(berlinMinutes());
    const timer = setInterval(() => setNow(berlinMinutes()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Alle Einträge eines Tages in fester Ordnung als eine Liste (Liste, Handy-Woche, Monat-Tipp). */
export function DayList({
  day,
  showAdd = true,
  emptyText = "Nichts geplant",
}: {
  day: CalendarDay;
  showAdd?: boolean;
  emptyText?: string;
}) {
  const timed = day.timed.map((e) => e.item);
  const empty = day.allDay.length + timed.length + day.tasks.length === 0;
  return (
    <div className="group/day flex flex-col gap-1">
      <AllDayList day={day} variant="row" />
      {timed.length > 0 ? (
        <ul aria-label="Termine nach Uhrzeit" className="flex flex-col gap-px">
          {timed.map((item: CalendarItem) => (
            <li key={item.id}>
              {item.kind === "task" ? (
                <DraggableTask task={item.task} disabled={item.done}>
                  <TaskChip item={item} variant="row" />
                </DraggableTask>
              ) : item.kind === "event" ? (
                <DraggableEvent event={item.event} segmentDate={day.date}>
                  <CalendarChip item={item} variant="row" />
                </DraggableEvent>
              ) : (
                <CalendarChip item={item} variant="row" />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {empty && !showAdd ? <p className="px-1.5 text-ui-sm text-faint">{emptyText}</p> : null}
      <TaskList day={day} showAdd={showAdd} />
    </div>
  );
}
