/**
 * Aufgabe ↔ Notiz umwandeln (#65, E36): das Neue wird angelegt (Titel, Inhalt samt Bildern und
 * Dateien, Bereich und Projekt), das Original kommt in den Papierkorb – nie endgültig gelöscht.
 * Das KI-Protokoll hält das Rückgängig (Original zurück, Neues in den Papierkorb). Die
 * Umrechnung des Inhalts ist dieselbe wie in der App (`features/convert/model`).
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  bodyTextOf,
  lostByNoteToTask,
  lostByTaskToNote,
  rowsToTaskBody,
  taskBodyToRows,
} from "@/features/convert/model";
import { DEFAULT_NOTE_TYPE, preferredNoteType } from "@/features/notes/types";
import { newId } from "@/lib/id";
import { keyAfter } from "@/lib/sort-key";
import { type AiContext, appUrl, check, logActivity, ref } from "../context";
import { loadNoteBlocks, loadSnapshot } from "../data";
import { resolveNamed, ToolInputError } from "../resolve";
import { isNoteShared, SHARED_NOTE_TRASHED } from "../shares";
import { defineTool, TRASHES } from "./define";
import { insertBlocks, titleOf } from "./notes";
import { id, reference } from "./schema";

export function registerConvertTools(server: McpServer, ctx: AiContext) {
  defineTool(
    server,
    "convert",
    {
      title: "Aufgabe oder Notiz umwandeln",
      description: [
        "Wandelt eine Aufgabe in eine Notiz (in: „notiz“) oder eine Notiz in eine Aufgabe (in: „aufgabe“) um; id ist das Original. Projekte lassen sich nicht umwandeln.",
        "Titel, Inhalt (Checklisten-Punkte der Aufgabe stehen in der Notiz als Zeile mit ☐/☑, Bilder und Dateien bleiben), Bereich und Projekt gehen mit; Fälligkeit, Priorität, Status und Wiederholung einer Aufgabe bzw. Typ, Thema und Tags einer Notiz nicht – die Antwort nennt, was fehlt.",
        "Das Original kommt in den Papierkorb (wiederherstellbar, im KI-Protokoll rückgängig zu machen). Nur auf ausdrücklichen Wunsch des Nutzers und nach seiner Bestätigung im Chat.",
        "Eine Aufgabe ohne Bereich und Projekt (Inbox) braucht für die Notiz einen Bereich.",
      ].join(" "),
      input: z.object({
        id,
        in: z.enum(["notiz", "aufgabe"]).describe("Zielart; das Original ist die jeweils andere"),
        bereich: reference("Bereich")
          .optional()
          .describe("nur für Inbox-Aufgaben → Notiz (Bereich der neuen Notiz)"),
      }),
      annotations: TRASHES,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const now = ctx.now().toISOString();
      if (input.in === "notiz") {
        const task = snapshot.tasks.find((t) => t.id === input.id);
        if (!task) {
          throw new ToolInputError(
            `Aufgabe ${input.id} nicht gefunden oder schon im Papierkorb. Für Notiz → Aufgabe: in „aufgabe“ angeben.`,
          );
        }
        const project = snapshot.projects.find((p) => p.id === task.project_id);
        const explicit = input.bereich
          ? resolveNamed(input.bereich, snapshot.areas, (a) => a.name, "Bereich")
          : null;
        const areaId = project?.area_id ?? task.area_id ?? explicit?.id ?? null;
        if (!areaId) {
          throw new ToolInputError(
            `Die Aufgabe liegt in der Inbox – für die Notiz fehlt der Bereich (bereich: ${snapshot.areas.map((a) => a.name).join(", ")}).`,
          );
        }
        const note = {
          id: newId(),
          title: task.title,
          type: preferredNoteType(DEFAULT_NOTE_TYPE, snapshot.noteTypes),
          area_id: areaId,
          project_id: task.project_id,
          topic_id: null,
          task_id: null,
          tags: [] as string[],
        };
        check("Notiz anlegen", await ctx.db.from("notes").insert(note).select("id").single());
        const rows = taskBodyToRows(task.body, newId);
        await insertBlocks(ctx, note.id, rows);
        check(
          "Aufgabe in den Papierkorb legen",
          await ctx.db
            .from("tasks")
            .update({ deleted_at: now })
            .eq("id", task.id)
            .select("id")
            .single(),
        );
        // Verknüpfungen, die eine Notiz nicht kennt (V-8): nennen statt still verlieren
        const eventLinks = await ctx.db
          .from("event_links")
          .select("id")
          .eq("task_id", task.id)
          .is("deleted_at", null);
        const dependencies = await ctx.db
          .from("task_dependencies")
          .select("task_id, blocked_by_task_id, deleted_at")
          .or(`task_id.eq.${task.id},blocked_by_task_id.eq.${task.id}`);
        const lost = lostByTaskToNote(task, {
          eventLinks: eventLinks.data?.length ?? 0,
          dependencies: (dependencies.data ?? []).filter((d) => !d.deleted_at).length,
        });
        await logActivity(ctx, {
          tool: "convert",
          entity: "notiz",
          entityId: note.id,
          summary: `Aufgabe „${task.title.trim() || "Ohne Titel"}“ in Notiz umgewandelt (${rows.length} Zeilen)`,
          undo: {
            kind: "convert",
            restore: { table: "tasks", id: task.id },
            trash: { table: "notes", id: note.id },
          },
        });
        const url = appUrl.note(ctx.origin, note.id);
        return {
          text: `Aufgabe ist jetzt eine Notiz: ${ref(note.title, url, note.id)} · ${rows.length} Zeilen · die Aufgabe liegt im Papierkorb${
            lost.length ? ` · nicht übernommen: ${lost.join(", ")}` : ""
          }`,
          structured: { id: note.id, url, original_id: task.id, nicht_uebernommen: lost },
        };
      }

      const note = snapshot.notes.find((n) => n.id === input.id);
      if (!note) {
        throw new ToolInputError(
          `Notiz ${input.id} nicht gefunden oder schon im Papierkorb. Für Aufgabe → Notiz: in „notiz“ angeben.`,
        );
      }
      // freigegebene Notiz (K-3): erlaubt, aber mit Hinweis – der öffentliche Link zeigt dann nichts
      const shared = await isNoteShared(ctx, note.id);
      const blocks = await loadNoteBlocks(ctx, note.id);
      const body = rowsToTaskBody(blocks, {
        taskDone: (taskId) => {
          const status = snapshot.tasks.find((t) => t.id === taskId)?.status;
          return status === undefined ? undefined : status === "erledigt";
        },
        resolveTitle: titleOf(snapshot),
      });
      const task = {
        id: newId(),
        title: note.title,
        area_id: note.area_id,
        project_id: note.project_id,
        in_inbox: false,
        status: "offen" as const,
        body: body as never,
        body_text: bodyTextOf(body, { resolveTitle: titleOf(snapshot) }),
        sort: keyAfter(snapshot.tasks.map((t) => t.sort)),
      };
      check("Aufgabe anlegen", await ctx.db.from("tasks").insert(task).select("id").single());
      check(
        "Notiz in den Papierkorb legen",
        await ctx.db
          .from("notes")
          .update({ deleted_at: now })
          .eq("id", note.id)
          .select("id")
          .single(),
      );
      const eventLinks = await ctx.db
        .from("event_links")
        .select("id")
        .eq("note_id", note.id)
        .is("deleted_at", null);
      const lost = lostByNoteToTask(note, DEFAULT_NOTE_TYPE, {
        eventLinks: eventLinks.data?.length ?? 0,
        shared,
      });
      // Verweise [[…]] anderer Notizen zeigen danach auf die Notiz im Papierkorb
      const links = await ctx.db
        .from("links")
        .select("source_note_id")
        .eq("target_note_id", note.id)
        .is("deleted_at", null);
      const linking = new Set((links.data ?? []).map((l) => l.source_note_id)).size;
      await logActivity(ctx, {
        tool: "convert",
        entity: "aufgabe",
        entityId: task.id,
        summary: `Notiz „${note.title.trim() || "Ohne Titel"}“ in Aufgabe umgewandelt`,
        undo: {
          kind: "convert",
          restore: { table: "notes", id: note.id },
          trash: { table: "tasks", id: task.id },
        },
      });
      const url = appUrl.task(ctx.origin, task.id);
      return {
        text: `Notiz ist jetzt eine Aufgabe: ${ref(task.title, url, task.id)} · die Notiz liegt im Papierkorb${
          lost.length ? ` · nicht übernommen: ${lost.join(", ")}` : ""
        }${linking ? ` · ${linking} Notiz(en) verweisen noch per [[…]] auf die alte Notiz (Verweis zeigt ins Leere, bis sie zurückgeholt wird)` : ""}${
          shared ? ` · ${SHARED_NOTE_TRASHED}` : ""
        }`,
        structured: {
          id: task.id,
          url,
          original_id: note.id,
          nicht_uebernommen: lost,
          oeffentlich: shared,
        },
      };
    },
  );
}
