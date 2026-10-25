/**
 * Projekte anlegen und ändern (#33): Steckbrief, Ergebnis-Checkliste („Fertig ist es, wenn …“),
 * Meilensteine in Reihenfolge und Aufgaben – ein Projekt samt Fahrplan in einem Aufruf.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { JSONContent } from "@tiptap/core";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";
import { linkLabel, normalizeLinkUrl, type ProjectLink } from "@/features/projects/links";
import type { OutcomeItem } from "@/features/projects/types";
import { newId } from "@/lib/id";
import { keyAfter } from "@/lib/sort-key";
import { existingMediaResolver } from "../../model/media-refs";
import { appendTaskNodes, markdownToTaskNodes, taskBodyText } from "../../model/task-markdown";
import { type AiContext, appUrl, check, logActivity, ref } from "../context";
import { loadSnapshot, type Snapshot } from "../data";
import { priorityOf, resolveNamed, ToolInputError } from "../resolve";
import { CHANGES, CREATES, defineTool } from "./define";
import { noteByTitle, titleOf } from "./notes";
import {
  assignee,
  assigneeOf,
  id,
  isoDate,
  markdown,
  priority,
  projectStatus,
  reference,
  taskStatus,
  title,
} from "./schema";

const taskInput = z.object({
  titel: title,
  faellig: isoDate.optional(),
  prioritaet: priority.optional(),
  status: taskStatus.default("offen"),
  notiz: markdown.optional(),
  zustaendig: assignee.optional(),
});
const milestoneInput = z.object({
  titel: title,
  faellig: isoDate.optional(),
  aufgaben: z.array(taskInput).max(100).optional(),
});

const linkInput = z.object({
  name: z.string().max(200).optional().describe("Anzeigename, sonst die Adresse"),
  adresse: z.string().max(2000).describe("http(s)- oder mailto-Adresse"),
});

/** Links des Steckbriefs (Migration 22): nur http(s) und mailto, ohne Schema https://. */
const linkItems = (inputs: Array<z.output<typeof linkInput>>): ProjectLink[] =>
  inputs.map((input) => {
    const url = normalizeLinkUrl(input.adresse);
    if (!url) {
      throw new ToolInputError(
        `„${input.adresse}“ ist keine Link-Adresse (nur http(s) oder mailto).`,
      );
    }
    return { id: newId(), name: input.name?.trim() ?? "", url };
  });

/** Freitext des Projekts (#44) aus Markdown – Schema wie die Aufgaben-Notiz. */
function freeText(
  snapshot: Snapshot,
  current: JSONContent | null,
  markdownText: string,
  mode: "anhaengen" | "ersetzen",
): { body: JSONContent | null; body_text: string } {
  const nodes = markdownToTaskNodes(markdownText, {
    resolveNoteByTitle: noteByTitle(snapshot),
    // Bilder/Dateien des Freitexts: ![[…]]/[[…]] aus „fetch“ werden wieder ihre Knoten (O8)
    resolveMedia: existingMediaResolver([current]),
  });
  const body =
    mode === "ersetzen"
      ? nodes.length
        ? appendTaskNodes(null, nodes)
        : null
      : appendTaskNodes(current, nodes);
  return { body, body_text: taskBodyText(body, { resolveTitle: titleOf(snapshot) }) };
}

const outcomeItems = (texts: string[]): OutcomeItem[] =>
  texts
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ id: newId(), text, done: false }));

/** Aufgaben eines Projekts als Zeilen (Sortierschlüssel fortlaufend hinter allen Aufgaben). */
function taskRows(
  snapshot: Snapshot,
  items: Array<z.output<typeof taskInput> & { milestone_id: string | null }>,
  place: { area_id: string; project_id: string },
) {
  let sort = keyAfter(snapshot.tasks.map((t) => t.sort));
  return items.map((item) => {
    const nodes = item.notiz
      ? markdownToTaskNodes(item.notiz, { resolveNoteByTitle: noteByTitle(snapshot) })
      : [];
    const body = nodes.length ? appendTaskNodes(null, nodes) : null;
    const row = {
      id: newId(),
      title: item.titel,
      area_id: place.area_id,
      project_id: place.project_id,
      milestone_id: item.milestone_id,
      in_inbox: false,
      status: item.status,
      priority: priorityOf(item.prioritaet ?? null),
      due_date: item.faellig ?? null,
      body: body as never,
      body_text: taskBodyText(body, { resolveTitle: titleOf(snapshot) }),
      sort,
      assignee: assigneeOf(item.zustaendig),
    };
    sort = keyAfter([sort]);
    return row;
  });
}

