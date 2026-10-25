/**
 * Aufgaben anlegen und ändern, Inbox-Erfassung (#33). Erledigen läuft wie in der App über
 * complete_task (bei Wiederholung entsteht die Folgeaufgabe), Wiederöffnen über
 * undo_complete_task (die Folgeaufgabe kommt in den Papierkorb). Den Meilenstein führt der
 * Trigger aus Migration 35 mit (#60) – die Antwort nennt ihn, wenn er damit erreicht ist.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { parseCapture } from "@/features/inbox/parse";
import { normalizeTags, preferredNoteType } from "@/features/notes/types";
import type { MilestoneRow, ProjectRow } from "@/features/projects/types";
import { checklistFollow } from "@/features/tasks/checklist";
import { nextDueDate, reanchorRule } from "@/features/tasks/recurrence";
import type { TaskRow, TaskStatus } from "@/features/tasks/types";
import { berlinDate, berlinDateTime } from "@/lib/dates";
import { newId } from "@/lib/id";
import { keyAfter } from "@/lib/sort-key";
import { existingMediaResolver } from "../../model/media-refs";
import { appendTaskNodes, markdownToTaskNodes, taskBodyText } from "../../model/task-markdown";
import { type AiContext, appUrl, check, logActivity, ref } from "../context";
import { loadSnapshot, type Snapshot, taskPlace } from "../data";
import {
  assertAreaFollows,
  priorityOf,
  recurrenceOf,
  resolveNamed,
  ToolInputError,
} from "../resolve";
import { CHANGES, CREATES, defineTool } from "./define";
import { insertEventLink, linkableLabel, readLinkableEvent, terminInput } from "./event-links";
import { noteByTitle, titleOf } from "./notes";
import {
  assignee,
  assigneeOf,
  dateTime,
  id,
  isoDate,
  markdown,
  priority,
  reference,
  taskStatus,
  title,
} from "./schema";

/** „JJJJ-MM-TT HH:MM“ (Berlin) → Zeitstempel. */
const scheduled = (value: string) => berlinDateTime(value.slice(0, 10), value.slice(11, 16));

/** Markdown → Aufgaben-Notiz; `current` = bisheriger Inhalt (seine Bilder/Dateien bleiben per Verweis, O8). */
const bodyOf = (snapshot: Snapshot, markdownText: string, current: TaskRow["body"] = null) =>
  markdownToTaskNodes(markdownText, {
    resolveNoteByTitle: noteByTitle(snapshot),
    resolveMedia: existingMediaResolver([current]),
  });

/** #60: Ist der Meilenstein durch das Abhaken erreicht (Trigger, Migration 35)? */
async function reachedText(
  ctx: AiContext,
  snapshot: Snapshot,
  milestoneId: string | null,
): Promise<string> {
  const before = milestoneId ? snapshot.milestones.find((m) => m.id === milestoneId) : null;
  if (!before || before.done_at) return "";
  const { data } = await ctx.db
    .from("milestones")
    .select("done_at")
    .eq("id", before.id)
    .maybeSingle();
  return data?.done_at ? ` · Meilenstein „${before.title || "Ohne Titel"}“ damit erreicht` : "";
}

/** Projekt und Meilenstein auflösen; der Meilenstein bestimmt das Projekt. */
export function placeOf(
  snapshot: Snapshot,
  input: { projekt?: string; meilenstein?: string },
): { project: ProjectRow | null; milestone: MilestoneRow | null } {
  const project = input.projekt?.trim()
    ? resolveNamed(input.projekt, snapshot.projects, (p) => p.title, "Projekt")
    : null;
  if (!input.meilenstein?.trim()) return { project, milestone: null };
  const candidates = project
    ? snapshot.milestones.filter((m) => m.project_id === project.id)
    : snapshot.milestones;
  const milestone = resolveNamed(input.meilenstein, candidates, (m) => m.title, "Meilenstein");
  return {
    project: snapshot.projects.find((p) => p.id === milestone.project_id) ?? project,
    milestone,
  };
}

const taskSummary = (task: Pick<TaskRow, "id" | "title">, ctx: AiContext) =>
  ref(task.title, appUrl.task(ctx.origin, task.id), task.id);

/**
 * „ki“ nur in einem Projekt (M-5): KI-Aufgaben erscheinen nur im Projekt – ohne Projekt stünden
 * sie nirgends (nicht in Inbox, Heute, Kalender, Aufgaben-Datenbank), nur ⌘K fände sie.
 */
