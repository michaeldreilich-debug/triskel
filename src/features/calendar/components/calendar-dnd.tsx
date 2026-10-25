"use client";

/**
 * Ziehen im Kalender (S2b, dnd-kit wie im Board): Aufgaben auf einen Tag (Fälligkeit), eine
 * Uhrzeit (Zeitblock) oder zurück in die Einplanen-Spalte (ohne Datum). Google-Termine (N1b, #64)
 * mit Schreibrecht lassen sich auf eine Uhrzeit oder einen Tag ziehen (ganztägige nur auf einen
 * Tag); nur lesbare bleiben fest. Maus ab 6 px, Finger nach 200 ms (kurzes Wischen scrollt).
 */
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MeasuringStrategy,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { createContext, useContext, useState } from "react";
import { toast } from "@/components/ui/toast";
import { TaskDragCard, taskCollision, useTaskSensors } from "@/features/tasks/components/task-dnd";
import type { TaskRow } from "@/features/tasks/types";
import { cn } from "@/lib/cn";
import { berlinTime, type IsoDate } from "@/lib/dates";
import { isMovable } from "../move";
import type { CalendarEvent } from "../types";
import { useCalendar } from "./calendar-context";
import { CalendarDot } from "./calendar-dot";

export type DropTarget =
  /** `zone`: zweite Ablagefläche desselben Tages (ganztägig-Zeile in der Woche), eigene Kennung */
  | { kind: "day"; date: IsoDate; zone?: "allday" }
  | { kind: "slot"; date: IsoDate; minutes: number }
  | { kind: "unschedule" };

export const dropId = (target: DropTarget) =>
  target.kind === "day"
    ? `day:${target.date}${target.zone ? `:${target.zone}` : ""}`
    : target.kind === "slot"
      ? `slot:${target.date}:${target.minutes}`
      : "unschedule";

export function parseDropId(id: string): DropTarget | null {
  if (id === "unschedule") return { kind: "unschedule" };
  const [kind, date, minutes] = id.split(":");
  if (kind === "day" && date) return { kind: "day", date };
  if (kind === "slot" && date && minutes !== undefined) {
    return { kind: "slot", date, minutes: Number(minutes) };
  }
  return null;
}

/**
 * Ziehbare Aufgaben und Termine gibt es nur innerhalb von `CalendarDnd`. Ansonsten (z. B. der
 * Tagesablauf auf Heute) liegen sie im Kontext der Shell (`TaskDndProvider`, #89/#90), der sie
 * nicht kennt – dort bleiben sie fest.
 */
const InsideCalendarDnd = createContext(false);

/** Umschließt die Ansichten und die Einplanen-Spalte; führt das Verschieben mit Rückgängig aus. */
type Active =
  | { kind: "task"; task: TaskRow }
  | { kind: "event"; event: CalendarEvent; fromDate: IsoDate };

export function CalendarDnd({ children }: { children: React.ReactNode }) {
  const { move, eventMove } = useCalendar();
  const [active, setActive] = useState<Active | null>(null);
  const sensors = useTaskSensors();
  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    const task = data?.task as TaskRow | undefined;
    const calendarEvent = data?.calendarEvent as CalendarEvent | undefined;
    if (task) setActive({ kind: "task", task });
    else if (calendarEvent) {
      setActive({
        kind: "event",
        event: calendarEvent,
        fromDate: (data?.segmentDate as IsoDate | undefined) ?? calendarEvent.date,
      });
    } else setActive(null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const dragged = active;
    setActive(null);
    const over = event.over ? parseDropId(String(event.over.id)) : null;
    if (!dragged || !over) return;
    if (dragged.kind === "event") {
      const ev = dragged.event;
      if (over.kind === "day") eventMove.moveToDay(ev, over.date, dragged.fromDate);
      else if (over.kind === "slot") {
        if (ev.allDay) toast("Ganztägige Termine lassen sich nur auf einen anderen Tag ziehen.");
        else eventMove.moveToSlot(ev, over.date, over.minutes);
      }
      return;
    }
    const task = dragged.task;
    if (over.kind === "day") move.moveToDay(task, over.date);
    else if (over.kind === "slot") move.moveToSlot(task, over.date, over.minutes);
    else move.unschedule(task);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={taskCollision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      autoScroll={{ threshold: { x: 0.08, y: 0.1 } }}
      // Ablageflächen bei jeder Bewegung neu messen: Tagesspalten und Halbstunden-Felder liegen
      // dicht, ein Versatz nach einer Layout-Verschiebung träfe sonst den Nachbarn
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Zum Verschieben lange drücken bzw. mit der Maus auf einen Tag oder eine Uhrzeit ziehen. Ohne Maus: Menü „Verschieben auf …“ (Rechtsklick oder ⋯), bei Terminen im Fenster des Termins.",
        },
      }}
    >
      <InsideCalendarDnd.Provider value>{children}</InsideCalendarDnd.Provider>
      <DragOverlay dropAnimation={null}>
        {active?.kind === "task" ? (
          <TaskDragCard task={active.task} />
        ) : active?.kind === "event" ? (
          <div
            data-drag-overlay="event"
            className="flex h-8 max-w-56 cursor-grabbing items-center gap-2 rounded-control border border-border bg-surface px-2 text-ui shadow-float"
          >
            <CalendarDot color={active.event.color} className="size-2" />
            {!active.event.allDay ? (
              <span className="shrink-0 text-faint tabular-nums">
                {berlinTime(active.event.start)}
              </span>
            ) : null}
            <span className="truncate">{active.event.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Ziehbare Aufgabe: nur die Zeiger-Listener (kein role="button", Links und Kreis bleiben echt). */
export function DraggableTask({
  task,
  disabled,
  className,
  children,
}: {
  task: TaskRow;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const inside = useContext(InsideCalendarDnd);
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `task:${task.id}`,
    data: { task },
    disabled: disabled || !inside,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-drag-task={task.id}
      className={cn("touch-manipulation", isDragging && "opacity-40", className)}
    >
      {children}
    </div>
  );
}

/**
 * Ziehbarer Google-Termin (N1b): nur mit Schreibrecht (`isMovable`), sonst bleibt er fest und der
 * Mauszeiger normal. `segmentDate` = der Tag, an dem er gegriffen wurde (bei mehrtägigen
 * ganztägigen Terminen nicht unbedingt der erste).
 */
export function DraggableEvent({
  event,
  segmentDate,
  className,
  children,
}: {
  event: CalendarEvent;
  segmentDate: IsoDate;
  className?: string;
  children: React.ReactNode;
}) {
  const inside = useContext(InsideCalendarDnd);
  const movable = isMovable(event);
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `event:${event.id}:${segmentDate}`,
    data: { calendarEvent: event, segmentDate },
    disabled: !movable || !inside,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-drag-event={movable ? event.uid : undefined}
      data-event-fixed={movable ? undefined : ""}
      className={cn(
        "touch-manipulation",
        movable && "cursor-grab [&_button]:cursor-grab",
        isDragging && "opacity-40",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Ablagefläche (Tag, Uhrzeit, Einplanen-Spalte); `over` hebt sie hervor. */
export function DropZone({
  target,
  className,
  overClassName = "bg-surface-2",
  label,
  children,
  ...props
}: {
  target: DropTarget;
  className?: string;
  overClassName?: string;
  label?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(target) });
  const shared = {
    ref: setNodeRef,
    "data-drop-target": dropId(target),
    className: cn(className, isOver && overClassName),
    ...props,
  };
  if (label) {
    return (
      <section aria-label={label} {...shared}>
        {children}
      </section>
    );
  }
  return <div {...shared}>{children}</div>;
}
