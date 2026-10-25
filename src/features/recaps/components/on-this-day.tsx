"use client";

import { FileText, Folder, History } from "lucide-react";
import Link from "next/link";
import { appPath } from "@/lib/app-links";
import { formatDateShort, formatRange } from "@/lib/dates";
import { monthsAgoLabel, type OnThisDayGroup, recapTitle } from "../model";

/**
 * „An diesem Tag“ (E24): was vor 1, 3 und 12 Monaten entstand – Notizen, Projekte, Rückblicke,
 * erledigte Aufgaben als Zahl. Leere Zeiträume fallen weg (wenig Rauschen).
 */
export function OnThisDayList({ groups, label }: { groups: OnThisDayGroup[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-4">
      {groups.map((group) => (
        <li key={group.months} className="flex min-w-0 flex-col gap-1.5">
          <p className="flex flex-wrap items-baseline gap-x-2 text-ui-sm">
            <span className="font-medium">{monthsAgoLabel(group.months)}</span>
            <span className="text-meta text-faint tabular-nums">
              {group.start === group.end
                ? formatDateShort(group.start)
                : formatRange(group.start, group.end)}
            </span>
          </p>
          <ul className="flex flex-col">
            {group.recaps.map((recap) => (
              <Row
                key={recap.id}
                href={appPath.recap(recap.id)}
                icon={<History size={14} strokeWidth={1.5} aria-hidden />}
                title={recapTitle(recap)}
              />
            ))}
            {group.projects.map((project) => (
              <Row
                key={project.id}
                href={appPath.project(project.id)}
                icon={<Folder size={14} strokeWidth={1.5} aria-hidden />}
                title={project.title.trim() || "Ohne Titel"}
                hint="Projekt angelegt"
              />
            ))}
            {group.notes.map((note) => (
              <Row
                key={note.id}
                href={appPath.note(note.id)}
                icon={<FileText size={14} strokeWidth={1.5} aria-hidden />}
                title={note.title.trim() || "Ohne Titel"}
              />
            ))}
          </ul>
          {group.tasksDone > 0 ? (
            <p className="text-meta text-faint">
              {group.tasksDone === 1
                ? "1 Aufgabe erledigt"
                : `${group.tasksDone} Aufgaben erledigt`}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Row({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <li className="flex min-h-11 min-w-0 items-center gap-2 text-muted md:min-h-8">
      <span className="shrink-0 text-faint">{icon}</span>
      <Link href={href} className="min-w-0 truncate text-ui hover:text-fg hover:underline">
        {title}
      </Link>
      {hint ? <span className="shrink-0 text-meta text-faint">{hint}</span> : null}
    </li>
  );
}
