/**
 * Aufgaben-Datenschicht (B5) gegen das Testprojekt: die Abfragen der App (Aufgaben,
 * Abhängigkeiten, Projekte, Meilensteine, Quell-Notiz), der Persister mit „Blockiert durch“
 * (Konfliktschlüssel ohne id) und Erledigen/Rückgängig über die Warteschlange (complete_task,
 * undo_complete_task) – samt Kreis-Sperre, anon ohne Zugriff und A/B-Trennung.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { blockedTaskIds } from "@/features/tasks/dependencies";
import {
  fetchDependencies,
  fetchMilestones,
  fetchProjects,
  fetchTaskSourceNoteIds,
  fetchTasks,
} from "@/features/tasks/queries";
import { nextDueDate } from "@/features/tasks/recurrence";
import { applyComplete, nextInstance } from "@/features/tasks/status";
import { dependencyId } from "@/features/tasks/types";
import type { SaveOp } from "@/lib/save-queue/save-queue";
import {
  createSupabasePersister,
  type PersisterClient,
  RPC_TASK_STATUS,
  SaveError,
} from "@/lib/save-queue/supabase-persister";
import { anonClient, type Db, runMarker, userClient } from "../support/supabase-node";

const a = userClient(inject("sessionA"));
const b = userClient(inject("sessionB"));
const anon = anonClient();
const marker = runMarker();
const persistA = createSupabasePersister(() => a as unknown as PersisterClient);

let areaA = "";
let areaB = "";
const ids = {
  recurring: crypto.randomUUID(),
  next: crypto.randomUUID(),
  blocker: crypto.randomUUID(),
  waiting: crypto.randomUUID(),
  project: crypto.randomUUID(),
  milestone: crypto.randomUUID(),
  note: crypto.randomUUID(),
  block: crypto.randomUUID(),
  bTask: crypto.randomUUID(),
  bProject: crypto.randomUUID(),
  bMilestone: crypto.randomUUID(),
};

const taskRow = (id: string, extra: Record<string, unknown> = {}): SaveOp => ({
  table: "tasks",
  id,
  mode: "upsert",
  values: {
    area_id: areaA,
    project_id: null,
    milestone_id: null,
    title: `Aufgabe ${marker}`,
    body: null,
    body_text: "",
    status: "offen",
    priority: null,
    due_date: null,
    scheduled_at: null,
    duration_min: null,
    recurrence: null,
    recurrence_source_id: null,
    focus_date: null,
    in_inbox: false,
    sort: "a0",
    deleted_at: null,
    ...extra,
  },
});

const dependency = (task: string, blocker: string, deleted: string | null = null): SaveOp => ({
  table: "task_dependencies",
  id: dependencyId(task, blocker),
  mode: "upsert",
  values: { task_id: task, blocked_by_task_id: blocker, deleted_at: deleted },
});

const status = (id: string, values: Record<string, unknown>): SaveOp => ({
  table: RPC_TASK_STATUS,
  id,
  mode: "update",
  values,
});

async function firstArea(client: Db) {
  const { data, error } = await client.from("areas").select("id").order("sort").limit(1).single();
  expect(error).toBeNull();
  return data?.id ?? "";
}

beforeAll(async () => {
  areaA = await firstArea(a);
  areaB = await firstArea(b);
  // Daten von B, die A nie sehen darf
  for (const step of [
    b
      .from("projects")
      .insert({ id: ids.bProject, area_id: areaB, title: `B ${marker}`, sort: "a0" }),
    b
      .from("milestones")
      .insert({ id: ids.bMilestone, project_id: ids.bProject, title: `B ${marker}`, sort: "a0" }),
    b.from("tasks").insert({ id: ids.bTask, area_id: areaB, title: `B ${marker}`, sort: "a0" }),
  ]) {
    const { error } = await step;
    expect(error, error?.message).toBeNull();
  }
});

afterAll(async () => {
  await a.from("notes").delete().eq("id", ids.note);
  await a.from("tasks").delete().in("id", [ids.recurring, ids.next, ids.blocker, ids.waiting]);
  await a.from("projects").delete().eq("id", ids.project);
  await b.from("tasks").delete().eq("id", ids.bTask);
  await b.from("projects").delete().eq("id", ids.bProject);
});

describe("Abfragen der Aufgaben-Ansichten", () => {
  it("anon bekommt nichts (42501)", async () => {
    for (const query of [fetchTasks, fetchDependencies, fetchProjects, fetchMilestones]) {
      await expect(query(anon)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(fetchTaskSourceNoteIds(anon, ids.bTask)).rejects.toMatchObject({ code: "42501" });
  });

  it("A sieht nur eigene Aufgaben, Projekte und Meilensteine – B seine", async () => {
    const [tasks, projects, milestones] = await Promise.all([
      fetchTasks(a),
      fetchProjects(a),
      fetchMilestones(a),
    ]);
    expect(tasks.map((t) => t.id)).not.toContain(ids.bTask);
    expect(projects.map((p) => p.id)).not.toContain(ids.bProject);
    expect(milestones.map((m) => m.id)).not.toContain(ids.bMilestone);
    expect((await fetchTasks(b)).map((t) => t.id)).toContain(ids.bTask);
    expect((await fetchProjects(b)).map((p) => p.id)).toContain(ids.bProject);
    expect((await fetchMilestones(b)).map((m) => m.id)).toContain(ids.bMilestone);
  });

  it("Verweis auf Bs Aufgabe verrät nichts und ändert nichts; Bs Aufgabe erledigen geht nicht", async () => {
    // Fremdschlüssel prüfen an RLS vorbei (Plan, Restrisiko bei Single-User) – aber A erfährt nichts
    await persistA([taskRow(ids.waiting)]);
    await persistA([dependency(ids.waiting, ids.bTask)]);
    const { data: view } = await a
      .from("v_tasks")
      .select("is_blocked")
      .eq("id", ids.waiting)
      .single();
    expect(view?.is_blocked).toBe(false);
    const ownDeps = await fetchDependencies(a);
    expect(blockedTaskIds(await fetchTasks(a), ownDeps).has(ids.waiting)).toBe(false);
    expect((await fetchDependencies(b)).map((d) => d.task_id)).not.toContain(ids.waiting);
    await persistA([dependency(ids.waiting, ids.bTask, new Date().toISOString())]);

    await expect(persistA([status(ids.bTask, { action: "complete" })])).rejects.toMatchObject({
      code: "P0002",
      retryable: false,
    });
    const { data } = await b.from("tasks").select("status").eq("id", ids.bTask).single();
    expect(data?.status).toBe("offen");
  });
});

describe("Persister: Blockiert durch, Erledigen und Rückgängig", () => {
  it("Abhängigkeit speichern, Kreis wird dauerhaft abgelehnt, blockiert wie v_tasks", async () => {
    await persistA([taskRow(ids.blocker, { title: `Blocker ${marker}` }), taskRow(ids.waiting)]);
    await persistA([dependency(ids.waiting, ids.blocker)]);
    const deps = await fetchDependencies(a);
    expect(deps.map((d) => d.id)).toContain(dependencyId(ids.waiting, ids.blocker));

    const error = await persistA([dependency(ids.blocker, ids.waiting)]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SaveError);
    expect(error).toMatchObject({ code: "23514", retryable: false });

    const tasks = await fetchTasks(a);
    const clientBlocked = blockedTaskIds(tasks, deps);
    const { data: view } = await a
      .from("v_tasks")
      .select("id, is_blocked")
      .in("id", [ids.blocker, ids.waiting]);
    expect(view).toHaveLength(2);
    for (const row of view ?? []) expect(clientBlocked.has(row.id ?? "")).toBe(row.is_blocked);
    expect(clientBlocked.has(ids.waiting)).toBe(true);

    // Soft-Delete der Abhängigkeit (ganze Zeile per Upsert) gibt frei
    await persistA([dependency(ids.waiting, ids.blocker, new Date().toISOString())]);
    expect(blockedTaskIds(await fetchTasks(a), await fetchDependencies(a)).has(ids.waiting)).toBe(
      false,
    );
  });

  it("Erledigen mit Folgeinstanz über die Zeitumstellung: Server = Client, Rückgängig entfernt sie", async () => {
    const body = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Milch" }] }],
            },
          ],
        },
      ],
    };
    // Aufgabe und Erledigen in EINEM Paket: die Zeile muss vor dem RPC gespeichert sein
    const nextDue = nextDueDate("FREQ=DAILY", "2026-10-24", "2026-10-24") as string;
    expect(nextDue).toBe("2026-10-25");
    await persistA([
      status(ids.recurring, { action: "complete", p_next_due: nextDue, p_next_id: ids.next }),
      taskRow(ids.recurring, {
        title: `Wiederkehrend ${marker}`,
        recurrence: "FREQ=DAILY",
        due_date: "2026-10-24",
        scheduled_at: "2026-10-24T07:00:00Z",
        body,
        body_text: "Milch",
        priority: 2,
      }),
    ]);
    const tasks = await fetchTasks(a);
    const done = tasks.find((t) => t.id === ids.recurring);
    const next = tasks.find((t) => t.id === ids.next);
    expect(done?.status).toBe("erledigt");
    expect(done?.completed_at).not.toBeNull();
    expect(next).toBeDefined();
    if (!done || !next) return;
    // Client-Vorhersage (optimistische Ansicht) stimmt mit der Datenbank überein
    const predicted = nextInstance(
      { ...done, status: "offen" },
      nextDue,
      ids.next,
      next.created_at,
    );
    for (const key of [
      "status",
      "due_date",
      "recurrence",
      "recurrence_source_id",
      "priority",
      "area_id",
      "focus_date",
      "in_inbox",
      "body",
      "sort",
    ] as const) {
      expect(next[key], key).toEqual(predicted[key]);
    }
    expect(Date.parse(next.scheduled_at ?? "")).toBe(Date.parse("2026-10-25T08:00:00Z"));
    expect(JSON.stringify(next.body)).toContain('"checked":false');

    // nochmal erledigen ist idempotent
    await persistA([
      status(ids.recurring, {
        action: "complete",
        p_next_due: "2026-10-26",
        p_next_id: crypto.randomUUID(),
      }),
    ]);
    expect(
      (await fetchTasks(a)).filter((t) => t.recurrence_source_id === ids.recurring),
    ).toHaveLength(1);

    await persistA([status(ids.recurring, { action: "undo" })]);
    const after = await fetchTasks(a);
    expect(after.find((t) => t.id === ids.recurring)?.status).toBe("offen");
    expect(after.find((t) => t.id === ids.next)).toBeUndefined();
    expect(
      applyComplete(after, ids.recurring, null, "x").find((t) => t.id === ids.recurring)?.status,
    ).toBe("erledigt");
  });

  it("Block → Aufgabe: Quell-Notiz der Aufgabe wird gefunden", async () => {
    const { error } = await a
      .from("notes")
      .insert({ id: ids.note, area_id: areaA, title: `Notiz ${marker}` });
    expect(error).toBeNull();
    const block = await a.from("note_blocks").insert({
      id: ids.block,
      note_id: ids.note,
      sort: "a0",
      content: { type: "paragraph", content: [{ type: "text", text: "Punkt" }] },
      content_text: "Punkt",
      task_id: ids.waiting,
    });
    expect(block.error).toBeNull();
    expect(await fetchTaskSourceNoteIds(a, ids.waiting)).toEqual([ids.note]);
    expect(await fetchTaskSourceNoteIds(b, ids.waiting)).toEqual([]);
  });

  it("Projekt und Meilenstein: Aufgabe übernimmt Projekt aus dem Meilenstein, Bereich aus dem Projekt", async () => {
    for (const step of [
      a
        .from("projects")
        .insert({ id: ids.project, area_id: areaA, title: `P ${marker}`, sort: "a0" }),
      a
        .from("milestones")
        .insert({ id: ids.milestone, project_id: ids.project, title: `M ${marker}`, sort: "a0" }),
    ]) {
      const { error } = await step;
      expect(error).toBeNull();
    }
    await persistA([
      { table: "tasks", id: ids.blocker, mode: "update", values: { milestone_id: ids.milestone } },
    ]);
    const task = (await fetchTasks(a)).find((t) => t.id === ids.blocker);
    expect(task).toMatchObject({
      project_id: ids.project,
      area_id: areaA,
      milestone_id: ids.milestone,
    });
    const project = (await fetchProjects(a)).find((p) => p.id === ids.project);
    expect(project).toMatchObject({ status: "idee", outcome: [], closing_reflection: null });
  });
});
