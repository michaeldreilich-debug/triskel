"use client";

/**
 * Einträge im Kalender (S2b): Aufgabe (Kreis), Termin (Farbbalken), Frist (Fahne/Ziel), Rückblick-
 * Tag und blasse Wiederholung – je als Zeile (Listen), Block (Zeitraster) oder Chip (Monat).
 * Dieselben Bausteine nutzt der Tagesablauf auf Heute (S2c).
 */
import {
  AppWindow,
  CalendarCheck2,
  CheckCircle2,
  Circle,
  ExternalLink,
  Flag,
  Goal,
  History,
  Link2,
  Lock,
  MapPin,
  MoreHorizontal,
  Repeat,
  Target,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Popover } from "radix-ui";
import { OPEN_IN_NEW_TAB, useOpenInNewTab } from "@/components/shell/tabs/tabs-provider";
import { Button } from "@/components/ui/button";
import { copyAppLink } from "@/components/ui/copy-link";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { TaskCheck } from "@/components/ui/task-check";
import { useTaskActions } from "@/features/tasks/api";
import { useTaskPeek } from "@/features/tasks/peek";
import { recurrenceLabel } from "@/features/tasks/recurrence";
import { PRIORITY_LABELS, taskTitle } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinTime, formatDue } from "@/lib/dates";
import { formatMinutes, minutesToTime } from "../layout";
import type { CalendarItem } from "../model";
import { MoveMenu, useCalendar } from "./calendar-context";
import { CALENDAR_BG, CALENDAR_BORDER, CalendarDot } from "./calendar-dot";
import { EventDeleteButton, EventEditFields } from "./event-edit-fields";
import {
  EventLinkMarks,
  EventLinksSection,
  eventLinkCountsLabel,
  useEventLinkCounts,
} from "./event-links";
import { EventMovePanel } from "./event-move-panel";
import { type HoverSide, TaskHover, taskPlaceLine } from "./task-hover";

/**
 * row = Liste, compact = schmale Wochenspalte, block = Zeitraster, chip = Monatszelle,
 * timeline = Zeile im Tagesablauf auf Heute (Uhrzeit und Punkt stellt die Zeitleiste, Muster 6)
 */
export type ChipVariant = "row" | "compact" | "block" | "chip" | "timeline";

type TaskItem = Extract<CalendarItem, { kind: "task" }>;
type EventItem = Extract<CalendarItem, { kind: "event" }>;

const ROW =
  "group/row relative grid min-h-9 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-2 rounded-control px-1.5 py-1 text-left transition-colors hover:bg-surface-2";
// w-full ist nötig: ein <button> dehnt sich nicht auf seinen Container, sondern auf seinen
// Inhalt – ohne feste Breite ragte ein Termin mit langem Ort in die Nachbarspalte
const BLOCK =
  "flex h-full w-full min-w-0 flex-col overflow-hidden rounded-control border px-1.5 py-0.5 text-left text-meta leading-4";
const CHIP =
  "flex min-h-5 w-full min-w-0 items-center gap-1 rounded-control px-1 text-left text-meta";
const TIMELINE =
  "group/row flex min-h-11 w-full min-w-0 items-center gap-2 rounded-control px-1.5 text-left transition-colors hover:bg-surface-2 md:min-h-9";

/* ------------------------------------------------------------------ */
/* Aufgabe                                                            */
/* ------------------------------------------------------------------ */

