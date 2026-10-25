/**
 * In den Papierkorb legen (#33, E29): wie „Löschen“ in der App – nur `deleted_at`, der Eintrag
 * bleibt im Papierkorb und lässt sich dort oder über das KI-Protokoll zurückholen. Endgültig
 * löschen und „Papierkorb leeren“ gibt es für die KI nicht. Nur per ID (nie per Name raten);
 * als zerstörerisch markiert, damit Claude bzw. ChatGPT vor jedem Aufruf nachfragen.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type AiContext, appUrl, check, type Entity, logActivity, ref } from "../context";
import { ToolInputError } from "../resolve";
import { isNoteShared, SHARED_NOTE_TRASHED } from "../shares";
import { defineTool, TRASHES } from "./define";
import { id } from "./schema";

const KINDS = {
  notiz: { table: "notes", label: "Notiz", url: appUrl.note },
  aufgabe: { table: "tasks", label: "Aufgabe", url: appUrl.task },
  projekt: { table: "projects", label: "Projekt", url: appUrl.project },
} as const;

export function registerTrashTools(server: McpServer, ctx: AiContext) {
  defineTool(
    server,
    "trash",
    {
      title: "In den Papierkorb legen",
      description: [
        "Legt eine Notiz, Aufgabe oder ein Projekt in den Papierkorb der App – wiederherstellbar, nichts wird endgültig gelöscht.",
        "Nur auf ausdrücklichen Wunsch des Nutzers und erst nach seiner Bestätigung im Chat; vorher mit „fetch“ prüfen, dass es der richtige Eintrag ist.",
        "Nur per ID. Bei einem Projekt bleiben seine Aufgaben und Notizen erhalten.",
      ].join(" "),
      input: z.object({
        typ: z.enum(["notiz", "aufgabe", "projekt"]),
        id,
      }),
      annotations: TRASHES,
    },
    async (input) => {
      const kind = KINDS[input.typ];
      const found = await ctx.db
        .from(kind.table)
        .select("id, title")
        .eq("id", input.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (found.error) check(`${kind.label} lesen`, found);
      const row = found.data as { id: string; title: string } | null;
      if (!row) {
        throw new ToolInputError(
          `${kind.label} ${input.id} nicht gefunden oder schon im Papierkorb.`,
        );
      }
      // freigegebene Notiz (K-3): erlaubt, aber mit Hinweis – der öffentliche Link zeigt dann nichts
      const shared = input.typ === "notiz" ? await isNoteShared(ctx, row.id) : false;
      check(
        `${kind.label} in den Papierkorb legen`,
        await ctx.db
          .from(kind.table)
          .update({ deleted_at: ctx.now().toISOString() } as never)
          .eq("id", row.id)
          .select("id")
          .single(),
      );
      const name = row.title.trim() || "Ohne Titel";
      await logActivity(ctx, {
        tool: "trash",
        entity: input.typ as Entity,
        entityId: row.id,
        summary: `${kind.label} „${name}“ in den Papierkorb gelegt`,
        undo: { kind: "trash", table: kind.table, id: row.id },
      });
      return {
        text: `In den Papierkorb gelegt: ${ref(name, kind.url(ctx.origin, row.id), row.id)}. Zurückholen: in der App unter Papierkorb oder Einstellungen › KI-Zugänge › „Rückgängig“.${
          shared ? ` ${SHARED_NOTE_TRASHED}` : ""
        }`,
        structured: { id: row.id, typ: input.typ, papierkorb: true, oeffentlich: shared },
      };
    },
  );
}
