/**
 * Projekte (B7) gegen das Testprojekt: Die Regeln im Client (Fortschritt, festgefahren,
 * 14 Tage still) stimmen mit v_projects überein; Milestones/Projekte über den Persister
 * (nächster Schritt im selben Paket wie die neue Aufgabe); A sieht nichts von B.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { isStale, projectProgress, stuckReasons } from "@/features/projects/rules";
import { fetchProjects, fetchTasks } from "@/features/tasks/queries";
import { createSupabasePersister, type PersisterClient } from "@/lib/save-queue/supabase-persister";
import { runMarker, userClient } from "../support/supabase-node";

const a = userClient(inject("sessionA"));
const b = userClient(inject("sessionB"));
const marker = runMarker();
const persist = createSupabasePersister(() => a as unknown as PersisterClient);
let areaId = "";
const ids = {
  active: crypto.randomUUID(),
  stale: crypto.randomUUID(),
  fresh: crypto.randomUUID(),
  t1: crypto.randomUUID(),
  t2: crypto.randomUUID(),
  t3: crypto.randomUUID(),
  next: crypto.randomUUID(),
};

beforeAll(async () => {
  const { data } = await a.from("areas").select("id").order("sort").limit(1).single();
  areaId = data?.id ?? "";
  expect(areaId).not.toBe("");
});

afterAll(async () => {
  await a.from("tasks").delete().in("id", [ids.t1, ids.t2, ids.t3, ids.next]);
  await a.from("projects").delete().in("id", [ids.active, ids.stale, ids.fresh]);
});

const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000).toISOString();

describe("Regeln im Client = v_projects", () => {
  it("Fortschritt, festgefahren und 14 Tage still", async () => {
    for (const step of [
      a.from("projects").insert(
        [
          {
            id: ids.active,
            area_id: areaId,
            title: `Aktiv ${marker}`,
            status: "aktiv",
            sort: "a0",
          },
          {
            id: ids.stale,
            area_id: areaId,
            title: `Still ${marker}`,
            status: "aktiv",
            sort: "a1",
            outcome: [{ id: "1", text: "Fertig", done: false }],
            last_activity_at: twentyDaysAgo,
            created_at: twentyDaysAgo,
            updated_at: twentyDaysAgo,
          },
        ],
        { defaultToNull: false },
      ),
      a.from("tasks").insert(
        [
          {
            id: ids.t1,
            area_id: areaId,
            project_id: ids.active,
            title: `1 ${marker}`,
            sort: "a0",
            status: "erledigt",
          },
          { id: ids.t2, area_id: areaId, project_id: ids.active, title: `2 ${marker}`, sort: "a1" },
          { id: ids.t3, area_id: areaId, project_id: ids.active, title: `3 ${marker}`, sort: "a2" },
        ],
        { defaultToNull: false },
      ),
    ]) {
      const { error } = await step;
      expect(error, error?.message).toBeNull();
    }
    const [projects, tasks] = await Promise.all([fetchProjects(a), fetchTasks(a)]);
    const { data: view, error } = await a
      .from("v_projects")
      .select("id, progress, task_count, done_count, is_stuck, is_stale")
      .in("id", [ids.active, ids.stale]);
    expect(error).toBeNull();
    expect(view).toHaveLength(2);
    for (const row of view ?? []) {
      const project = projects.find((p) => p.id === row.id);
      expect(project).toBeDefined();
      if (!project) continue;
      const progress = projectProgress(project.id, tasks);
      expect(progress.total).toBe(row.task_count);
      expect(progress.done).toBe(row.done_count);
      expect(progress.ratio).toBe(row.progress === null ? null : Number(row.progress));
      expect(stuckReasons(project, tasks).length > 0).toBe(row.is_stuck);
      expect(isStale(project, tasks, Date.now())).toBe(row.is_stale);
    }
    const active = view?.find((r) => r.id === ids.active);
    expect(Number(active?.progress)).toBeCloseTo(0.3333, 4);
    expect(active?.is_stuck).toBe(true);
    expect(view?.find((r) => r.id === ids.stale)?.is_stale).toBe(true);
  });

  it("neuer nächster Schritt im selben Paket wie die Aufgabe: nicht mehr festgefahren", async () => {
    await persist([
      {
        table: "projects",
        id: ids.fresh,
        mode: "upsert",
        values: {
          area_id: areaId,
          title: `Neu ${marker}`,
          status: "aktiv",
          outcome: [{ id: "1", text: "Läuft", done: false }],
          next_task_id: ids.next,
          sort: "a2",
          deleted_at: null,
        },
      },
      {
        table: "tasks",
        id: ids.next,
        mode: "upsert",
        values: {
          area_id: areaId,
          project_id: ids.fresh,
          title: `Schritt ${marker}`,
          body_text: "",
          status: "offen",
          in_inbox: false,
          sort: "a3",
          deleted_at: null,
        },
      },
    ]);
    const { data } = await a
      .from("v_projects")
      .select("is_stuck, next_task_id")
      .eq("id", ids.fresh)
      .single();
    expect(data).toEqual({ is_stuck: false, next_task_id: ids.next });
    const project = (await fetchProjects(a)).find((p) => p.id === ids.fresh);
    expect(project && stuckReasons(project, await fetchTasks(a))).toEqual([]);
  });

  it("B sieht keine Projekte von A, auch nicht über die View", async () => {
    const { data } = await b
      .from("v_projects")
      .select("id")
      .in("id", [ids.active, ids.stale, ids.fresh]);
    expect(data).toEqual([]);
    expect((await fetchProjects(b)).map((p) => p.id)).not.toContain(ids.active);
  });
});
