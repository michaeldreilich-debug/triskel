/**
 * Termine mit Aufgaben und Notizen verknüpfen (#68, Stück 2) für die KI: `link_event`,
 * `unlink_event` und der gemeinsame Teil von `create_note`/`create_task` mit „termin“. Der Termin
 * wird in Google gelesen (Titel und Zeit als Schnappschuss), Google selbst bleibt unverändert.
 * Lösen entfernt nur die Verknüpfung (Soft-Delete), nie die Notiz oder Aufgabe. Jede Aktion steht
 * im KI-Protokoll mit Rückgängig.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  EVENT_LINK_COLUMNS,
  type EventLinkRow,
  eventWhenLabel,
  type LinkableEvent,
  linkableEvent,
  linkMatches,
  snapshotOf,
  toEventLink,
} from "@/features/calendar/links";
import type { CalendarEvent } from "@/features/calendar/types";
import { type AiContext, appUrl, check, DataError, logActivity, ref } from "../context";
import { asToolError, openGoogle, pickCalendar } from "../google";
import { ToolInputError } from "../resolve";
import { kalenderRef, readEvent, terminId } from "./calendar";
import { CHANGES, CREATES, defineTool } from "./define";
import { id } from "./schema";

/** „termin“ bei create_note/create_task und das Ziel von link_event. */
export const terminInput = z
  .object({
    kalender: kalenderRef,
    termin: terminId,
    serie: z
      .boolean()
      .default(false)
      .describe(
        "true = für jedes Vorkommen einer Serie (z. B. Aufgabe „Material prüfen“); Standard nur dieses Mal (z. B. Protokoll)",
      ),
  })
  .describe("Google-Termin (IDs aus list_events), mit dem verknüpft wird");

export type TerminInput = z.output<typeof terminInput>;

export type LinkTargetRef = { kind: "notiz"; id: string } | { kind: "aufgabe"; id: string };

/** Termin in Google lesen (vor dem Anlegen, damit nichts halb entsteht). */
export async function readLinkableEvent(
  ctx: AiContext,
  input: TerminInput,
): Promise<{ event: CalendarEvent; linkable: LinkableEvent; calendarName: string }> {
  const google = await openGoogle(ctx).catch((caught) => {
    throw asToolError(caught);
  });
  const calendar = pickCalendar(google.calendars, input.kalender);
  const { event } = await readEvent(google, calendar, input.termin);
  const linkable = linkableEvent(event);
  if (!linkable) throw new ToolInputError("Dieser Termin lässt sich nicht verknüpfen.");
  if (input.serie && !linkable.recurringEventId) {
    throw new ToolInputError("Der Termin gehört zu keiner Serie – „serie“ weglassen.");
  }
  return { event, linkable, calendarName: calendar.name };
}

/** Verknüpfungen (ohne gelöste) einer Notiz bzw. Aufgabe. */
async function linksOf(ctx: AiContext, target: LinkTargetRef): Promise<EventLinkRow[]> {
  const rows = check(
    "Verknüpfungen laden",
    await ctx.db
      .from("event_links")
      .select(EVENT_LINK_COLUMNS)
      .eq(target.kind === "notiz" ? "note_id" : "task_id", target.id)
      .is("deleted_at", null),
  );
  return (rows as unknown as Array<Record<string, unknown> & { id: string }>).map(toEventLink);
}

/** Verknüpfung anlegen (schon vorhanden: die vorhandene). */
export async function insertEventLink(
  ctx: AiContext,
  linkable: LinkableEvent,
  target: LinkTargetRef,
  series: boolean,
): Promise<{ id: string; existed: boolean }> {
  const scope = series ? "series" : "occurrence";
  const existing = (await linksOf(ctx, target)).find(
    (l) => l.scope === scope && linkMatches(l, linkable),
  );
  if (existing) return { id: existing.id, existed: true };
  const { data, error } = await ctx.db
    .from("event_links")
    .insert({
      google_calendar_id: linkable.calendarId,
      event_id: linkable.eventId,
      recurring_event_id: linkable.recurringEventId,
      scope,
      task_id: target.kind === "aufgabe" ? target.id : null,
      note_id: target.kind === "notiz" ? target.id : null,
      ...snapshotOf(linkable),
    })
    .select("id")
    .single();
  if (error || !data) throw new DataError("Verknüpfen", error);
  return { id: data.id, existed: false };
}

/** „Mi, 21.10. 19:00–21:00 · Übungsdienst“ */
export const linkableLabel = (event: LinkableEvent) =>
  `${eventWhenLabel(event.start, event.end, event.allDay)} · ${event.title.trim() || "Termin"}`;

/** Gibt es die Notiz bzw. Aufgabe (nicht im Papierkorb)? Titel für die Antwort. */
async function targetTitle(ctx: AiContext, target: LinkTargetRef): Promise<string> {
  const query =
    target.kind === "notiz"
      ? ctx.db.from("notes").select("id, title").eq("id", target.id)
      : ctx.db.from("tasks").select("id, title").eq("id", target.id);
  const { data: row, error } = await query.is("deleted_at", null).maybeSingle();
  if (error) throw new DataError(target.kind === "notiz" ? "Notiz laden" : "Aufgabe laden", error);
  if (!row) {
    throw new ToolInputError(
      `${target.kind === "notiz" ? "Notiz" : "Aufgabe"} ${target.id} nicht gefunden (oder im Papierkorb).`,
    );
  }
  return row.title.trim() || "Ohne Titel";
}

