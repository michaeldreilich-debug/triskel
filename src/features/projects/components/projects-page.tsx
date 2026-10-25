"use client";

import { GanttChart, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button, buttonClasses } from "@/components/ui/button";
import { SummaryLine, type SummaryPart } from "@/components/ui/summary-line";
import { useAreas } from "@/features/areas/api";
import { useTasks } from "@/features/tasks/api";
import type { TaskRow } from "@/features/tasks/types";
import { appPath } from "@/lib/app-links";
import { useUi } from "@/lib/ui-store";
import { useProjectActions, useProjects } from "../api";
import { isStale, MAX_ACTIVE_PER_AREA, overloadedAreas, stuckReasons } from "../rules";
import type { ProjectRow } from "../types";
import { ProjectDatabase, useNow } from "./project-database";

/** Zeile unter dem Titel (Muster 1): aktiv, festgefahren, still, geplant, pausiert. */
export function projectSummary(
  projects: ProjectRow[],
  tasks: TaskRow[],
  now: number,
): SummaryPart[] {
  const live = projects.filter((p) => !p.deleted_at);
  const count = (status: string) => live.filter((p) => p.status === status).length;
  const active = live.filter((p) => p.status === "aktiv");
  const stuck = active.filter((p) => stuckReasons(p, tasks).length > 0).length;
  const stale = active.filter((p) => isStale(p, tasks, now)).length;
  const parts: SummaryPart[] = [];
  if (active.length) parts.push({ text: `${active.length} aktiv` });
  if (stuck) parts.push({ text: `${stuck} festgefahren`, tone: "warning" });
  if (stale) parts.push({ text: `${stale} still`, tone: "warning" });
  if (count("geplant")) parts.push({ text: `${count("geplant")} geplant` });
  if (count("pausiert")) parts.push({ text: `${count("pausiert")} pausiert` });
  if (count("idee"))
    parts.push({ text: count("idee") === 1 ? "1 Idee" : `${count("idee")} Ideen` });
  return parts;
}

/** Projekte (B6/B7): Datenbank-Ansicht, Hinweis bei mehr als 3 aktiven Projekten je Bereich. */
export function ProjectsPage() {
  const router = useRouter();
  const area = useUi((s) => s.area);
  const areas = useAreas();
  const projects = useProjects();
  const tasks = useTasks();
  const actions = useProjectActions();
  const now = useNow();
  const [count, setCount] = useState<{ shown: number; total: number } | null>(null);
  const onCount = useCallback((shown: number, total: number) => setCount({ shown, total }), []);
  const areaList = areas.data ?? [];
  const activeArea = area && areaList.some((a) => a.id === area) ? area : null;
  const overloaded = overloadedAreas(projects.data ?? []).filter(
    (o) => !activeArea || o.areaId === activeArea,
  );

  const inArea = (projects.data ?? []).filter((p) => !activeArea || p.area_id === activeArea);
  const summary = projects.data && tasks.data ? projectSummary(inArea, tasks.data, now) : [];

  const create = () => {
    const areaId = activeArea ?? areaList[0]?.id;
    if (!areaId) return;
    const project = actions.create({ area_id: areaId, status: "idee" });
    router.push(appPath.project(project.id));
  };

  return (
    <Page>
      <PageHeader
        title="Projekte"
        meta={
          <>
            Datenbank
            {count ? (
              <span className="tabular-nums">
                {" "}
                · {count.shown} von {count.total}
              </span>
            ) : null}
          </>
        }
        summary={<SummaryLine parts={summary} data-testid="projects-summary" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={appPath.timeline()} className={buttonClasses("secondary", "md")}>
              <GanttChart size={16} strokeWidth={1.5} aria-hidden />
              Zeitstrahl
            </Link>
            <Button variant="primary" onClick={create} disabled={areaList.length === 0}>
              <Plus size={16} strokeWidth={2} aria-hidden />
              Neues Projekt
            </Button>
          </div>
        }
      />
      {overloaded.map((o) => (
        <p
          key={o.areaId}
          role="status"
          className="rounded-control border border-warning/50 px-3 py-2 text-ui-sm text-warning"
        >
          {areaList.find((a) => a.id === o.areaId)?.name}: {o.count} aktive Projekte – Fokus-Regel:
          höchstens {MAX_ACTIVE_PER_AREA}. Eines pausieren oder abschließen?
        </p>
      ))}
      <ProjectDatabase onCount={onCount} />
    </Page>
  );
}
