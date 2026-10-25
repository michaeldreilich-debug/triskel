"use client";

import { useEffect, useState } from "react";
import { useProjects } from "@/features/projects/api";
import { useNow } from "@/features/projects/components/project-database";
import { useUserSettings } from "@/features/settings/api";
import type { TaskContext } from "@/features/tasks/components/task-item";
import { useTaskData } from "@/features/tasks/hooks";
import { useUi } from "@/lib/ui-store";
import { todayData } from "./select";

/**
 * Die Daten von Heute (B9): Aufgaben des Nutzers (`forMe`), Projekte, Abendzeit und gewählter Bereich
 * zu `todayData`. Die Seite und die Aufgabenspalte zum Wählen (#90) lesen dasselbe, damit beide
 * von denselben Kandidaten und Plätzen sprechen.
 */
export function useTodayModel() {
  const area = useUi((s) => s.area);
  const data = useTaskData({ forMe: true });
  const projects = useProjects();
  const settings = useUserSettings();
  const now = useNow(30_000);
  // Datum und Uhrzeit erst im Browser (der Server kennt Zeitzone/Uhr des Geräts nicht)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const activeArea = area && data.ctx.areas.some((a) => a.id === area) ? area : null;
  const today = todayData({
    tasks: data.tasks,
    blocked: data.ctx.blocked,
    projects: projects.data ?? [],
    area: activeArea,
    now: new Date(now),
    eveningTime: settings.data?.evening_time,
  });
  const ctx: TaskContext = { ...data.ctx, today: today.today };
  const loading = !mounted || data.loading || projects.isPending;
  return { data, projects, now, mounted, activeArea, today, ctx, loading };
}
