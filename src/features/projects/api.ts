"use client";

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSupabase } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import { trashWithUndo } from "@/lib/save-queue/soft-delete";
import { keyAfter, keyBetween } from "@/lib/sort-key";
import { milestonesKey, projectsKey, tasksKey } from "../tasks/api";
import { fetchMilestones, fetchProjects, toProject } from "../tasks/queries";
import type { TaskRow } from "../tasks/types";
import type { ProjectLink } from "./links";
import {
  type ClosingReflection,
  type MilestoneRow,
  type MilestoneWrite,
  type OutcomeItem,
  type ProjectRow,
  type ProjectWrite,
  projectTitle,
} from "./types";

/** Alle Projekte (ohne Papierkorb), auch archivierte – gefiltert wird in den Ansichten. */
export function useProjects() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: projectsKey,
    queryFn: async () =>
      (
        await fetchWithOverlay(queue, "projects", () => fetchProjects(getSupabase()), {
          include: () => true,
        })
      ).map((row) => toProject(row as unknown as Record<string, unknown> & { id: string })),
  });
}

export function useMilestones() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: milestonesKey,
    queryFn: async (): Promise<MilestoneRow[]> =>
      (
        await fetchWithOverlay(queue, "milestones", () => fetchMilestones(getSupabase()), {
          include: () => true,
        })
      ).sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)),
  });
}

/* ------------------------------------------------------------------ */
/* Schreiben (optimistisch, über die Speicher-Warteschlange)          */
/* ------------------------------------------------------------------ */

const nowIso = () => new Date().toISOString();

function projectWriteValues(project: ProjectRow): ProjectWrite {
  return {
    area_id: project.area_id,
    title: project.title,
    status: project.status,
    priority: project.priority,
    start_date: project.start_date,
    target_date: project.target_date,
    why: project.why,
    outcome: project.outcome,
    links: project.links,
    body: project.body,
    body_text: project.body_text,
    next_task_id: project.next_task_id,
    closing_reflection: project.closing_reflection,
    sort: project.sort,
    deleted_at: project.deleted_at,
  };
}

