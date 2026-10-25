"use client";

import { Check, FilePen, FilePlus, Flag, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTaskPeek } from "@/features/tasks/peek";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import type { DayEntry, DayEntryKind } from "../model";

const KINDS: Record<DayEntryKind, { icon: LucideIcon; label: string; className: string }> = {
  done: { icon: Check, label: "erledigt", className: "text-success" },
  milestone: { icon: Flag, label: "Meilenstein erreicht", className: "text-success" },
  note_new: { icon: FilePlus, label: "Notiz angelegt", className: "text-muted" },
  note_edit: { icon: FilePen, label: "Notiz bearbeitet", className: "text-faint" },
};

/**
 * Tagesverlauf als Zeitleiste (Muster 6, E24): senkrechte Linie mit Punkten, je Eintrag Uhrzeit,
 * Art als Symbol (erledigt, Meilenstein, Notiz neu/bearbeitet) und Titel als Link.
 */
export function DayTimeline({
  entries,
  label,
  className,
}: {
  entries: DayEntry[];
  label: string;
  className?: string;
}) {
  const peek = useTaskPeek();
  const hrefFor = (entry: DayEntry) => {
    if (entry.kind === "done") return peek.hrefFor(entry.id);
    if (entry.kind === "milestone")
      return entry.projectId ? appPath.project(entry.projectId) : null;
    return appPath.note(entry.id);
  };
  return (
    <ol aria-label={label} className={cn("relative flex flex-col", className)}>
      {/* senkrechte Linie durch die Punkte (Mitte der zweiten Spalte: 2,75 rem + 0,625 rem Abstand
          + 7 px; in rem, damit sie bei jeder Schriftgröße durch die Punkte läuft, M3-4) */}
      {entries.length > 1 ? (
        <span
          aria-hidden
          className="absolute top-5 bottom-5 left-[calc(3.375rem+6.5px)] w-px bg-border-strong"
        />
      ) : null}
      {entries.map((entry) => {
        const kind = KINDS[entry.kind];
        const href = hrefFor(entry);
        const title = entry.title.trim() || "Ohne Titel";
        return (
          <li
            key={`${entry.kind}-${entry.id}`}
            className="grid min-h-11 grid-cols-[2.75rem_14px_minmax(0,1fr)] items-center gap-2.5 md:min-h-9"
          >
            <span className="text-ui-sm text-faint tabular-nums">{entry.time}</span>
            <span
              aria-hidden
              className={cn(
                "relative z-10 size-2.5 justify-self-center rounded-full border-[1.5px]",
                entry.kind === "done" || entry.kind === "milestone"
                  ? "border-success bg-success"
                  : "border-faint bg-bg",
              )}
            />
            <span className="relative flex min-w-0 items-center gap-2">
              <kind.icon
                size={14}
                strokeWidth={1.5}
                aria-hidden
                className={cn("shrink-0", kind.className)}
              />
              {href ? (
                <Link
                  href={href}
                  scroll={false}
                  className="min-w-0 truncate text-ui text-muted hover:text-fg hover:underline"
                >
                  {title}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-ui text-muted">{title}</span>
              )}
              <span className="sr-only">({kind.label})</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
