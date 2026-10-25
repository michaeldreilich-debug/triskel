import { Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateShort, type IsoDate } from "@/lib/dates";
import { type AreaColor, AreaDot, Pill } from "./pill";
import { PriorityBadge } from "./status-badge";

export interface KanbanCardProps {
  title: string;
  area?: AreaColor;
  context?: string;
  due?: IsoDate | null;
  overdue?: boolean;
  priority?: 1 | 2 | 3 | null;
  blocked?: boolean;
  className?: string;
}

/** Karte im Board (Drag & Drop folgt in B6). */
export function KanbanCard({
  title,
  area,
  context,
  due,
  overdue,
  priority,
  blocked,
  className,
}: KanbanCardProps) {
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-card border border-border bg-surface p-3",
        className,
      )}
    >
      <h3 className="flex items-start gap-2 text-ui font-medium">
        {blocked ? (
          <Lock
            size={14}
            strokeWidth={1.5}
            className="mt-0.5 shrink-0 text-faint"
            aria-label="Blockiert"
          />
        ) : null}
        <span className={cn(blocked && "text-muted")}>{title}</span>
      </h3>
      {context ? (
        <p className="flex items-center gap-1.5 text-meta text-faint">
          {area ? <AreaDot color={area} /> : null}
          <span className="truncate">{context}</span>
        </p>
      ) : null}
      {due || priority ? (
        <div className="flex items-center justify-between gap-2">
          {due ? (
            <span className={cn("text-meta tabular-nums", overdue ? "text-danger" : "text-faint")}>
              {formatDateShort(due)}
            </span>
          ) : (
            <span />
          )}
          {priority ? <PriorityBadge priority={priority} /> : null}
        </div>
      ) : null}
    </article>
  );
}

export interface GalleryCardProps {
  title: string;
  snippet?: string;
  type?: string;
  date?: string;
  area?: AreaColor;
  selected?: boolean;
  className?: string;
}

/** Karte für Galerie/Notizliste. */
export function GalleryCard({
  title,
  snippet,
  type,
  date,
  area,
  selected,
  className,
}: GalleryCardProps) {
  return (
    <article
      className={cn(
        "flex flex-col gap-1.5 rounded-card border p-3",
        selected ? "border-border bg-surface-2" : "border-transparent hover:bg-surface",
        className,
      )}
    >
      <h3 className="flex items-center gap-2 text-ui font-medium">
        {area ? <AreaDot color={area} /> : null}
        <span className="truncate">{title}</span>
      </h3>
      {snippet ? <p className="line-clamp-2 text-meta text-faint">{snippet}</p> : null}
      {type || date ? (
        <p className="flex items-center gap-2 text-meta text-faint">
          {type ? <Pill>{type}</Pill> : null}
          {date ? <span className="tabular-nums">{date}</span> : null}
        </p>
      ) : null}
    </article>
  );
}