export function registerProjectTools(server: McpServer, ctx: AiContext) {
  /* ---------------- create_project ---------------- */
  defineTool(
    server,
    "create_project",
    {
      title: "Projekt anlegen",
      description:
        "Legt ein Projekt (befristet, hat ein Ende) samt Fahrplan an: Warum, Ergebnis-Checkliste („Fertig ist es, wenn …“), Links (Name + Adresse), Freitext (Markdown, steht im Reiter Übersicht; `- [ ] Punkt` wird eine Checkliste), Meilensteine in Reihenfolge mit ihren Aufgaben, Aufgaben ohne Meilenstein, nächster Schritt (Titel einer der Aufgaben).",
      input: z.object({
        titel: title,
        bereich: reference("Bereich"),
        status: projectStatus.default("geplant"),
        prioritaet: priority.optional(),
        start: isoDate.optional(),
        ziel: isoDate.optional().describe("Zieldatum"),
        warum: z.string().max(5000).optional(),
        ergebnis: z.array(z.string().max(500)).max(30).optional(),
        links: z.array(linkInput).max(30).optional(),
        freitext: markdown.optional(),
        meilensteine: z.array(milestoneInput).max(50).optional(),
        aufgaben: z.array(taskInput).max(100).optional(),
        naechster_schritt: z.string().max(500).optional().describe("Titel einer der Aufgaben"),
      }),
      annotations: CREATES,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const area = resolveNamed(input.bereich, snapshot.areas, (a) => a.name, "Bereich");
      if (input.start && input.ziel && input.ziel < input.start) {
        throw new ToolInputError("Das Zieldatum liegt vor dem Start.");
      }
      const free = input.freitext ? freeText(snapshot, null, input.freitext, "ersetzen") : null;
      const project = {
        id: newId(),
        area_id: area.id,
        title: input.titel,
        status: input.status,
        priority: priorityOf(input.prioritaet ?? null),
        start_date: input.start ?? null,
        target_date: input.ziel ?? null,
        why: input.warum?.trim() ?? "",
        outcome: outcomeItems(input.ergebnis ?? []) as never,
        links: linkItems(input.links ?? []) as never,
        body: (free?.body ?? null) as never,
        body_text: free?.body_text ?? "",
        sort: keyAfter(snapshot.projects.map((p) => p.sort)),
      };
      check("Projekt anlegen", await ctx.db.from("projects").insert(project).select("id").single());

      const steps = input.meilensteine ?? [];
      const keys = steps.length ? generateNKeysBetween(null, null, steps.length) : [];
      const milestones = steps.map((step, index) => ({
        id: newId(),
        project_id: project.id,
        title: step.titel,
        due_date: step.faellig ?? null,
        sort: keys[index] as string,
      }));
      if (milestones.length) {
        check(
          "Meilensteine anlegen",
          await ctx.db.from("milestones").insert(milestones).select("id"),
        );
      }
      const tasks = taskRows(
        snapshot,
        [
          ...steps.flatMap((step, index) =>
            (step.aufgaben ?? []).map((t) => ({
              ...t,
              milestone_id: milestones[index]?.id ?? null,
            })),
          ),
          ...(input.aufgaben ?? []).map((t) => ({ ...t, milestone_id: null })),
        ],
        { area_id: area.id, project_id: project.id },
      );
      if (tasks.length) {
        check("Aufgaben anlegen", await ctx.db.from("tasks").insert(tasks).select("id"));
      }
      let nextText = "";
      if (input.naechster_schritt?.trim()) {
        const next = resolveNamed(
          input.naechster_schritt,
          tasks,
          (t) => t.title,
          "Nächster Schritt",
        );
        check(
          "Nächsten Schritt setzen",
          await ctx.db
            .from("projects")
            .update({ next_task_id: next.id })
            .eq("id", project.id)
            .select("id")
            .single(),
        );
        nextText = ` · nächster Schritt „${next.title}“`;
      }
      const summary = `Projekt „${project.title}“ angelegt (${milestones.length} Meilensteine, ${tasks.length} Aufgaben)`;
      await logActivity(ctx, {
        tool: "create_project",
        entity: "projekt",
        entityId: project.id,
        summary,
      });
      const url = appUrl.project(ctx.origin, project.id);
      return {
        text: `Projekt angelegt: ${ref(project.title, url, project.id)} · ${area.name} · ${milestones.length} Meilensteine · ${tasks.length} Aufgaben${nextText}`,
        structured: { id: project.id, url },
      };
    },
  );

  /* ---------------- update_project ---------------- */
  defineTool(
    server,
    "update_project",
    {
      title: "Projekt ändern",
      description: [
        "Ändert den Steckbrief (Titel, Status, Priorität, Start, Ziel, Warum, Bereich), hakt Ergebnis-Punkte ab oder ergänzt sie, ergänzt oder entfernt Links,",
        "schreibt den Freitext im Reiter Übersicht (Markdown; freitext_modus „anhaengen“ = Standard, Checkliste wird fortgesetzt, oder „ersetzen“ – vorher mit fetch lesen; Bilder und Dateien bleiben, wo ihre Verweise ![[…]] bzw. [[…]] im neuen Text stehen),",
        'setzt den nächsten Schritt (Aufgabe des Projekts, "" entfernt ihn) und ergänzt, ändert oder erreicht Meilensteine (neue kommen ans Ende).',
        "null entfernt prioritaet, start oder ziel. Neue Aufgaben im Projekt: create_task mit projekt/meilenstein.",
      ].join(" "),
      input: z.object({
        id,
        titel: title.optional(),
        status: projectStatus.optional(),
        prioritaet: priority.nullable().optional(),
        start: isoDate.nullable().optional(),
        ziel: isoDate.nullable().optional(),
        warum: z.string().max(5000).optional(),
        bereich: reference("Bereich").optional(),
        ergebnis_hinzu: z.array(z.string().max(500)).max(30).optional(),
        ergebnis_erledigt: z
          .array(z.string().max(500))
          .max(30)
          .optional()
          .describe("Texte oder IDs der Punkte"),
        ergebnis_offen: z.array(z.string().max(500)).max(30).optional(),
        links_hinzu: z.array(linkInput).max(30).optional(),
        links_entfernen: z
          .array(z.string().max(2000))
          .max(30)
          .optional()
          .describe("Namen, Adressen oder IDs der Links"),
        freitext: markdown.optional(),
        freitext_modus: z.enum(["anhaengen", "ersetzen"]).default("anhaengen"),
        naechster_schritt: z.string().max(500).optional(),
        meilenstein_hinzu: z
          .array(z.object({ titel: title, faellig: isoDate.optional() }))
          .max(50)
          .optional(),
        meilenstein_aendern: z
          .array(
            z.object({
              meilenstein: reference("Meilenstein"),
              titel: title.optional(),
              faellig: isoDate.nullable().optional(),
              erreicht: z.boolean().optional(),
            }),
          )
          .max(50)
          .optional(),
      }),
      annotations: CHANGES,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const project = snapshot.projects.find((p) => p.id === input.id);
      if (!project) throw new ToolInputError(`Projekt ${input.id} nicht gefunden.`);
      const patch: Record<string, unknown> = {};
      if (input.titel !== undefined) patch.title = input.titel;
      if (input.status !== undefined) patch.status = input.status;
      if (input.prioritaet !== undefined) patch.priority = priorityOf(input.prioritaet);
      if (input.start !== undefined) patch.start_date = input.start;
      if (input.ziel !== undefined) patch.target_date = input.ziel;
      if (input.warum !== undefined) patch.why = input.warum.trim();
      if (input.bereich !== undefined)
        patch.area_id = resolveNamed(input.bereich, snapshot.areas, (a) => a.name, "Bereich").id;
      if (input.ergebnis_hinzu || input.ergebnis_erledigt || input.ergebnis_offen) {
        let outcome = [...project.outcome];
        const mark = (values: string[] | undefined, done: boolean) => {
          for (const value of values ?? []) {
            const item = resolveNamed(value, outcome, (o) => o.text, "Ergebnis-Punkt");
            outcome = outcome.map((o) => (o.id === item.id ? { ...o, done } : o));
          }
        };
        mark(input.ergebnis_erledigt, true);
        mark(input.ergebnis_offen, false);
        outcome = [...outcome, ...outcomeItems(input.ergebnis_hinzu ?? [])];
        patch.outcome = outcome;
      }
      if (input.links_hinzu || input.links_entfernen) {
        let links = [...project.links];
        for (const value of input.links_entfernen ?? []) {
          const url = normalizeLinkUrl(value);
          const link =
            links.find((l) => l.id === value.trim() || (url !== null && l.url === url)) ??
            resolveNamed(value, links, linkLabel, "Link");
          links = links.filter((l) => l.id !== link.id);
        }
        links = [...links, ...linkItems(input.links_hinzu ?? [])];
        patch.links = links;
      }
      if (input.freitext !== undefined) {
        const free = freeText(snapshot, project.body, input.freitext, input.freitext_modus);
        patch.body = free.body;
        patch.body_text = free.body_text;
      }
      if (input.naechster_schritt !== undefined) {
        const own = snapshot.tasks.filter((t) => t.project_id === project.id);
        patch.next_task_id = input.naechster_schritt.trim()
          ? resolveNamed(input.naechster_schritt, own, (t) => t.title, "Nächster Schritt").id
          : null;
      }
      const start = (patch.start_date as string | null | undefined) ?? project.start_date;
      const target = (patch.target_date as string | null | undefined) ?? project.target_date;
      if (start && target && target < start)
        throw new ToolInputError("Das Zieldatum liegt vor dem Start.");
      const before = Object.fromEntries(
        Object.keys(patch).map((key) => [
          key,
          (project as unknown as Record<string, unknown>)[key],
        ]),
      );
      if (Object.keys(patch).length) {
        check(
          "Projekt ändern",
          await ctx.db
            .from("projects")
            .update(patch as never)
            .eq("id", project.id)
            .select("id")
            .single(),
        );
      }

      const steps = snapshot.milestones.filter((m) => m.project_id === project.id);
      const done: string[] = [];
      // für das Rückgängig: Meilenstein-Werte vorher und neue IDs (S-10)
      const milestonesBefore: Record<string, Record<string, unknown>> = {};
      for (const change of input.meilenstein_aendern ?? []) {
        const milestone = resolveNamed(change.meilenstein, steps, (m) => m.title, "Meilenstein");
        const values: Record<string, unknown> = {};
        if (change.titel !== undefined) values.title = change.titel;
        if (change.faellig !== undefined) values.due_date = change.faellig;
        if (change.erreicht !== undefined)
          values.done_at = change.erreicht ? (milestone.done_at ?? ctx.now().toISOString()) : null;
        if (!Object.keys(values).length) continue;
        milestonesBefore[milestone.id] = {
          ...Object.fromEntries(
            Object.keys(values).map((key) => [
              key,
              (milestone as unknown as Record<string, unknown>)[key],
            ]),
          ),
          ...milestonesBefore[milestone.id],
        };
        check(
          "Meilenstein ändern",
          await ctx.db
            .from("milestones")
            .update(values as never)
            .eq("id", milestone.id)
            .select("id")
            .single(),
        );
        done.push(milestone.title);
      }
      const added = input.meilenstein_hinzu ?? [];
      const addedIds = added.map(() => newId());
      if (added.length) {
        const last = steps.reduce<string | null>(
          (max, m) => (!max || m.sort > max ? m.sort : max),
          null,
        );
        const keys = generateNKeysBetween(last, null, added.length);
        check(
          "Meilensteine anlegen",
          await ctx.db
            .from("milestones")
            .insert(
              added.map((step, index) => ({
                id: addedIds[index] as string,
                project_id: project.id,
                title: step.titel,
                due_date: step.faellig ?? null,
                sort: keys[index] ?? generateKeyBetween(last, null),
              })),
            )
            .select("id"),
        );
      }
      const changed = Object.keys(patch).filter((k) => k !== "body_text");
      if (!changed.length && !done.length && !added.length) {
        throw new ToolInputError("Nichts zu ändern angegeben.");
      }
      const parts = [
        changed.length ? changed.join(", ") : null,
        done.length ? `Meilensteine geändert: ${done.join(", ")}` : null,
        added.length ? `${added.length} Meilensteine ergänzt` : null,
      ].filter(Boolean);
      const name = (patch.title as string) ?? project.title;
      await logActivity(ctx, {
        tool: "update_project",
        entity: "projekt",
        entityId: project.id,
        summary: `Projekt „${name}“ geändert (${parts.join("; ")})`,
        undo: {
          kind: "update",
          table: "projects",
          id: project.id,
          before,
          after: patch,
          ...(Object.keys(milestonesBefore).length ? { milestones_before: milestonesBefore } : {}),
          ...(addedIds.length ? { milestones_added: addedIds } : {}),
        },
      });
      const url = appUrl.project(ctx.origin, project.id);
      return {
        text: `Projekt geändert: ${ref(name, url, project.id)} · ${parts.join(" · ")}`,
        structured: { id: project.id, url },
      };
    },
  );
}
