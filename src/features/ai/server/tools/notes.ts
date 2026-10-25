/**
 * Notizen anlegen und ändern (#33). Inhalt als Markdown: verschachtelte Liste (Outliner),
 * `[[Titel]]` verlinkt eine vorhandene Notiz, `#tag` wird Tag, `- [ ]` eine Aufgabe im Bereich
 * und Projekt der Notiz (wie „Block → Aufgabe“). Ersetzen löscht nur weich (Rückgängig über das
 * KI-Protokoll); gelöscht wird nie.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { DEFAULT_NOTE_TYPE, normalizeTags } from "@/features/notes/types";
import { newId } from "@/lib/id";
import { keyAfter } from "@/lib/sort-key";
import { existingMediaResolver } from "../../model/media-refs";
import { lastTopSort, markdownToNoteRows, type PlannedTask } from "../../model/note-markdown";
import { type AiContext, appUrl, check, logActivity, ref } from "../context";
import { loadNoteBlocks, loadSnapshot, type Snapshot } from "../data";
import { assertAreaFollows, resolveNamed, resolveNoteType, ToolInputError } from "../resolve";
import { assertNoteNotShared } from "../shares";
import { CHANGES, CREATES, defineTool } from "./define";
import { insertEventLink, linkableLabel, readLinkableEvent, terminInput } from "./event-links";
import { id, markdown, noteType, reference, tags, title } from "./schema";

/** Notiz-ID zu `[[Titel]]`: nur ein eindeutiger, gleich lautender Titel. */
export function noteByTitle(snapshot: Snapshot) {
  return (value: string) => {
    const wanted = value.trim().toLocaleLowerCase("de");
    const hits = snapshot.notes.filter((n) => n.title.trim().toLocaleLowerCase("de") === wanted);
    return hits.length === 1 ? hits[0]?.id : undefined;
  };
}

export const titleOf =
  (snapshot: Snapshot, extra: Map<string, string> = new Map()) =>
  (noteId: string) =>
    extra.get(noteId) ?? snapshot.notes.find((n) => n.id === noteId)?.title;

/** Thema per Name/ID; auf Wunsch neu anlegen (im Bereich). */
async function topicFor(
  ctx: AiContext,
  snapshot: Snapshot,
  value: string,
  create: boolean,
  areaId: string | null,
) {
  try {
    return resolveNamed(value, snapshot.topics, (t) => t.name, "Thema");
  } catch (error) {
    if (!create || !(error instanceof ToolInputError) || !error.message.includes("nicht gefunden"))
      throw error;
    if (!areaId) throw new ToolInputError("Für ein neues Thema fehlt der Bereich.");
    const sorts = snapshot.topics.filter((t) => t.area_id === areaId).map((t) => t.sort);
    const topic = {
      id: newId(),
      area_id: areaId,
      name: value.trim(),
      sort: sorts.length ? keyAfter(sorts) : generateKeyBetween(null, null),
      archived_at: null,
      deleted_at: null,
    };
    check("Thema anlegen", await ctx.db.from("topics").insert(topic).select("id").single());
    snapshot.topics.push(topic);
    await logActivity(ctx, {
      tool: "create_note",
      entity: "thema",
      entityId: topic.id,
      summary: `Thema „${topic.name}“ angelegt`,
    });
    return topic;
  }
}

/** Checkbox-Zeilen als Aufgaben anlegen (vor den Blöcken, die auf sie zeigen). */
async function insertBlockTasks(
  ctx: AiContext,
  snapshot: Snapshot,
  tasks: PlannedTask[],
  place: { area_id: string; project_id: string | null },
) {
  if (tasks.length === 0) return;
  let sort = keyAfter(snapshot.tasks.map((t) => t.sort));
  const rows = tasks.map((task) => {
    const row = {
      id: task.id,
      title: task.title.slice(0, 500),
      area_id: place.area_id,
      project_id: place.project_id,
      status: task.done ? "erledigt" : "offen",
      in_inbox: false,
      sort,
    };
    sort = keyAfter([sort]);
    return row;
  });
  check("Aufgaben aus Checkboxen anlegen", await ctx.db.from("tasks").insert(rows).select("id"));
}