function TaskMenuItems({
  item,
  kind,
  onOpen,
}: {
  item: TaskItem;
  kind: "context" | "dropdown";
  onOpen: () => void;
}) {
  const actions = useTaskActions();
  const { today } = useCalendar();
  const peek = useTaskPeek();
  const openInNewTab = useOpenInNewTab();
  const task = item.task;
  const Item = kind === "context" ? ContextMenuItem : MenuItem;
  const Separator = kind === "context" ? ContextMenuSeparator : MenuSeparator;
  return (
    <>
      <Item onSelect={onOpen}>
        <ExternalLink aria-hidden />
        Öffnen
      </Item>
      {openInNewTab ? (
        <Item onSelect={() => openInNewTab(peek.hrefFor(task.id))}>
          <AppWindow aria-hidden />
          {OPEN_IN_NEW_TAB}
        </Item>
      ) : null}
      <Item onSelect={() => actions.toggle(task.id)}>
        {item.done ? <Circle aria-hidden /> : <CheckCircle2 aria-hidden />}
        {item.done ? "Wieder öffnen" : "Erledigt"}
      </Item>
      <MoveMenu task={task} kind={kind} />
      <Item onSelect={() => actions.setFocus(task.id, task.focus_date === today ? null : today)}>
        <CalendarCheck2 aria-hidden />
        {task.focus_date === today ? "Fokus heute entfernen" : "Fokus heute"}
      </Item>
      <Item onSelect={() => copyAppLink(appPath.task(task.id))}>
        <Link2 aria-hidden />
        Link kopieren
      </Item>
      <Separator />
      <Item variant="danger" onSelect={() => actions.trash(task.id)}>
        <Trash2 aria-hidden />
        In den Papierkorb
      </Item>
    </>
  );
}

