"use client";

import { CircleCheck, PenLine } from "lucide-react";
import Link from "next/link";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import type { RecapRow } from "../types";

/** Zeile eines geschriebenen Rückblicks: Status-Symbol, Titel, Zeitraum + Themen, Werte. */
export function RecapRowLink({
  recap,
  title,
  range,
}: {
  recap: RecapRow;
  title: string;
  range: string;
}) {
  const closed = recap.closed_at !== null;
  const values = [
    recap.mood !== null ? `Stimmung ${recap.mood}` : null,
    recap.energy !== null ? `Energie ${recap.energy}` : null,
    recap.stats ? `${recap.stats.tasksDone} erledigt` : null,
  ].filter(Boolean);
  return (
    <li className="border-b border-border">
      <Link
        href={appPath.recap(recap.id)}
        className="grid min-h-12 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 py-1.5 transition-colors hover:bg-surface-2/50"
      >
        {closed ? (
          <CircleCheck size={16} strokeWidth={1.5} aria-hidden className="text-success" />
        ) : (
          <PenLine size={16} strokeWidth={1.5} aria-hidden className="text-muted" />
        )}
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <span className="text-ui font-medium">{title}</span>
          <span className="truncate text-meta text-faint tabular-nums">
            {range}
            {recap.themes.length > 0 ? ` · ${recap.themes.map((t) => `#${t}`).join(" ")}` : ""}
          </span>
        </div>
        <span
          className={cn(
            "flex flex-col items-end gap-0.5 text-meta tabular-nums sm:flex-row sm:gap-3",
            closed ? "text-faint" : "text-muted",
          )}
        >
          {values.length ? <span>{values.join(" · ")}</span> : null}
          <span>{closed ? "abgeschlossen" : "offen"}</span>
        </span>
      </Link>
    </li>
  );
}