export async function insertBlocks(
  ctx: AiContext,
  noteId: string,
  rows: ReturnType<typeof markdownToNoteRows>["rows"],
) {
  if (rows.length === 0) return;
  check(
    "Inhalt speichern",
    await ctx.db
      .from("note_blocks")
      .insert(
        rows.map((row) => ({
          id: row.id,
          note_id: noteId,
          parent_id: row.parent_id,
          sort: row.sort,
          content: row.content as never,
          content_text: row.content_text,
          collapsed: row.collapsed,
          task_id: row.task_id,
        })),
      )
      .select("id"),
  );
}

/** Wem der Bereich einer Notiz folgt: Projekt vor Thema (wie der Trigger in Migration 05). */
function ownerOf(
  project: { title: string; area_id: string } | null,
  topic: { name: string; area_id: string } | null,
) {
  if (project) return { kind: "Projekt" as const, name: project.title, area_id: project.area_id };
  if (topic) return { kind: "Thema" as const, name: topic.name, area_id: topic.area_id };
  return null;
}

export function registerNoteTools(server: McpServer, ctx: AiContext) {
  /* ---------------- create_note ---------------- */
  defineTool(
    server,
    "create_note",
    {
      title: "Notiz anlegen",
      description: [
        "Legt eine Notiz an. Inhalt als Markdown – am besten als verschachtelte Liste („- Punkt“, zwei Leerzeichen je Ebene). Zeilen können „# “ bis „### “ (Überschrift), „> “ (Zitat), „> [!note] “ (Hinweis-Kasten) oder „---“ (Trennlinie) sein, ==Text== markiert.",
        "`[[Titel]]` verlinkt eine vorhandene Notiz, `#tag` wird ein Tag, `- [ ] Text` wird eine echte Aufgabe (im Bereich/Projekt der Notiz) – Checkboxen nur für echte Aufgaben.",
        "```mermaid-Blöcke werden Diagramme. Keine Tabellen (stattdessen Liste). Zuordnung: Thema für dauerhaftes Wissen, Projekt für Projektnotizen; der Bereich ergibt sich daraus, sonst angeben.",
        "Typ: dauerhaftes Wissen und Abläufe als „wissen“ bzw. „anleitung“ (nur diese Typen stehen in der App unter Wissen, auch mit Projekt); schnelle Notizen bleiben „idee“ (Standard).",
        "„termin“ (IDs aus list_events) verknüpft die Notiz mit einem Google-Termin, z. B. das Protokoll einer Besprechung (typ „protokoll“).",
      ].join(" "),
      input: z.object({
        titel: title,
        inhalt: markdown.optional(),
        typ: noteType.default(DEFAULT_NOTE_TYPE),
        bereich: reference("Bereich").optional(),
        thema: reference("Thema").optional(),
        thema_anlegen: z
          .boolean()
          .default(false)
          .describe("true: Thema neu anlegen, wenn es den Namen nicht gibt"),
        projekt: reference("Projekt").optional(),
        aufgabe: reference("Aufgabe").optional().describe("Notiz gehört zu dieser Aufgabe"),
        tags: tags.optional(),
        termin: terminInput.optional(),
      }),
      annotations: CREATES,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      // Termin zuerst lesen: Ist er nicht da, entsteht auch keine halbe Notiz (#68)
      const linked = input.termin ? await readLinkableEvent(ctx, input.termin) : null;
      const project = input.projekt
        ? resolveNamed(input.projekt, snapshot.projects, (p) => p.title, "Projekt")
        : null;
      const explicitArea = input.bereich
        ? resolveNamed(input.bereich, snapshot.areas, (a) => a.name, "Bereich")
        : null;
      const topic = input.thema
        ? await topicFor(
            ctx,
            snapshot,
            input.thema,
            input.thema_anlegen,
            explicitArea?.id ?? project?.area_id ?? null,
          )
        : null;
      const task = input.aufgabe
        ? resolveNamed(input.aufgabe, snapshot.tasks, (t) => t.title, "Aufgabe")
        : null;
      if (explicitArea) {
        // der Bereich folgt Projekt bzw. Thema (Trigger) – Abweichendes nicht still verwerfen (S-9)
        assertAreaFollows(explicitArea, ownerOf(project, topic));
      }
      const areaId =
        project?.area_id ?? topic?.area_id ?? explicitArea?.id ?? task?.area_id ?? null;
      if (!areaId) {
        throw new ToolInputError(
          `Bereich fehlt: Bereich, Thema oder Projekt angeben (${snapshot.areas.map((a) => a.name).join(", ")}).`,
        );
      }
      const note = {
        id: newId(),
        title: input.titel,
        type: resolveNoteType(input.typ, snapshot.noteTypes),
        area_id: areaId,
        topic_id: topic?.id ?? null,
        project_id: project?.id ?? null,
        task_id: task?.id ?? null,
        tags: normalizeTags(input.tags ?? []),
      };
      check("Notiz anlegen", await ctx.db.from("notes").insert(note).select("id").single());
      const titles = new Map([[note.id, note.title]]);
      const plan = markdownToNoteRows(input.inhalt ?? "", {
        newId,
        resolveNoteByTitle: noteByTitle(snapshot),
        resolveTitle: titleOf(snapshot, titles),
      });
      await insertBlockTasks(ctx, snapshot, plan.tasks, {
        area_id: areaId,
        project_id: note.project_id,
      });
      await insertBlocks(ctx, note.id, plan.rows);
      if (linked && input.termin) {
        await insertEventLink(
          ctx,
          linked.linkable,
          { kind: "notiz", id: note.id },
          input.termin.serie,
        );
      }
      await logActivity(ctx, {
        tool: "create_note",
        entity: "notiz",
        entityId: note.id,
        summary: `Notiz „${note.title}“ angelegt (${plan.rows.length} Zeilen${plan.tasks.length ? `, ${plan.tasks.length} Aufgaben` : ""})`,
      });
      const url = appUrl.note(ctx.origin, note.id);
      return {
        text: `Notiz angelegt: ${ref(note.title, url, note.id)} · ${plan.rows.length} Zeilen${
          plan.tasks.length ? ` · ${plan.tasks.length} Aufgaben aus Checkboxen` : ""
        }${linked ? ` · verknüpft mit Termin ${linkableLabel(linked.linkable)}` : ""}`,
        structured: { id: note.id, url },
      };
    },
  );

  /* ---------------- update_note ---------------- */
  defineTool(
    server,
    "update_note",
    {
      title: "Notiz ändern",
      description: [
        "Ändert Eigenschaften einer Notiz und/oder ihren Inhalt (Markdown wie bei create_note).",
        "Öffentlich freigegebene Notizen (Hinweis in „fetch“) ändert die KI nicht – das macht der Nutzer in der App.",
        "inhalt_modus „anhaengen“ (Standard) setzt den Text unten an; „ersetzen“ tauscht den ganzen Inhalt – der alte bleibt im KI-Protokoll zum Zurückholen. Vorher mit „fetch“ lesen.",
        "Bilder und Dateien der Notiz bleiben, wo ihre Verweise aus „fetch“ (![[…]] bzw. [[…]]) im neuen Text stehen – fehlt ein Verweis, fehlt das Bild danach.",
        'projekt/thema: "" entfernt die Zuordnung. tags ersetzt alle Tags, tags_hinzu ergänzt.',
      ].join(" "),
      input: z.object({
        id,
        titel: title.optional(),
        typ: noteType.optional(),
        bereich: reference("Bereich").optional(),
        thema: z.string().max(200).optional(),
        projekt: z.string().max(200).optional(),
        tags: tags.optional(),
        tags_hinzu: tags.optional(),
        inhalt: markdown.optional(),
        inhalt_modus: z.enum(["anhaengen", "ersetzen"]).default("anhaengen"),
      }),
      annotations: CHANGES,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const note = snapshot.notes.find((n) => n.id === input.id);
      if (!note) throw new ToolInputError(`Notiz ${input.id} nicht gefunden.`);
      // öffentlich freigegeben (#94): die KI ändert sie gar nicht – auch keine Eigenschaften
      await assertNoteNotShared(ctx, note.id);
      const patch: Record<string, unknown> = {};
      if (input.titel !== undefined) patch.title = input.titel;
      if (input.typ !== undefined) patch.type = resolveNoteType(input.typ, snapshot.noteTypes);
      if (input.thema !== undefined)
        patch.topic_id = input.thema.trim()
          ? resolveNamed(input.thema, snapshot.topics, (t) => t.name, "Thema").id
          : null;
      if (input.projekt !== undefined)
        patch.project_id = input.projekt.trim()
          ? resolveNamed(input.projekt, snapshot.projects, (p) => p.title, "Projekt").id
          : null;
      if (input.bereich !== undefined) {
        const area = resolveNamed(input.bereich, snapshot.areas, (a) => a.name, "Bereich");
        const projectId = patch.project_id !== undefined ? patch.project_id : note.project_id;
        const topicId = patch.topic_id !== undefined ? patch.topic_id : note.topic_id;
        const owner = ownerOf(
          snapshot.projects.find((p) => p.id === projectId) ?? null,
          snapshot.topics.find((t) => t.id === topicId) ?? null,
        );
        assertAreaFollows(area, owner);
        if (!owner) patch.area_id = area.id;
      }
      if (input.tags !== undefined || input.tags_hinzu !== undefined)
        patch.tags = normalizeTags([...(input.tags ?? note.tags), ...(input.tags_hinzu ?? [])]);
      const before = Object.fromEntries(
        Object.keys(patch).map((key) => [key, (note as unknown as Record<string, unknown>)[key]]),
      );

      // Erst alles planen, dann das Protokoll schreiben, dann ändern (K-5): Scheitert das
      // Protokoll, bleibt die Notiz wie sie ist; scheitert ein Schritt danach, führt das
      // Rückgängig trotzdem zum Stand vorher (nicht Angewandtes ist dabei ein Leerlauf).
      let content = "";
      let undo: Record<string, unknown> | null = Object.keys(patch).length
        ? { kind: "update", table: "notes", id: note.id, before, after: patch }
        : null;
      let plan: ReturnType<typeof markdownToNoteRows> | null = null;
      let existing: Awaited<ReturnType<typeof loadNoteBlocks>> = [];
      const replace = input.inhalt_modus === "ersetzen";
      if (input.inhalt !== undefined) {
        existing = await loadNoteBlocks(ctx, note.id);
        plan = markdownToNoteRows(input.inhalt, {
          newId,
          resolveNoteByTitle: noteByTitle(snapshot),
          resolveTitle: titleOf(snapshot),
          // Bilder/Dateien der Notiz: ![[…]]/[[…]] aus „fetch“ werden wieder ihre Knoten (O8)
          resolveMedia: existingMediaResolver(existing.map((b) => b.content)),
          afterSort: replace ? null : lastTopSort(existing),
        });
        content = replace
          ? ` · Inhalt ersetzt (${plan.rows.length} Zeilen statt ${existing.length})`
          : ` · ${plan.rows.length} Zeilen angehängt`;
        undo = {
          kind: replace ? "replace" : "append",
          note_id: note.id,
          removed: replace ? existing.map((b) => b.id) : [],
          added: plan.rows.map((r) => r.id),
          ...(undo ? { note_before: before } : {}),
          // Aufgaben aus `- [ ]` kommen beim Rückgängig mit in den Papierkorb (S-4)
          ...(plan.tasks.length ? { tasks_added: plan.tasks.map((t) => t.id) } : {}),
        };
      }
      if (!content && Object.keys(patch).length === 0) {
        throw new ToolInputError("Nichts zu ändern angegeben.");
      }
      const changed = Object.keys(patch).join(", ");
      await logActivity(ctx, {
        tool: "update_note",
        entity: "notiz",
        entityId: note.id,
        summary: `Notiz „${(patch.title as string) ?? note.title}“ geändert${changed ? ` (${changed})` : ""}${content}`,
        undo,
      });

      if (Object.keys(patch).length > 0) {
        check(
          "Notiz ändern",
          await ctx.db
            .from("notes")
            .update(patch as never)
            .eq("id", note.id)
            .select("id")
            .single(),
        );
      }
      if (plan) {
        const areaId = (patch.area_id as string | undefined) ?? note.area_id;
        const projectId =
          patch.project_id !== undefined ? (patch.project_id as string | null) : note.project_id;
        await insertBlockTasks(ctx, snapshot, plan.tasks, {
          area_id: areaId,
          project_id: projectId,
        });
        // erst den neuen Inhalt einfügen, dann den alten ablegen (K-5): scheitert das Einfügen,
        // steht die Notiz unverändert da statt leer
        await insertBlocks(ctx, note.id, plan.rows);
        if (replace && existing.length > 0) {
          check(
            "Alten Inhalt entfernen",
            await ctx.db
              .from("note_blocks")
              .update({ deleted_at: ctx.now().toISOString() })
              .in(
                "id",
                existing.map((b) => b.id),
              )
              .select("id"),
          );
        }
      }
      const url = appUrl.note(ctx.origin, note.id);
      return {
        text: `Notiz geändert: ${ref((patch.title as string) ?? note.title, url, note.id)}${changed ? ` · ${changed}` : ""}${content}`,
        structured: { id: note.id, url },
      };
    },
  );
}