export function createProjectActions(queue: SaveQueue, queryClient: QueryClient) {
  const list = () => queryClient.getQueryData<ProjectRow[]>(projectsKey) ?? [];
  const milestones = () => queryClient.getQueryData<MilestoneRow[]>(milestonesKey) ?? [];
  const patch = (id: string, values: Partial<ProjectRow>) =>
    queryClient.setQueryData<ProjectRow[]>(projectsKey, (old) =>
      old?.map((p) =>
        p.id === id ? { ...p, ...values, updated_at: nowIso(), last_activity_at: nowIso() } : p,
      ),
    );

  const update = (id: string, values: Partial<ProjectWrite>) => {
    patch(id, values);
    // Bereich wechselt → Aufgaben folgen (wie der Trigger projects_area_to_tasks)
    if (values.area_id) {
      queryClient.setQueryData<TaskRow[]>(tasksKey, (old) =>
        old?.map((t) => (t.project_id === id ? { ...t, area_id: values.area_id ?? t.area_id } : t)),
      );
    }
    queue.enqueue({ table: "projects", id, mode: "update", values });
  };

  const patchMilestone = (id: string, values: Partial<MilestoneRow>) =>
    queryClient.setQueryData<MilestoneRow[]>(milestonesKey, (old) =>
      old?.map((m) => (m.id === id ? { ...m, ...values, updated_at: nowIso() } : m)),
    );

  return {
    create(input: Partial<ProjectWrite> & { area_id: string }): ProjectRow {
      const project = toProject({
        title: "",
        status: "idee",
        why: "",
        outcome: [],
        links: [],
        ...(input as Record<string, unknown>),
        id: newId(),
        sort: input.sort ?? keyAfter(list().map((p) => p.sort)),
        last_activity_at: nowIso(),
        deleted_at: null,
      });
      queryClient.setQueryData<ProjectRow[]>(projectsKey, (old) => [...(old ?? []), project]);
      queue.enqueue({
        table: "projects",
        id: project.id,
        mode: "upsert",
        values: { ...projectWriteValues(project) },
      });
      return project;
    },

    update,

    /** Ergebnis-Checkliste „Fertig ist es, wenn …“ ersetzen */
    setOutcome(id: string, outcome: OutcomeItem[]) {
      update(id, { outcome });
    },

    setLinks(id: string, links: ProjectLink[]) {
      update(id, { links });
    },

    /**
     * Abschluss-Ritual (Fokus-Regel 6): drei Antworten speichern und ins Archiv.
     * Wieder aktivieren behält die Antworten.
     */
    close(id: string, reflection: ClosingReflection) {
      update(id, { closing_reflection: reflection, status: "archiv" });
    },

    trash(id: string, onTrashed?: () => void) {
      const project = list().find((p) => p.id === id);
      if (!project) return;
      trashWithUndo(queue, queryClient, {
        table: "projects",
        queryKey: projectsKey,
        row: project,
        message: `„${projectTitle(project)}“ liegt im Papierkorb`,
        onTrashed,
      });
    },

    createMilestone(projectId: string, title: string, dueDate: string | null = null): MilestoneRow {
      const inProject = milestones().filter((m) => m.project_id === projectId);
      const milestone: MilestoneRow = {
        id: newId(),
        project_id: projectId,
        title: title.trim(),
        due_date: dueDate,
        done_at: null,
        sort: keyAfter(inProject.map((m) => m.sort)),
        created_at: nowIso(),
        updated_at: nowIso(),
        deleted_at: null,
      };
      queryClient.setQueryData<MilestoneRow[]>(milestonesKey, (old) => [...(old ?? []), milestone]);
      queue.enqueue({
        table: "milestones",
        id: milestone.id,
        mode: "upsert",
        values: {
          project_id: milestone.project_id,
          title: milestone.title,
          due_date: milestone.due_date,
          done_at: null,
          sort: milestone.sort,
          deleted_at: null,
        },
      });
      return milestone;
    },

    updateMilestone(id: string, values: Partial<MilestoneWrite>) {
      patchMilestone(id, values);
      queue.enqueue({ table: "milestones", id, mode: "update", values });
    },

    /** Meilenstein in der Reihenfolge des Projekts eins nach oben (-1) oder unten (1) */
    moveMilestone(id: string, direction: -1 | 1) {
      const milestone = milestones().find((m) => m.id === id);
      if (!milestone) return;
      const siblings = milestones()
        .filter((m) => m.project_id === milestone.project_id)
        .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
      const index = siblings.findIndex((m) => m.id === id);
      const target = index + direction;
      if (target < 0 || target >= siblings.length) return;
      const [before, after] =
        direction < 0
          ? [siblings[target - 1]?.sort ?? null, siblings[target]?.sort ?? null]
          : [siblings[target]?.sort ?? null, siblings[target + 1]?.sort ?? null];
      const values = { sort: keyBetween(before, after) };
      patchMilestone(id, values);
      queue.enqueue({ table: "milestones", id, mode: "update", values });
    },

    /** erreicht ↔ offen */
    toggleMilestone(id: string) {
      const milestone = milestones().find((m) => m.id === id);
      if (!milestone) return;
      const values = { done_at: milestone.done_at ? null : nowIso() };
      patchMilestone(id, values);
      queue.enqueue({ table: "milestones", id, mode: "update", values });
    },

    trashMilestone(id: string) {
      const milestone = milestones().find((m) => m.id === id);
      if (!milestone) return;
      // Aufgaben verlieren den Meilenstein (wie on delete set null – hier per Soft-Delete im Client)
      trashWithUndo(queue, queryClient, {
        table: "milestones",
        queryKey: milestonesKey,
        row: milestone,
        message: `Meilenstein „${milestone.title || "Ohne Titel"}“ liegt im Papierkorb`,
      });
    },
  };
}

export type ProjectActions = ReturnType<typeof createProjectActions>;

export function useProjectActions(): ProjectActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(() => createProjectActions(queue, queryClient), [queue, queryClient]);
}