export function assertAssigneePlace(
  zustaendig: "ich" | "ki" | undefined,
  projectId: string | null,
): void {
  if (zustaendig === "ki" && !projectId) {
    throw new ToolInputError(
      "zustaendig „ki“ geht nur für Aufgaben in einem Projekt – sonst wäre die Aufgabe nirgends sichtbar. projekt angeben oder zustaendig „ich“.",
    );
  }
}

export function registerTaskTools(server: McpServer, ctx: AiContext) {
  /* ---------------- create_task ---------------- */
  defineTool(
    server,
    "create_task",
    {
      title: "Aufgabe anlegen",
      description:
        "Legt eine Aufgabe an. Ohne Bereich und Projekt landet sie in der Inbox. Ein Meilenstein ordnet sie auch dem Projekt zu. notiz: Markdown, `- [ ] Punkt` wird ein Punkt der Checkliste. „termin“ (IDs aus list_events) verknüpft sie mit einem Google-Termin.",
      input: z.object({
        titel: title,
        notiz: markdown.optional(),
        bereich: reference("Bereich").optional(),
        projekt: reference("Projekt").optional(),
        meilenstein: reference("Meilenstein").optional(),
        status: taskStatus.default("offen"),
        prioritaet: priority.optional(),
        faellig: isoDate.optional(),
        geplant: dateTime.optional(),
        dauer_min: z.number().int().min(1).max(1440).optional(),
        fokus: isoDate.optional().describe("Fokus-Tag (max. 3 Fokus-Aufgaben je Tag)"),
        wiederholung: z.string().max(200).optional(),
        zustaendig: assignee.optional(),
        termin: terminInput.optional(),
      }),
      annotations: CREATES,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const today = berlinDate(ctx.now());
      // Termin zuerst lesen: Ist er nicht da, entsteht auch keine Aufgabe (#68)
      const linked = input.termin ? await readLinkableEvent(ctx, input.termin) : null;
      const { project, milestone } = placeOf(snapshot, input);
      const area = input.bereich
        ? resolveNamed(input.bereich, snapshot.areas, (a) => a.name, "Bereich")
        : null;
      if (area && project) {
        assertAreaFollows(area, { kind: "Projekt", name: project.title, area_id: project.area_id });
      }
      const areaId = project?.area_id ?? area?.id ?? null;
      assertAssigneePlace(input.zustaendig, project?.id ?? null);
      const nodes = input.notiz ? bodyOf(snapshot, input.notiz) : [];
      const body = nodes.length ? appendTaskNodes(null, nodes) : null;
      const due = input.faellig ?? null;
      const recurrence = input.wiederholung ? recurrenceOf(input.wiederholung, due, today) : null;
      // „erledigt“ wie in der App über complete_task – sonst entstünde keine Folgeaufgabe (S-8)
      const done = input.status === "erledigt";
      const task = {
        id: newId(),
        title: input.titel,
        area_id: areaId,
        project_id: project?.id ?? null,
        milestone_id: milestone?.id ?? null,
        in_inbox: !areaId,
        status: done ? ("offen" as const) : input.status,
        priority: priorityOf(input.prioritaet ?? null),
        due_date: due,
        scheduled_at: input.geplant ? scheduled(input.geplant) : null,
        duration_min: input.dauer_min ?? null,
        focus_date: input.fokus ?? null,
        recurrence,
        body: body as never,
        body_text: taskBodyText(body, { resolveTitle: titleOf(snapshot) }),
        sort: keyAfter(snapshot.tasks.map((t) => t.sort)),
        assignee: assigneeOf(input.zustaendig),
      };
      check("Aufgabe anlegen", await ctx.db.from("tasks").insert(task).select("id").single());
      if (linked && input.termin) {
        await insertEventLink(
          ctx,
          linked.linkable,
          { kind: "aufgabe", id: task.id },
          input.termin.serie,
        );
      }
      let doneText = "";
      if (done) {
        const nextDue = recurrence ? nextDueDate(recurrence, due, today) : null;
        check(
          "Erledigen",
          await ctx.db.rpc("complete_task", {
            p_task_id: task.id,
            ...(nextDue ? { p_next_due: nextDue, p_next_id: newId() } : {}),
          }),
        );
        doneText = nextDue ? ` · erledigt, nächste am ${nextDue}` : " · erledigt";
        doneText += await reachedText(ctx, snapshot, task.milestone_id);
      }
      const where = `${task.in_inbox ? "Inbox" : taskPlace(snapshot, task as unknown as TaskRow)}${
        task.assignee === "ai" ? " · für die KI (nur im Projekt sichtbar)" : ""
      }${linked ? ` · verknüpft mit Termin ${linkableLabel(linked.linkable)}` : ""}`;
      await logActivity(ctx, {
        tool: "create_task",
        entity: "aufgabe",
        entityId: task.id,
        summary: `Aufgabe „${task.title}“ angelegt (${where})${doneText}`,
      });
      return {
        text: `Aufgabe angelegt: ${taskSummary(task, ctx)} · ${where}${doneText}`,
        structured: { id: task.id, url: appUrl.task(ctx.origin, task.id) },
      };
    },
  );

  /* ---------------- update_task ---------------- */
  defineTool(
    server,
    "update_task",
    {
      title: "Aufgabe ändern",
      description: [
        "Ändert eine Aufgabe. status „erledigt“ hakt ab (bei Wiederholung entsteht die nächste); von „erledigt“ zurück öffnet sie wieder.",
        'null entfernt einen Wert (faellig, geplant, fokus, prioritaet, dauer_min); projekt/meilenstein "" löst die Zuordnung.',
        "notiz mit notiz_modus „anhaengen“ (Standard, Checkliste wird fortgesetzt) oder „ersetzen“ (vorher mit „fetch“ lesen; Bilder und Dateien bleiben, wo ihre Verweise ![[…]] bzw. [[…]] im neuen Text stehen).",
        "Wie in der App folgt die Aufgabe ihrer Checkliste: Wird der letzte offene Punkt abgehakt, ist sie erledigt; bekommt eine so erledigte Aufgabe wieder einen offenen Punkt, ist sie wieder offen.",
      ].join(" "),
      input: z.object({
        id,
        titel: title.optional(),
        status: taskStatus.optional(),
        prioritaet: priority.nullable().optional(),
        faellig: isoDate.nullable().optional(),
        geplant: dateTime.nullable().optional(),
        dauer_min: z.number().int().min(1).max(1440).nullable().optional(),
        fokus: isoDate.nullable().optional(),
        wiederholung: z.string().max(200).optional().describe("„keine“ entfernt die Wiederholung"),
        bereich: reference("Bereich").optional(),
        projekt: z.string().max(200).optional(),
        meilenstein: z.string().max(200).optional(),
        notiz: markdown.optional(),
        notiz_modus: z.enum(["anhaengen", "ersetzen"]).default("anhaengen"),
        zustaendig: assignee.optional(),
      }),
      annotations: CHANGES,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const task = snapshot.tasks.find((t) => t.id === input.id);
      if (!task) throw new ToolInputError(`Aufgabe ${input.id} nicht gefunden.`);
      const today = berlinDate(ctx.now());
      const patch: Record<string, unknown> = {};
      if (input.titel !== undefined) patch.title = input.titel;
      if (input.prioritaet !== undefined) patch.priority = priorityOf(input.prioritaet);
      if (input.faellig !== undefined) patch.due_date = input.faellig;
      if (input.geplant !== undefined)
        patch.scheduled_at = input.geplant ? scheduled(input.geplant) : null;
      if (input.dauer_min !== undefined) patch.duration_min = input.dauer_min;
      if (input.fokus !== undefined) patch.focus_date = input.fokus;
      if (input.zustaendig !== undefined) patch.assignee = assigneeOf(input.zustaendig);
      const due = (patch.due_date as string | null | undefined) ?? task.due_date;
      if (input.wiederholung !== undefined) {
        patch.recurrence = recurrenceOf(input.wiederholung, due, today);
      } else if (input.faellig !== undefined && task.recurrence) {
        // wie in der App: Wochentag/Monatstag der Vorgabe zieht mit
        const rule = reanchorRule(task.recurrence, input.faellig);
        if (rule !== task.recurrence) patch.recurrence = rule;
      }
      if (input.projekt !== undefined || input.meilenstein !== undefined) {
        const { project, milestone } = placeOf(snapshot, {
          projekt: input.projekt,
          meilenstein: input.meilenstein,
        });
        if (input.projekt !== undefined) patch.project_id = project?.id ?? null;
        if (input.meilenstein !== undefined) {
          patch.milestone_id = milestone?.id ?? null;
          if (milestone) patch.project_id = milestone.project_id;
        } else if (input.projekt !== undefined && task.milestone_id) {
          const kept = snapshot.milestones.find((m) => m.id === task.milestone_id);
          if (kept && kept.project_id !== patch.project_id) patch.milestone_id = null;
        }
        if (project) patch.area_id = project.area_id;
      }
      if (input.bereich !== undefined) {
        const area = resolveNamed(input.bereich, snapshot.areas, (a) => a.name, "Bereich");
        const projectId = patch.project_id !== undefined ? patch.project_id : task.project_id;
        const owner = snapshot.projects.find((p) => p.id === projectId);
        if (owner) {
          assertAreaFollows(area, { kind: "Projekt", name: owner.title, area_id: owner.area_id });
        } else {
          patch.area_id = area.id;
        }
      }
      // Inbox verlassen, sobald Bereich oder Projekt gesetzt sind (wie in der App)
      if (task.in_inbox && (patch.area_id || patch.project_id)) patch.in_inbox = false;
      if (input.zustaendig !== undefined || patch.project_id !== undefined) {
        const assigneeAfter = (patch.assignee as string | undefined) ?? task.assignee;
        assertAssigneePlace(
          assigneeAfter === "ai" ? "ki" : "ich",
          patch.project_id !== undefined ? (patch.project_id as string | null) : task.project_id,
        );
      }
      if (input.notiz !== undefined) {
        const nodes = bodyOf(snapshot, input.notiz, task.body);
        const body =
          input.notiz_modus === "ersetzen"
            ? nodes.length
              ? appendTaskNodes(null, nodes)
              : null
            : appendTaskNodes(task.body, nodes);
        patch.body = body;
        patch.body_text = taskBodyText(body, { resolveTitle: titleOf(snapshot) });
      }

      const before = Object.fromEntries(
        Object.keys(patch).map((key) => [key, (task as unknown as Record<string, unknown>)[key]]),
      );

      // #86: ohne ausdrücklichen Status folgt die Aufgabe ihrer Checkliste wie in der App
      const followed =
        input.status === undefined && patch.body !== undefined
          ? checklistFollow(task.body, patch.body as TaskRow["body"], task.status)
          : null;
      const wanted = input.status ?? followed ?? undefined;
      // Status-Änderung erst planen: Das Protokoll steht vor jeder Änderung (K-5) – bei „ersetzen“
      // ist es der einzige Ort, an dem die alte Notiz der Aufgabe noch steht
      let statusPlan: {
        target: TaskStatus;
        nextDue: ReturnType<typeof nextDueDate>;
        nextId: string | null;
        removed: string[];
      } | null = null;
      if (wanted !== undefined && wanted !== task.status) {
        if (wanted === "erledigt") {
          const rule = (patch.recurrence as string | null | undefined) ?? task.recurrence;
          const nextDue = rule ? nextDueDate(rule, due, today) : null;
          statusPlan = { target: wanted, nextDue, nextId: nextDue ? newId() : null, removed: [] };
        } else {
          // Folgeaufgaben, die undo_complete_task in den Papierkorb legt (S-3) – dieselbe Regel
          // wie die RPC, vorab gelesen, damit das Rückgängig im Protokoll vollständig ist
          const removed =
            task.status === "erledigt"
              ? check(
                  "Folgeaufgaben lesen",
                  await ctx.db
                    .from("tasks")
                    .select("id")
                    .eq("recurrence_source_id", task.id)
                    .is("deleted_at", null)
                    .neq("status", "erledigt"),
                ).map((row) => row.id)
              : [];
          statusPlan = { target: wanted, nextDue: null, nextId: null, removed };
        }
      }
      const statusUndo: Record<string, unknown> | null = statusPlan
        ? statusPlan.target === "erledigt"
          ? { kind: "complete", task_id: task.id }
          : {
              kind: "status",
              task_id: task.id,
              before: task.status,
              ...(statusPlan.removed.length ? { restore: statusPlan.removed } : {}),
            }
        : null;
      let statusText = statusPlan
        ? statusPlan.target === "erledigt"
          ? `${statusPlan.nextDue ? ` · erledigt, nächste am ${statusPlan.nextDue}` : " · erledigt"}${
              followed ? " (alle Punkte abgehakt)" : ""
            }`
          : ` · Status ${statusPlan.target}${followed ? " (ein Punkt ist wieder offen)" : ""}`
        : "";
      const changed = Object.keys(patch).filter((k) => k !== "body_text");
      if (!statusPlan && changed.length === 0)
        throw new ToolInputError("Nichts zu ändern angegeben.");
      const name = (patch.title as string) ?? task.title;
      await logActivity(ctx, {
        tool: "update_task",
        entity: "aufgabe",
        entityId: task.id,
        summary: `Aufgabe „${name}“ geändert${changed.length ? ` (${changed.join(", ")})` : ""}${statusText}`,
        undo:
          statusUndo && changed.length === 0
            ? statusUndo
            : changed.length
              ? {
                  kind: "update",
                  table: "tasks",
                  id: task.id,
                  before,
                  after: patch,
                  ...(statusUndo ? { status: statusUndo } : {}),
                }
              : statusUndo,
      });

      if (Object.keys(patch).length > 0) {
        check(
          "Aufgabe ändern",
          await ctx.db
            .from("tasks")
            .update(patch as never)
            .eq("id", task.id)
            .select("id")
            .single(),
        );
      }
      if (statusPlan?.target === "erledigt") {
        check(
          "Erledigen",
          await ctx.db.rpc("complete_task", {
            p_task_id: task.id,
            ...(statusPlan.nextDue
              ? { p_next_due: statusPlan.nextDue, p_next_id: statusPlan.nextId as string }
              : {}),
          }),
        );
        const milestoneId =
          patch.milestone_id !== undefined
            ? (patch.milestone_id as string | null)
            : task.milestone_id;
        statusText += await reachedText(ctx, snapshot, milestoneId);
      } else if (statusPlan) {
        if (task.status === "erledigt") {
          check("Wieder öffnen", await ctx.db.rpc("undo_complete_task", { p_task_id: task.id }));
        }
        if (statusPlan.target !== "offen" || task.status !== "erledigt") {
          check(
            "Status ändern",
            await ctx.db
              .from("tasks")
              .update({ status: statusPlan.target })
              .eq("id", task.id)
              .select("id")
              .single(),
          );
        }
      }
      return {
        text: `Aufgabe geändert: ${taskSummary({ id: task.id, title: name }, ctx)}${
          changed.length ? ` · ${changed.join(", ")}` : ""
        }${statusText}`,
        structured: { id: task.id, url: appUrl.task(ctx.origin, task.id) },
      };
    },
  );

  /* ---------------- capture ---------------- */
  defineTool(
    server,
    "capture",
    {
      title: "In die Inbox",
      description:
        "Schnellerfassung wie in der App: ein Satz wird eine Aufgabe in der Inbox. Kürzel: #job/#privat (Bereich), @Projekt, #notiz (wird eine Idee-Notiz, braucht einen Bereich).",
      input: z.object({ text: z.string().trim().min(1).max(500) }),
      annotations: CREATES,
    },
    async ({ text }) => {
      const snapshot = await loadSnapshot(ctx.db);
      const result = parseCapture(text, { areas: snapshot.areas, projects: snapshot.projects });
      if (result.ambiguous) {
        throw new ToolInputError(
          `@${result.ambiguous.token} ist nicht eindeutig: ${result.ambiguous.candidates.map((p) => p.title).join(", ")}.`,
        );
      }
      const titleText = result.title || text;
      if (result.kind === "note") {
        if (!result.areaId)
          throw new ToolInputError("Eine Notiz braucht einen Bereich (#job, #privat …).");
        const note = {
          id: newId(),
          title: titleText,
          type: preferredNoteType("idee", snapshot.noteTypes),
          area_id: result.areaId,
          project_id: result.projectId,
          tags: normalizeTags([]),
        };
        check("Notiz anlegen", await ctx.db.from("notes").insert(note).select("id").single());
        await logActivity(ctx, {
          tool: "capture",
          entity: "notiz",
          entityId: note.id,
          summary: `Idee „${note.title}“ erfasst`,
        });
        return {
          text: `Notiz angelegt: ${ref(note.title, appUrl.note(ctx.origin, note.id), note.id)}`,
          structured: { id: note.id, url: appUrl.note(ctx.origin, note.id) },
        };
      }
      const task = {
        id: newId(),
        title: titleText,
        area_id: result.areaId,
        project_id: result.projectId,
        in_inbox: !result.areaId && !result.projectId,
        sort: keyAfter(snapshot.tasks.map((t) => t.sort)),
      };
      check("Aufgabe anlegen", await ctx.db.from("tasks").insert(task).select("id").single());
      const where = task.in_inbox ? "Inbox" : taskPlace(snapshot, task as unknown as TaskRow);
      await logActivity(ctx, {
        tool: "capture",
        entity: "aufgabe",
        entityId: task.id,
        summary: `„${task.title}“ erfasst (${where})`,
      });
      return {
        text: `Erfasst: ${taskSummary(task, ctx)} · ${where}${
          result.unknownProject
            ? ` · Projekt „${result.unknownProject}“ unbekannt, bleibt im Text`
            : ""
        }`,
        structured: { id: task.id, url: appUrl.task(ctx.origin, task.id) },
      };
    },
  );
}