/** Meta-Zeile einer Aufgabe: überfällig, Fokus, Uhrzeit, Bereich/Projekt, fällig woanders. */
function TaskMeta({
  item,
  showTime,
  short = false,
  place = false,
  hidePlace = false,
}: {
  item: TaskItem;
  showTime: boolean;
  /** Projekt/Inbox gar nicht nennen (steht schon im Gruppenkopf, Einplanen D) */
  hidePlace?: boolean;
  /** schmale Spalte: nur das Nötigste */
  short?: boolean;
  /** Projekt › Meilenstein statt nur Projekt (Einplanen-Spalte, #61) */
  place?: boolean;
}) {
  const { ctx, today } = useCalendar();
  const task = item.task;
  const project = ctx.projects.find((p) => p.id === task.project_id);
  const area = ctx.areas.find((a) => a.id === task.area_id);
  const blocked = ctx.blocked.has(task.id) && !item.done;
  const parts: React.ReactNode[] = [];
  if (item.overdueSince) {
    parts.push(
      <span key="over" className="text-danger">
        {short ? "überfällig" : `überfällig seit ${formatDue(item.overdueSince, today)}`}
      </span>,
    );
  }
  if (showTime && item.time !== null) {
    parts.push(
      <span key="time" className="tabular-nums">
        {minutesToTime(item.time)}
        {item.duration ? ` · ${formatMinutes(item.duration)}` : ""}
      </span>,
    );
  }
  if (item.dueElsewhere && !item.overdueSince) {
    parts.push(<span key="due">fällig {formatDue(item.dueElsewhere, today)}</span>);
  }
  // Projekt › Meilenstein steht als eigenes, dehnbares Stück hinten (Einplanen-Spalte, #61)
  const placeLine = project && place && !hidePlace ? taskPlaceLine(task, ctx) : null;
  if (hidePlace) {
    // der Gruppenkopf nennt es
  } else if (placeLine) {
    // steht unten hinter den übrigen Angaben
  } else if (project && !short)
    parts.push(<span key="project">{project.title.trim() || "Ohne Titel"}</span>);
  else if (task.in_inbox) parts.push(<span key="inbox">Inbox</span>);
  if (task.recurrence) {
    parts.push(
      <Repeat
        key="rep"
        size={11}
        strokeWidth={1.5}
        className="shrink-0"
        aria-label={`Wiederholt sich: ${recurrenceLabel(task.recurrence)}`}
      />,
    );
  }
  if (parts.length === 0 && !placeLine && !area && !item.focus && !blocked) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta text-faint">
      {area && !task.in_inbox ? <AreaDot color={area.color} /> : null}
      {item.focus ? (
        <Target size={11} strokeWidth={1.75} className="shrink-0 text-fg" aria-label="Fokus" />
      ) : null}
      {blocked ? (
        <Lock size={11} strokeWidth={1.5} className="shrink-0" aria-label="Blockiert" />
      ) : null}
      {parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: feste Reihenfolge, nur Darstellung
        <span key={i} className="flex min-w-0 items-center gap-1 truncate">
          {part}
        </span>
      ))}
      {placeLine ? (
        // am Desktop eine Zeile mit „…“ (das Kärtchen zeigt alles), am Handy ganz
        <span className="min-w-0 flex-1 basis-24 truncate max-md:whitespace-normal max-md:break-words">
          {placeLine}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Aufgabe im Kalender: Kreis, Titel (öffnet das Panel), Meta; Rechtsklick und ⋯ mit
 * „Verschieben auf …“. `block` = Zeitblock im Raster (Höhe gibt der Rahmen vor).
 */
export function TaskChip({
  item,
  variant,
  className,
  wrap = false,
  hidePlace = false,
  hoverSide,
}: {
  item: TaskItem;
  variant: ChipVariant;
  className?: string;
  /** Zeile ohne Projekt/Inbox in der Meta-Zeile (Einplanen D: steht im Gruppenkopf) */
  hidePlace?: boolean;
  /** Zeile: Titel bis zwei Zeilen (am Handy ganz) und Projekt › Meilenstein (#61) */
  wrap?: boolean;
  /** Seite des Kärtchens beim Drüberfahren (#61) */
  hoverSide?: HoverSide;
}) {
  const actions = useTaskActions();
  const peek = useTaskPeek();
  const task = item.task;
  const title = taskTitle(task);
  const priority = !item.done && task.priority && task.priority < 3 ? task.priority : null;
  const open = () => peek.open(task.id);
  const titleClass = cn(item.done && "text-faint line-through");

  const body =
    variant === "chip" ? (
      <Link
        href={peek.hrefFor(task.id)}
        scroll={false}
        data-calendar-item={item.id}
        className={cn(CHIP, "hover:bg-surface-2", className)}
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full border-[1.5px]",
            item.done
              ? "border-success bg-success"
              : priority === 1
                ? "border-danger"
                : priority === 2
                  ? "border-warning"
                  : "border-faint",
          )}
        />
        {item.overdueSince ? <span className="sr-only">überfällig: </span> : null}
        <span className={cn("truncate", titleClass, item.overdueSince && "text-danger")}>
          {title}
        </span>
      </Link>
    ) : variant === "compact" ? (
      <div
        data-calendar-item={item.id}
        className={cn(
          "group/row grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-1.5 rounded-control px-1 py-1 transition-colors hover:bg-surface-2",
          peek.taskId === task.id && "bg-surface-2",
          className,
        )}
      >
        <TaskCheck
          status={task.status}
          priority={task.priority}
          size="md"
          className="mt-px size-4 after:-inset-1.5"
          onCheckedChange={() => actions.toggle(task.id)}
          aria-label={`„${title}“ ${item.done ? "wieder öffnen" : "erledigt"}`}
        />
        <Link
          href={peek.hrefFor(task.id)}
          scroll={false}
          title={title}
          className="flex min-w-0 flex-col gap-0.5 rounded-control"
        >
          <span className={cn("truncate text-ui-sm leading-4", titleClass)}>
            {title}
            {priority ? (
              <span className="sr-only">, Priorität {PRIORITY_LABELS[priority]}</span>
            ) : null}
          </span>
          <TaskMeta item={item} showTime short />
        </Link>
      </div>
    ) : variant === "timeline" ? (
      <div
        data-calendar-item={item.id}
        className={cn(TIMELINE, peek.taskId === task.id && "bg-surface-2", className)}
      >
        <Link
          href={peek.hrefFor(task.id)}
          scroll={false}
          className={cn("min-w-0 truncate text-ui hover:underline", titleClass)}
        >
          {title}
          {priority ? (
            <span className="sr-only">, Priorität {PRIORITY_LABELS[priority]}</span>
          ) : null}
        </Link>
        <TaskMeta item={item} showTime={false} short />
        <MenuRoot modal={false}>
          <MenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto size-9 shrink-0 opacity-100 md:size-7 md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
              aria-label={`Mehr zu „${title}“`}
            >
              <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" aria-label={`Aufgabe „${title}“`}>
            <TaskMenuItems item={item} kind="dropdown" onOpen={open} />
          </MenuContent>
        </MenuRoot>
      </div>
    ) : variant === "block" ? (
      <div
        data-calendar-item={item.id}
        className={cn(
          BLOCK,
          "border-border bg-surface",
          item.done && "opacity-60",
          peek.taskId === task.id && "border-border-strong",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-1">
          <TaskCheck
            status={task.status}
            priority={task.priority}
            size="md"
            className="size-3.5 after:-inset-1.5"
            onCheckedChange={() => actions.toggle(task.id)}
            aria-label={`„${title}“ ${item.done ? "wieder öffnen" : "erledigt"}`}
          />
          <Link
            href={peek.hrefFor(task.id)}
            scroll={false}
            className={cn("min-w-0 flex-1 truncate font-medium hover:underline", titleClass)}
          >
            {title}
          </Link>
        </span>
        <span className="truncate text-faint tabular-nums">
          {item.time !== null ? minutesToTime(item.time) : ""}
          {item.time !== null && item.duration
            ? `–${minutesToTime(item.time + item.duration)}`
            : ""}
        </span>
      </div>
    ) : (
      <div
        data-calendar-item={item.id}
        className={cn(ROW, peek.taskId === task.id && "bg-surface-2", className)}
      >
        <TaskCheck
          status={task.status}
          priority={task.priority}
          onCheckedChange={() => actions.toggle(task.id)}
          aria-label={`„${title}“ ${item.done ? "wieder öffnen" : "erledigt"}`}
          className="mt-0.5"
        />
        <Link
          href={peek.hrefFor(task.id)}
          scroll={false}
          className="flex min-w-0 flex-col gap-0.5 rounded-control"
        >
          <span
            className={cn(
              wrap ? "break-words md:line-clamp-2" : "truncate",
              "text-ui",
              titleClass,
              item.overdueSince && "font-medium",
            )}
          >
            {title}
            {priority ? (
              <span className="sr-only">, Priorität {PRIORITY_LABELS[priority]}</span>
            ) : null}
          </span>
          <TaskMeta item={item} showTime place={wrap} hidePlace={hidePlace} />
        </Link>
        <MenuRoot modal={false}>
          <MenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="-my-1 -mr-1 size-9 opacity-100 md:size-7 md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
              aria-label={`Mehr zu „${title}“`}
            >
              <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" aria-label={`Aufgabe „${title}“`}>
            <TaskMenuItems item={item} kind="dropdown" onOpen={open} />
          </MenuContent>
        </MenuRoot>
      </div>
    );

  return (
    <ContextMenuRoot modal={false}>
      <TaskHover task={task} side={hoverSide ?? "top"}>
        <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
      </TaskHover>
      <ContextMenuContent aria-label={`Aufgabe „${title}“`}>
        <TaskMenuItems item={item} kind="context" onOpen={open} />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}

/** Künftiger Termin einer Wiederholung – blass, nur vorausberechnet (öffnet die Aufgabe). */
export function PreviewChip({
  item,
  variant,
}: {
  item: Extract<CalendarItem, { kind: "preview" }>;
  variant: ChipVariant;
}) {
  const peek = useTaskPeek();
  const title = taskTitle(item.task);
  return (
    <Link
      href={peek.hrefFor(item.task.id)}
      scroll={false}
      data-calendar-item={item.id}
      title={`Wiederholt sich: ${recurrenceLabel(item.task.recurrence)} – noch nicht angelegt`}
      className={cn(
        variant === "row" ? "flex min-h-7 items-center gap-2 rounded-control px-1.5" : CHIP,
        "text-faint hover:bg-surface-2",
      )}
    >
      <Repeat
        size={variant === "row" ? 13 : 10}
        strokeWidth={1.5}
        aria-hidden
        className="shrink-0"
      />
      <span className={cn("truncate", variant === "row" && "text-ui-sm")}>{title}</span>
      <span className="sr-only">(Wiederholung, vorausberechnet)</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Termin                                                             */
/* ------------------------------------------------------------------ */

function eventTimeLabel(item: EventItem): string {
  const e = item.event;
  if (e.allDay) return "ganztägig";
  const from = item.segment.continuesBefore ? "…" : minutesToTime(item.segment.from);
  if (e.startMinutes === e.endMinutes && e.date === e.endDate) return from;
  const to = item.segment.continuesAfter ? "…" : minutesToTime(item.segment.to);
  return `${from}–${to}`;
}

/** Kleines Detail zum Termin: Zeit, Ort, Beschreibung, Kalender, Link nach Google. */
export function EventDetail({ item }: { item: EventItem }) {
  const e = item.event;
  // änderbare Google-Termine bekommen Felder (N1c); gerade erst angelegte noch nicht (kein etag)
  const editable = e.google?.editable === true && e.google.etag !== "";
  return (
    <div
      className={cn(
        "flex flex-col gap-2 text-ui",
        editable ? "w-[min(22rem,calc(100vw-3rem))]" : "max-w-xs",
      )}
    >
      {editable ? null : (
        <p className="flex items-start gap-2">
          <CalendarDot color={e.color} className="mt-1.5" />
          <span className="heading text-body-lg/snug">{e.title}</span>
        </p>
      )}
      {editable ? <EventEditFields event={e} /> : null}
      <p className="text-ui-sm text-muted tabular-nums">
        {e.allDay
          ? e.date === e.endDate
            ? "Ganztägig"
            : `Ganztägig, bis ${formatDue(e.endDate, item.date)}`
          : `${berlinTime(e.start)}–${berlinTime(e.end)}${e.date !== e.endDate ? ` (bis ${formatDue(e.endDate, item.date)})` : ""}`}
        {e.recurring ? " · wiederholt sich" : ""}
        {!e.busy ? " · frei" : ""}
      </p>
      {!editable && e.location ? (
        <p className="flex items-start gap-1.5 text-ui-sm text-muted">
          <MapPin size={14} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{e.location}</span>
        </p>
      ) : null}
      {!editable && e.description ? (
        <p className="max-h-40 overflow-y-auto whitespace-pre-line text-ui-sm text-muted">
          {e.description}
        </p>
      ) : null}
      <p className="flex items-center justify-between gap-2 text-meta text-faint">
        <span className="truncate">{e.sourceName}</span>
        {e.link ? (
          <a
            href={e.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-link hover:underline"
          >
            In Google öffnen
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </a>
        ) : null}
      </p>
      <EventLinksSection event={e} />
      <EventMovePanel event={e} />
      {editable ? <EventDeleteButton event={e} /> : null}
    </div>
  );
}

/** Termin aus Google: Farbbalken links, Uhrzeit, Titel; Klick öffnet das Detail. */
export function EventChip({
  item,
  variant,
  className,
}: {
  item: EventItem;
  variant: ChipVariant;
  className?: string;
}) {
  const e = item.event;
  const time = eventTimeLabel(item);
  const zero = !e.allDay && e.startMinutes === e.endMinutes && e.date === e.endDate;
  // #68: verknüpfte Notizen und Aufgaben
  const counts = useEventLinkCounts(e);
  const countsLabel = eventLinkCountsLabel(counts);
  const label = `${e.title}, ${time}, ${e.sourceName}${countsLabel ? `, verknüpft: ${countsLabel}` : ""}`;
  const { eventEdit } = useCalendar();
  const editable = e.google?.editable === true && e.google.etag !== "";
  // #68: „Im Kalender öffnen“ aus Notiz/Aufgabe (`?termin=<Termin-ID>`) öffnet das Termin-Fenster
  const focus = useSearchParams().get("termin");
  const openAtStart = focus !== null && e.google?.eventId === focus && item.date === e.date;
  // Entf (am Mac auch ⌫) am gewählten Termin löscht ihn – mit Rückgängig, ohne Rückfrage
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editable && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      eventEdit.remove(e);
    }
  };
  const trigger =
    variant === "chip" || variant === "compact" ? (
      <button
        type="button"
        data-calendar-item={item.id}
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(CHIP, "hover:bg-surface-2", variant === "compact" && "min-h-6", className)}
      >
        <CalendarDot color={e.color} className="size-2" />
        {!e.allDay ? (
          <span className="shrink-0 text-faint tabular-nums">
            {minutesToTime(item.segment.from)}
          </span>
        ) : null}
        <span className="truncate">{e.title}</span>
      </button>
    ) : variant === "timeline" ? (
      <button
        type="button"
        data-calendar-item={item.id}
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(TIMELINE, className)}
      >
        <span className="truncate text-ui">{e.title}</span>
        {e.location ? (
          <span className="min-w-0 truncate text-meta text-faint">· {e.location}</span>
        ) : null}
        {!e.busy ? <span className="shrink-0 text-meta text-faint">· frei</span> : null}
        <EventLinkMarks counts={counts} className="ml-auto" />
      </button>
    ) : variant === "block" ? (
      <button
        type="button"
        data-calendar-item={item.id}
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(
          BLOCK,
          "border-border border-l-2 bg-surface-2 hover:bg-surface",
          CALENDAR_BORDER[e.color],
          zero && "h-auto border-t-2 border-l-0 py-0 [&>span:last-child]:hidden",
          !e.busy && "border-dashed",
          className,
        )}
      >
        <span className="truncate font-medium">{e.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-faint tabular-nums">
          <span className="truncate">
            {time}
            {e.location ? ` · ${e.location}` : ""}
          </span>
          <EventLinkMarks counts={counts} compact />
        </span>
      </button>
    ) : (
      <button
        type="button"
        data-calendar-item={item.id}
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(
          "group/ev flex min-h-9 w-full min-w-0 items-start gap-2 rounded-control px-1.5 py-1 text-left transition-colors hover:bg-surface-2",
          className,
        )}
      >
        <span
          aria-hidden
          className={cn("mt-1 h-3.5 w-1 shrink-0 rounded-full", CALENDAR_BG[e.color])}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-ui">{e.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 truncate text-meta text-faint tabular-nums">
            {time}
            {e.location ? <span className="truncate">· {e.location}</span> : null}
            <EventLinkMarks counts={counts} />
          </span>
        </span>
      </button>
    );
  const popover = (
    <Popover.Root defaultOpen={openAtStart}>
      <Popover.Trigger asChild>
        {editable ? <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger> : trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          collisionPadding={12}
          className="z-50 rounded-card border border-border bg-surface p-4 text-fg shadow-float outline-none data-[state=open]:animate-pop-in"
        >
          <EventDetail item={item} />
          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  // Rechtsklick: Löschen (nur änderbare Termine – sonst gibt es nichts anzubieten)
  if (!editable) return popover;
  return (
    <ContextMenuRoot modal={false}>
      {popover}
      <ContextMenuContent aria-label={`Termin „${e.title}“`}>
        {e.link ? (
          <ContextMenuItem onSelect={() => window.open(e.link ?? "", "_blank", "noopener")}>
            <ExternalLink aria-hidden />
            In Google öffnen
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem variant="danger" shortcut="Entf" onSelect={() => eventEdit.remove(e)}>
          <Trash2 aria-hidden />
          {e.google?.recurringEventId ? "Nur diesen Termin löschen" : "Löschen"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}

/* ------------------------------------------------------------------ */
/* Fristen und Rückblick-Tage                                         */
/* ------------------------------------------------------------------ */

/** Meilenstein (Fahne) bzw. Projekt-Zieldatum (Ziel) – Link ins Projekt; erledigt gedämpft. */
export function DeadlineChip({
  item,
  variant,
  warn,
}: {
  item: Extract<CalendarItem, { kind: "milestone" | "target" }>;
  variant: ChipVariant;
  /** Frist an einem vollen Tag */
  warn?: boolean;
}) {
  const Icon = item.kind === "milestone" ? Flag : Goal;
  const project = item.project;
  const title =
    item.kind === "milestone"
      ? item.milestone.title.trim() || "Meilenstein"
      : project.title.trim() || "Ohne Titel";
  const sub = item.kind === "milestone" ? project.title.trim() || "Ohne Titel" : "Projektziel";
  return (
    <Link
      href={appPath.project(project.id)}
      data-calendar-item={item.id}
      title={`${item.kind === "milestone" ? "Meilenstein" : "Projektziel"}: ${title} (${sub})`}
      className={cn(
        variant === "row"
          ? "flex min-h-7 w-full min-w-0 items-center gap-2 rounded-control px-1.5"
          : CHIP,
        "hover:bg-surface-2",
        item.done ? "text-faint" : warn ? "text-warning" : "text-fg",
      )}
    >
      <Icon
        size={variant === "row" ? 14 : 11}
        strokeWidth={1.75}
        aria-hidden
        className={cn("shrink-0", item.done ? "text-faint" : warn ? "text-warning" : "text-muted")}
      />
      <span
        className={cn("truncate", variant === "row" && "text-ui-sm", item.done && "line-through")}
      >
        {title}
      </span>
      {variant === "row" ? <span className="truncate text-meta text-faint">{sub}</span> : null}
      <span className="sr-only">
        ({item.kind === "milestone" ? "Meilenstein" : "Projektziel"}
        {warn ? ", voller Tag" : ""})
      </span>
    </Link>
  );
}

/** Rückblick-Tag: Sonntag Wochenrückblick, Monatsletzter Monatsrückblick – leise, als Link. */
export function RecapChip({
  item,
  variant,
}: {
  item: Extract<CalendarItem, { kind: "recap" }>;
  variant: ChipVariant;
}) {
  const label = item.recapKind === "woche" ? "Wochenrückblick" : "Monatsrückblick";
  const done = item.recap?.closed_at !== null && item.recap !== null;
  return (
    <Link
      href={
        item.recap
          ? appPath.recap(item.recap.id)
          : appPath.recapPeriod(item.recapKind, item.periodStart)
      }
      data-calendar-item={item.id}
      className={cn(
        variant === "row"
          ? "flex min-h-7 w-full min-w-0 items-center gap-2 rounded-control px-1.5"
          : CHIP,
        "text-faint hover:bg-surface-2 hover:text-muted",
      )}
    >
      <History
        size={variant === "row" ? 14 : 11}
        strokeWidth={1.5}
        aria-hidden
        className={cn("shrink-0", done && "text-success")}
      />
      <span className={cn("truncate", variant === "row" && "text-ui-sm")}>{label}</span>
    </Link>
  );
}

/** Ein beliebiger Eintrag in der passenden Form. */
export function CalendarChip({
  item,
  variant,
  warn,
  className,
}: {
  item: CalendarItem;
  variant: ChipVariant;
  warn?: boolean;
  className?: string;
}) {
  switch (item.kind) {
    case "task":
      return <TaskChip item={item} variant={variant} className={className} />;
    case "event":
      return <EventChip item={item} variant={variant} className={className} />;
    case "preview":
      return <PreviewChip item={item} variant={variant} />;
    case "milestone":
    case "target":
      return <DeadlineChip item={item} variant={variant} warn={warn} />;
    case "recap":
      return <RecapChip item={item} variant={variant} />;
  }
}
