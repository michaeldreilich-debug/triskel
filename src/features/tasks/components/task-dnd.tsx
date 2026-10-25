"use client";

/**
 * Aufgaben per Ziehen ablegen (#89, #90), dnd-kit wie im Kalender (`calendar-dnd.tsx`): ein
 * `TaskDndProvider` um die ganze Shell (Seite UND Seitenpanels liegen so im selben Kontext),
 * `TaskDragSource` macht eine Aufgabe ziehbar, `TaskDropZone` nimmt sie an (oder lehnt sie mit
 * Hinweis ab). Maus ab 6 px (Klick öffnet weiter das Panel), Finger nach 200 ms (kurzes Wischen
 * scrollt). Ohne Maus bleibt die jeweilige Auswahl – dieser Baustein ersetzt sie nie.
 */
import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { TaskCheck } from "@/components/ui/task-check";
import { cn } from "@/lib/cn";
import { type TaskRow, taskTitle } from "../types";

/**
 * Nur Treffer unter dem Zeiger (U-7): Loslassen in der Lücke neben einer Ablagefläche legt nichts
 * ab – vorher zählte jede Überschneidung der Zugkarte. Ohne Zeigerposition (Tastatur) wie bisher
 * die größte Überschneidung.
 */
export const taskCollision: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return rectIntersection(args);
  return pointerWithin(args);
};

/** Maus ab 6 px, Finger nach 200 ms Halten (wie im Kalender). */
export function useTaskSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
}

/** Die Karte, die beim Ziehen am Zeiger hängt. */
export function TaskDragCard({ task }: { task: TaskRow }) {
  return (
    <div
      data-drag-overlay="task"
      className="flex h-8 max-w-56 cursor-grabbing items-center gap-2 rounded-control border border-border bg-surface px-2 text-ui shadow-float"
    >
      <TaskCheck status={task.status} priority={task.priority} tabIndex={-1} />
      <span className="truncate">{taskTitle(task)}</span>
    </div>
  );
}

/** Eine Ablagefläche: nimmt Aufgaben an (`accepts`) oder lehnt sie ab (`onReject` mit Hinweis). */
interface Zone {
  accepts: (task: TaskRow) => boolean;
  onDropTask: (task: TaskRow) => void;
  onReject?: (task: TaskRow) => void;
}

interface Registry {
  register: (id: string, zone: { current: Zone }) => () => void;
}

const RegistryContext = createContext<Registry | null>(null);
const ActiveContext = createContext<TaskRow | null>(null);
const ZoneCountContext = createContext(0);

/** Die Aufgabe, die gerade gezogen wird (nur Aufgaben aus `TaskDragSource`). */
export function useDraggedTask(): TaskRow | null {
  return useContext(ActiveContext);
}

/** Gibt es gerade eine Seite, auf die man eine Aufgabe ziehen kann? (zeigt den Griff im Panel) */
export function useHasTaskDropZones(): boolean {
  return useContext(ZoneCountContext) > 0;
}

const announcements: Announcements = {
  onDragStart: () => "Aufgabe aufgenommen.",
  onDragOver: ({ over }) => (over ? "Über einer Ablagefläche." : "Nicht über einer Ablagefläche."),
  onDragEnd: ({ over }) => (over ? "Aufgabe abgelegt." : "Aufgabe zurückgelegt."),
  onDragCancel: () => "Ziehen abgebrochen.",
};

