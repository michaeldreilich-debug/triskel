"use client";

import { useCallback, useEffect, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { SummaryLine, type SummaryPart } from "@/components/ui/summary-line";
import { useAreas } from "@/features/areas/api";
import { areaShortcuts, useCapture } from "@/features/inbox/capture";
import { berlinDate } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import { useTaskActions, useTasks } from "../api";
import { useTaskPeek } from "../peek";
import type { TaskRow } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskDatabase } from "./task-database";

/** Zeile unter dem Titel (Muster 1): überfällig und heute fällig (offene Aufgaben). */
export function taskSummary(tasks: TaskRow[], today: string): SummaryPart[] {
  const open = tasks.filter((t) => !t.deleted_at && t.status !== "erledigt" && t.due_date);
  const overdue = open.filter((t) => (t.due_date ?? "") < today).length;
  const dueToday = open.filter((t) => t.due_date === today).length;
  const parts: SummaryPart[] = [];
  if (overdue) parts.push({ text: `${overdue} überfällig`, tone: "danger" });
  if (dueToday) parts.push({ text: `${dueToday} heute fällig` });
  return parts.length ? parts : [{ text: "Nichts überfällig" }];
}

/** Aufgaben (B5/B6): schnell anlegen, darunter die Datenbank-Ansicht (Liste, Tabelle, Board). */
export function TasksPage() {
  const area = useUi((s) => s.area);
  const areas = useAreas();
  const actions = useTaskActions();
  const capture = useCapture();
  const peek = useTaskPeek();
  const tasks = useTasks();
  const [count, setCount] = useState<{ shown: number; total: number } | null>(null);
  const onCount = useCallback((shown: number, total: number) => setCount({ shown, total }), []);
  const activeArea = area && (areas.data ?? []).some((a) => a.id === area) ? area : null;
  // erst im Browser (Datum in Europe/Berlin)
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(berlinDate()), []);
  const inArea = (tasks.data ?? []).filter((t) => !activeArea || t.area_id === activeArea);

  return (
    <Page>
      <PageHeader
        title="Aufgaben"
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
        summary={
          tasks.data && today ? (
            <SummaryLine parts={taskSummary(inArea, today)} data-testid="tasks-summary" />
          ) : null
        }
      />
      <QuickAdd
        className="max-w-page"
        onSubmit={(text, { open }) => {
          // Kürzel wie in der Schnellerfassung; ohne Kürzel: gewählter Bereich, sonst Inbox
          const result = capture.parse(text);
          if (!result.title) return;
          const areaId = result.areaId ?? activeArea;
          const task = actions.create({
            title: result.title,
            area_id: areaId,
            project_id: result.projectId,
            in_inbox: !areaId && !result.projectId,
          });
          if (open) peek.open(task.id);
        }}
        hint={`${areaShortcuts(capture.areas)} @Projekt ordnen zu.${activeArea ? "" : " Ohne Bereich landet die Aufgabe in der Inbox."}`}
      />
      <TaskDatabase newTaskArea={activeArea} onCount={onCount} />
    </Page>
  );
}
