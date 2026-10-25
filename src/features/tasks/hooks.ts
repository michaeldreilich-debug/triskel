"use client";

import { useMemo } from "react";
import { useAreas } from "@/features/areas/api";
import { useMilestones, useProjects } from "@/features/projects/api";
import { berlinDate } from "@/lib/dates";
import { useDependencies, useTasks } from "./api";
import type { TaskContext } from "./components/task-item";
import { blockedTaskIds } from "./dependencies";
import { isForMe } from "./types";

/**
 * Alles, was Aufgabenlisten brauchen (Aufgaben, Abhängigkeiten, Projekte, Meilensteine, Bereiche)
 * samt Lade- und Fehlerzustand. `today` ist der Berliner Kalendertag beim Rendern.
 * `forMe` (#77): nur Aufgaben des Nutzers – Arbeitsschritte der KI stehen allein im Projekt
 * (Heute, Inbox, Kalender, Wochenreview). Blockiert-Zustände rechnen weiter mit allen.
 */
export function useTaskData({ forMe = false }: { forMe?: boolean } = {}) {
  const tasks = useTasks();
  const deps = useDependencies();
  const projects = useProjects();
  const milestones = useMilestones();
  const areas = useAreas();
  const queries = [tasks, deps, projects, milestones, areas];
  const error = queries.some((q) => q.isError && !q.data);
  const loading = !error && queries.some((q) => q.isPending);

  const allTasks = tasks.data;
  const allDeps = deps.data;
  const blocked = useMemo(() => blockedTaskIds(allTasks ?? [], allDeps ?? []), [allTasks, allDeps]);
  const shown = useMemo(
    () => (forMe ? (allTasks ?? []).filter(isForMe) : allTasks),
    [allTasks, forMe],
  );
  const ctx: TaskContext = {
    projects: projects.data ?? [],
    milestones: milestones.data ?? [],
    areas: areas.data ?? [],
    blocked,
    today: berlinDate(),
  };

  return {
    tasks: shown ?? [],
    deps: allDeps ?? [],
    ctx,
    loading,
    error,
    retry: () => {
      for (const q of queries) void q.refetch();
    },
  };
}