export function TaskDndProvider({ children }: { children: React.ReactNode }) {
  const sensors = useTaskSensors();
  const zones = useRef(new Map<string, { current: Zone }>());
  const [count, setCount] = useState(0);
  const [active, setActive] = useState<TaskRow | null>(null);

  const registry = useMemo<Registry>(
    () => ({
      register: (id, zone) => {
        zones.current.set(id, zone);
        setCount(zones.current.size);
        return () => {
          if (zones.current.get(id) === zone) zones.current.delete(id);
          setCount(zones.current.size);
        };
      },
    }),
    [],
  );

  const onDragStart = (event: DragStartEvent) => {
    setActive((event.active.data.current?.taskDrag as TaskRow | undefined) ?? null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const dragged = active;
    setActive(null);
    if (!dragged || !event.over) return;
    const zone = zones.current.get(String(event.over.id))?.current;
    if (!zone) return;
    if (zone.accepts(dragged)) zone.onDropTask(dragged);
    else zone.onReject?.(dragged);
  };

  return (
    <RegistryContext.Provider value={registry}>
      <ZoneCountContext.Provider value={count}>
        <ActiveContext.Provider value={active}>
          <DndContext
            sensors={sensors}
            collisionDetection={taskCollision}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActive(null)}
            autoScroll={{ threshold: { x: 0.08, y: 0.1 } }}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable:
                  "Zum Ablegen lange drücken bzw. mit der Maus ziehen. Ohne Maus: die Auswahl neben der Fläche benutzen.",
              },
            }}
          >
            {children}
            <DragOverlay dropAnimation={null}>
              {active ? <TaskDragCard task={active} /> : null}
            </DragOverlay>
          </DndContext>
        </ActiveContext.Provider>
      </ZoneCountContext.Provider>
    </RegistryContext.Provider>
  );
}

/**
 * Ziehbare Aufgabe: nur die Zeiger-Listener (kein role="button", Links und Häkchen bleiben echt).
 * `scope` hält die Kennung eindeutig, wenn dieselbe Aufgabe an zwei Stellen steht.
 */
export function TaskDragSource({
  task,
  scope,
  disabled,
  className,
  children,
  ...props
}: {
  task: TaskRow;
  scope: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const off = disabled || task.status === "erledigt";
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `taskdrag:${scope}:${task.id}`,
    data: { taskDrag: task },
    disabled: off,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...props}
      data-task-drag={off ? undefined : task.id}
      className={cn("touch-manipulation", isDragging && "opacity-40", className)}
    >
      {children}
    </div>
  );
}

/**
 * Ablagefläche. Während jemand eine Aufgabe zieht, zeigt sie, ob sie diese annimmt
 * (`data-drop="bereit"` mit `readyClassName`, unter dem Zeiger `data-drop="ueber"`) oder nicht
 * (`data-drop="nein"`, gedämpft). Ablegen auf einer ablehnenden Fläche ruft `onReject`.
 */
export function TaskDropZone({
  id,
  accepts,
  onDropTask,
  onReject,
  readyClassName = "outline outline-1 outline-dashed outline-border-strong",
  overClassName = "bg-surface-2 outline outline-2 outline-border-strong",
  blockedClassName = "opacity-60",
  className,
  as: Tag = "div",
  children,
  ...props
}: {
  id: string;
  accepts: (task: TaskRow) => boolean;
  onDropTask: (task: TaskRow) => void;
  onReject?: (task: TaskRow) => void;
  readyClassName?: string;
  overClassName?: string;
  blockedClassName?: string;
  className?: string;
  as?: "div" | "section" | "li";
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "children">) {
  const registry = useContext(RegistryContext);
  const dragged = useDraggedTask();
  const { setNodeRef, isOver } = useDroppable({ id });
  const zone = useRef<Zone>({ accepts, onDropTask, onReject });
  zone.current = { accepts, onDropTask, onReject };
  // eintragen, solange die Fläche steht (neu, wenn sich die Kennung ändert)
  useEffect(() => registry?.register(id, zone), [registry, id]);
  const state = !dragged ? undefined : accepts(dragged) ? (isOver ? "ueber" : "bereit") : "nein";
  const Element = Tag as "div";
  return (
    <Element
      ref={setNodeRef}
      data-drop-zone={id}
      data-drop={state}
      className={cn(
        className,
        state === "bereit" && readyClassName,
        state === "ueber" && overClassName,
        state === "nein" && blockedClassName,
      )}
      {...props}
    >
      {children}
    </Element>
  );
}