function targetOf(input: { notiz?: string; aufgabe?: string }): LinkTargetRef {
  if (input.notiz && input.aufgabe) {
    throw new ToolInputError("Entweder notiz oder aufgabe angeben, nicht beides.");
  }
  if (input.notiz) return { kind: "notiz", id: input.notiz };
  if (input.aufgabe) return { kind: "aufgabe", id: input.aufgabe };
  throw new ToolInputError("notiz oder aufgabe fehlt (ID aus fetch, search oder den Listen).");
}

const targetRef = (ctx: AiContext, target: LinkTargetRef, title: string) =>
  target.kind === "notiz"
    ? `Notiz ${ref(title, appUrl.note(ctx.origin, target.id), target.id)}`
    : `Aufgabe ${ref(title, appUrl.task(ctx.origin, target.id), target.id)}`;

export function registerEventLinkTools(server: McpServer, ctx: AiContext) {
  /* ---------------- link_event ---------------- */
  defineTool(
    server,
    "link_event",
    {
      title: "Termin verknüpfen",
      description: [
        "Verknüpft einen Google-Termin (IDs aus list_events) mit einer vorhandenen Notiz oder Aufgabe – in der App steht der Termin dann oben in der Notiz/Aufgabe und die Notiz/Aufgabe im Termin.",
        "Für eine neue Notiz oder Aufgabe zum Termin stattdessen create_note bzw. create_task mit „termin“.",
        "Google selbst bleibt unverändert.",
      ].join(" "),
      input: z.object({
        ...terminInput.shape,
        notiz: id.optional().describe("ID der Notiz"),
        aufgabe: id.optional().describe("ID der Aufgabe"),
      }),
      annotations: CREATES,
    },
    async (input) => {
      const target = targetOf(input);
      const title = await targetTitle(ctx, target);
      const { linkable } = await readLinkableEvent(ctx, input);
      const link = await insertEventLink(ctx, linkable, target, input.serie);
      const what = `${linkableLabel(linkable)}${input.serie ? " (ganze Serie)" : ""}`;
      if (link.existed) {
        return { text: `Schon verknüpft: Termin ${what} ↔ ${targetRef(ctx, target, title)}.` };
      }
      await logActivity(ctx, {
        tool: "link_event",
        entity: target.kind,
        entityId: target.id,
        summary: `Termin ${what} mit „${title}“ verknüpft`,
        undo: {
          kind: "update",
          table: "event_links",
          id: link.id,
          before: { deleted_at: new Date(ctx.now()).toISOString() },
        },
      });
      return {
        text: `Verknüpft: Termin ${what} ↔ ${targetRef(ctx, target, title)}.`,
        structured: { id: link.id },
      };
    },
  );

  /* ---------------- unlink_event ---------------- */
  defineTool(
    server,
    "unlink_event",
    {
      title: "Termin-Verknüpfung lösen",
      description:
        "Löst die Verknüpfung eines Termins mit einer Notiz oder Aufgabe (IDs aus list_events bzw. fetch). Notiz, Aufgabe und Termin bleiben unverändert.",
      input: z.object({
        kalender: kalenderRef.optional().describe("Kalender (nur zur Kontrolle, sonst egal)"),
        termin: terminId,
        notiz: id.optional().describe("ID der Notiz"),
        aufgabe: id.optional().describe("ID der Aufgabe"),
      }),
      annotations: CHANGES,
    },
    async (input) => {
      const target = targetOf(input);
      const title = await targetTitle(ctx, target);
      const links = (await linksOf(ctx, target)).filter(
        (l) => l.event_id === input.termin || l.recurring_event_id === input.termin,
      );
      if (links.length === 0) {
        throw new ToolInputError(`„${title}“ ist mit diesem Termin nicht verknüpft.`);
      }
      for (const link of links) {
        check(
          "Lösen",
          await ctx.db
            .from("event_links")
            .update({ deleted_at: new Date(ctx.now()).toISOString() })
            .eq("id", link.id)
            .select("id")
            .single(),
        );
        await logActivity(ctx, {
          tool: "unlink_event",
          entity: target.kind,
          entityId: target.id,
          summary: `Verknüpfung von „${title}“ mit Termin „${link.event_title}“ gelöst`,
          undo: { kind: "trash", table: "event_links", id: link.id },
        });
      }
      const first = links[0] as EventLinkRow;
      return {
        text: `Gelöst: ${targetRef(ctx, target, title)} ist nicht mehr mit dem Termin „${first.event_title}“ (${eventWhenLabel(first.event_start, first.event_end, first.event_all_day)}) verknüpft. Notiz/Aufgabe und Termin bleiben.`,
      };
    },
  );
}
