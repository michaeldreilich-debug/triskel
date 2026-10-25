/**
 * Für list_events und delete_event (#68): welche Notizen und Aufgaben an den Terminen hängen.
 * Eigene Datei ohne Abhängigkeit zu `calendar.ts` (die Werkzeuge in `event-links.ts` nutzen dessen
 * Schemas – so entsteht kein Ring).
 */
import {
  EVENT_LINK_COLUMNS,
  linkableEvent,
  linkMatches,
  toEventLink,
} from "@/features/calendar/links";
import type { CalendarEvent } from "@/features/calendar/types";
import { type AiContext, appUrl, check, ref } from "../context";

/** Für list_events: „ · verknüpft: Notiz „…“ (id: …), Aufgabe „…“ (id: …)“ je Termin. */
export async function linkedSuffixes(
  ctx: AiContext,
  events: CalendarEvent[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = check(
    "Verknüpfungen laden",
    await ctx.db.from("event_links").select(EVENT_LINK_COLUMNS).is("deleted_at", null),
  );
  const links = (rows as unknown as Array<Record<string, unknown> & { id: string }>).map(
    toEventLink,
  );
  if (links.length === 0) return out;
  const noteIds = [...new Set(links.flatMap((l) => (l.note_id ? [l.note_id] : [])))];
  const taskIds = [...new Set(links.flatMap((l) => (l.task_id ? [l.task_id] : [])))];
  const [notes, tasks] = await Promise.all([
    noteIds.length
      ? ctx.db.from("notes").select("id, title").in("id", noteIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }>, error: null }),
    taskIds.length
      ? ctx.db.from("tasks").select("id, title").in("id", taskIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }>, error: null }),
  ]);
  const noteTitle = new Map((notes.data ?? []).map((n) => [n.id, n.title]));
  const taskTitle = new Map((tasks.data ?? []).map((t) => [t.id, t.title]));
  for (const event of events) {
    const linkable = linkableEvent(event);
    if (!linkable) continue;
    const parts = links
      .filter((l) => linkMatches(l, linkable))
      .flatMap((l) => {
        if (l.note_id && noteTitle.has(l.note_id)) {
          const title = noteTitle.get(l.note_id) ?? "";
          return [`Notiz ${ref(title, appUrl.note(ctx.origin, l.note_id), l.note_id)}`];
        }
        if (l.task_id && taskTitle.has(l.task_id)) {
          const title = taskTitle.get(l.task_id) ?? "";
          return [`Aufgabe ${ref(title, appUrl.task(ctx.origin, l.task_id), l.task_id)}`];
        }
        return [];
      });
    if (parts.length) out.set(linkable.eventId, ` · verknüpft: ${parts.join(", ")}`);
  }
  return out;
}
