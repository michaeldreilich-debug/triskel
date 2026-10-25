"use client";

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ContextMenuContent, ContextMenuRoot, ContextMenuTrigger } from "@/components/ui/menu";
import { useMediaQuery } from "@/features/tasks/peek";
import { cn } from "@/lib/cn";
import type { RowGroup } from "../engine";

export interface BoardViewProps<R extends { id: string }> {
  groups: RowGroup<R>[];
  renderCard: (row: R) => React.ReactNode;
  /** Karte in eine andere Spalte gezogen */
  onMove: (row: R, toKey: string) => void;
  contextMenu?: (row: R) => React.ReactNode;
  /** „+ Neu“ unter einer Spalte (null = nicht anbieten) */
  onAdd?: ((key: string) => void) | null;
  canAdd?: (key: string) => boolean;
  /** Karten je Spalte bis „+ N weitere“ */
  limit?: (key: string) => number;
  groupDecor?: (key: string) => React.ReactNode;
  label: string;
}

// Zeiger zuerst (genau unter dem Finger/der Maus), sonst Überlappung
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * Board (B6): Spalten = Werte eines Feldes (z. B. Status). Ziehen mit Maus (ab 6 px) oder
 * Finger (lange drücken, 200 ms – kurzes Wischen scrollt die Spalten) ändert den Wert.
 */
export function BoardView<R extends { id: string }>({
  groups,
  renderCard,
  onMove,
  contextMenu,
  onAdd,
  canAdd,
  limit,
  groupDecor,
  label,
}: BoardViewProps<R>) {
  const [active, setActive] = useState<R | null>(null);
  // Rechtsklick-Menü nur mit Maus: auf Touch-Geräten heißt langes Drücken „ziehen“
  const finePointer = useMediaQuery("(pointer: fine)");
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const groupOf = (id: string) => groups.find((g) => g.rows.some((r) => r.id === id))?.key;

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActive(groups.flatMap((g) => g.rows).find((r) => r.id === id) ?? null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const row = active;
    setActive(null);
    const toKey = event.over?.data.current?.key;
    if (!row || typeof toKey !== "string") return;
    if (groupOf(row.id) !== toKey) onMove(row, toKey);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      // automatisch weiterscrollen erst ganz am Rand: der angeschnittene Nachbar bleibt Ziel
      autoScroll={{ threshold: { x: 0.08, y: 0.1 } }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Zum Verschieben lange drücken bzw. mit der Maus ziehen. Per Tastatur: Rechtsklick-Menü (Umschalt + F10).",
        },
      }}
    >
      <section
        aria-label={label}
        className="-mx-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:snap-none md:px-0"
      >
        {groups.map((group) => (
          <BoardColumn
            key={group.key || "leer"}
            group={group}
            renderCard={renderCard}
            contextMenu={finePointer ? contextMenu : undefined}
            activeId={active?.id ?? null}
            onAdd={onAdd && (canAdd?.(group.key) ?? true) ? () => onAdd(group.key) : null}
            limit={limit?.(group.key) ?? 50}
            decor={groupDecor?.(group.key)}
          />
        ))}
      </section>
      <DragOverlay dropAnimation={null}>
        {active ? <div className="cursor-grabbing shadow-float">{renderCard(active)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn<R extends { id: string }>({
  group,
  renderCard,
  contextMenu,
  activeId,
  onAdd,
  limit,
  decor,
}: {
  group: RowGroup<R>;
  renderCard: (row: R) => React.ReactNode;
  contextMenu?: (row: R) => React.ReactNode;
  activeId: string | null;
  onAdd: (() => void) | null;
  limit: number;
  decor?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `spalte:${group.key}`,
    data: { key: group.key },
  });
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.rows : group.rows.slice(0, limit);
  const hidden = group.rows.length - visible.length;
  return (
    <section
      ref={setNodeRef}
      aria-label={`${group.label} (${group.rows.length})`}
      data-column={group.key}
      className={cn(
        "flex w-[min(80vw,288px)] shrink-0 snap-start flex-col gap-2 rounded-card border border-border bg-surface/40 p-2 transition-colors lg:w-auto lg:min-w-60 lg:flex-1",
        isOver && "border-border-strong bg-surface-2",
      )}
    >
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-2.5 py-0.5 text-ui-sm">
          {decor}
          {group.label}
        </span>
        <span className="text-meta text-faint tabular-nums">{group.rows.length}</span>
      </div>
      <ul className="flex min-h-16 flex-col gap-2">
        {visible.map((row) => (
          <li key={row.id}>
            <DraggableCard row={row} dimmed={row.id === activeId} contextMenu={contextMenu}>
              {renderCard(row)}
            </DraggableCard>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="min-h-11 rounded-control px-2 text-left text-ui-sm text-faint hover:bg-surface-2 hover:text-fg md:min-h-8"
        >
          + {hidden} weitere
        </button>
      ) : null}
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-left text-ui-sm text-faint hover:bg-surface-2 hover:text-fg md:min-h-8"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden />
          Neu
        </button>
      ) : null}
    </section>
  );
}

function DraggableCard<R extends { id: string }>({
  row,
  dimmed,
  contextMenu,
  children,
}: {
  row: R;
  dimmed: boolean;
  contextMenu?: (row: R) => React.ReactNode;
  children: React.ReactNode;
}) {
  // nur die Zeiger-Listener: role="button" von dnd-kit würde Link und Checkbox verschachteln
  const { setNodeRef, listeners } = useDraggable({ id: row.id });
  const card = (
    <div
      ref={setNodeRef}
      {...listeners}
      data-card-id={row.id}
      className={cn("touch-manipulation", dimmed && "opacity-40")}
    >
      {children}
    </div>
  );
  if (!contextMenu) return card;
  return (
    <ContextMenuRoot modal={false}>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>{contextMenu(row)}</ContextMenuContent>
    </ContextMenuRoot>
  );
}
