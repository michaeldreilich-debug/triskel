"use client";

/**
 * Datenbank-Ansicht „Kalender“ (S2c): derselbe `MonthView` wie /kalender, gefüllt mit den Zeilen,
 * die Filter, Suche und Bereichs-Schalter der Datenbank übrig lassen – Aufgaben nach Fälligkeit/
 * Plan/Fokus, Projekte als Fristen samt ihren Meilensteinen. Keine Google-Termine und keine
 * Rückblick-Tage (das ist Sache der Kalender-Seite). ‹ Heute › blättert den Monat, ein Klick auf
 * einen Tag öffnet ihn in /kalender; Verschieben über ⋯/Rechtsklick wie überall mit Rückgängig.
 */
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProjectRow } from "@/features/projects/types";
import type { TaskContext } from "@/features/tasks/components/task-item";
import { useTaskData } from "@/features/tasks/hooks";
import type { TaskRow } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { berlinDate, type IsoDate } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import { buildCalendarDays, periodLabel, stepDate, viewRange } from "../model";
import { CalendarProvider } from "./calendar-context";
import { MonthView } from "./views";

/** Was eine Datenbank in den Kalender gibt (nach ihren Filtern). */
export interface DatabaseCalendarInput {
  tasks?: TaskRow[];
  projects?: ProjectRow[];
}

export function DatabaseCalendar({
  input,
  label,
}: {
  input: DatabaseCalendarInput;
  /** „Aufgaben“ – für die Beschriftung der Region */
  label: string;
}) {
  const router = useRouter();
  const data = useTaskData();
  const area = useUi((s) => s.area);
  // Datum erst im Browser (der Server kennt die Uhr des Geräts nicht)
  const [today, setToday] = useState<IsoDate | null>(null);
  useEffect(() => setToday(berlinDate()), []);
  const [picked, setPicked] = useState<IsoDate | null>(null);
  const date = picked ?? today;
  const range = useMemo(() => viewRange("monat", date ?? "2000-01-01"), [date]);
  const tasks = input.tasks;
  const projects = input.projects;
  const allMilestones = data.ctx.milestones;
  const days = useMemo(() => {
    const ids = new Set((projects ?? []).map((p) => p.id));
    return buildCalendarDays({
      range,
      today: date ?? "2000-01-01",
      events: [],
      tasks: tasks ?? [],
      projects: projects ?? [],
      milestones: projects ? allMilestones.filter((m) => ids.has(m.project_id)) : [],
      recaps: [],
      recapDays: false,
      // Bereich und Filter hat die Datenbank schon angewandt
      area: null,
      filters: { events: false, tasks: true, done: true, projectId: null },
    }).days;
  }, [range, date, tasks, projects, allMilestones]);
  const ctx = useMemo<TaskContext>(() => ({ ...data.ctx, today: date ?? "" }), [data.ctx, date]);
  if (!date || !today) return null;
  const activeArea = area && data.ctx.areas.some((a) => a.id === area) ? area : null;
  return (
    <CalendarProvider ctx={ctx} today={today} area={activeArea} projectId={null}>
      <section aria-label={`Kalender: ${label}`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Voriger Monat"
              onClick={() => setPicked(stepDate("monat", date, -1))}
            >
              <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPicked(null)}
              disabled={date.slice(0, 7) === today.slice(0, 7)}
            >
              Heute
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Nächster Monat"
              onClick={() => setPicked(stepDate("monat", date, 1))}
            >
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
            </Button>
          </div>
          <h2 className="heading text-body-lg/snug">{periodLabel("monat", date)}</h2>
          <Link
            href={appPath.calendar(date, "monat")}
            className="ml-auto inline-flex items-center gap-1 text-ui-sm text-muted hover:text-fg"
          >
            Im Kalender öffnen
            <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
        <MonthView
          days={days}
          month={date.slice(0, 7)}
          onPickDay={(day) => router.push(appPath.calendar(day, "tag"))}
        />
      </section>
    </CalendarProvider>
  );
}
