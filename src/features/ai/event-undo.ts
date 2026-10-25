/**
 * „Rückgängig“ im KI-Protokoll für Google-Termine (#64, N1d): läuft in der App über die
 * vorhandenen Routen `/api/kalender/termin` (anlegen → löschen, ändern → alte Werte),
 * `…/verschieben-kalender` (zurück in den alten Kalender) und `…/wiederherstellen` (gelöscht →
 * zurück) – nicht über die Speicher-Warteschlange, denn die Daten liegen in Google. Fehler
 * (Konflikt, nicht verbunden, Termin weg) kommen als lesbarer Text zurück; der Eintrag gilt dann
 * nicht als zurückgeholt. Der Aufrufer setzt den Vermerk (`undone_at`) erst nach Erfolg.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  deleteCalendarEvent,
  moveCalendarEventToCalendar,
  patchCalendarEvent,
  restoreCalendarEvent,
  type TerminFailure,
} from "../calendar/api";
import type { CalendarEvent } from "../calendar/types";
import type { EventUndo } from "./event-undo-model";

/** Google-Kalender-ID → Kalenderquelle der App (`calendar_sources`, Zeile `kind = google`). */
export type CalendarSourceMap = ReadonlyMap<string, string>;

export async function fetchGoogleSourceMap(
  client: SupabaseClient<Database>,
): Promise<CalendarSourceMap> {
  const { data, error } = await client
    .from("calendar_sources")
    .select("id, google_calendar_id")
    .eq("kind", "google")
    .is("deleted_at", null);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of data) if (row.google_calendar_id) map.set(row.google_calendar_id, row.id);
  return map;
}

export type EventUndoResult =
  | {
      ok: true;
      note?: string;
      /** neu angelegt mit neuer ID: Verknüpfungen des alten Termins umhängen (#68) */
      retarget?: { from: string; event: CalendarEvent };
    }
  | { ok: false; message: string };

const NOT_KNOWN =
  "Der Kalender ist in der App nicht eingeschaltet – unter Einstellungen › Kalender einschalten, dann noch einmal.";

/** Meldung zu einem gescheiterten Schritt (`step` sagt, was dabei nicht ging). */
function failure(result: TerminFailure, step: string): EventUndoResult {
  switch (result.reason) {
    case "conflict":
      return {
        ok: false,
        message: `${step}: Der Termin wurde seit der KI-Änderung in Google geändert – bitte dort prüfen.`,
      };
    case "gone":
      return { ok: false, message: `${step}: Der Termin existiert in Google nicht mehr.` };
    case "reconnect":
      return {
        ok: false,
        message: `${step}: Google ist nicht mehr verbunden – unter Einstellungen › Kalender neu verbinden.`,
      };
    default:
      return { ok: false, message: `${step}: ${result.message}` };
  }
}

export async function undoEventAction(
  undo: EventUndo,
  sources: CalendarSourceMap,
): Promise<EventUndoResult> {
  const sourceOf = (calendarId: string) => sources.get(calendarId) ?? null;

  if (undo.kind === "event_create") {
    const sourceId = sourceOf(undo.calendar_id);
    if (!sourceId) return { ok: false, message: NOT_KNOWN };
    // mit etag (G-7): Hat der Nutzer den Termin seitdem geändert, meldet Google einen Konflikt –
    // seine Änderungen gehen nicht mit dem Löschen verloren
    const result = await deleteCalendarEvent({
      sourceId,
      eventId: undo.event_id,
      etag: undo.etag,
    });
    if (result.ok) return { ok: true };
    // schon weg (in Google gelöscht) – das Ziel ist erreicht
    if (result.reason === "gone") return { ok: true, note: "Der Termin war schon gelöscht." };
    return failure(result, "Termin löschen");
  }

  if (undo.kind === "event_delete") {
    const sourceId = sourceOf(undo.calendar_id);
    if (!sourceId) return { ok: false, message: NOT_KNOWN };
    const { event } = undo;
    const result = await restoreCalendarEvent({
      sourceId,
      eventId: event.event_id,
      summary: event.summary,
      location: event.location,
      description: event.description,
      allDay: event.times.allDay,
      start: event.times.start,
      end: event.times.end,
      timeZone: event.times.timeZone,
    });
    if (!result.ok) return failure(result, "Termin zurückholen");
    return result.how === "new"
      ? {
          ok: true,
          note: "Google hatte den Termin nicht mehr – neu angelegt (Gäste und Videokonferenz fehlen).",
          retarget: { from: event.event_id, event: result.event },
        }
      : { ok: true };
  }

  // event_update: erst zurück in den alten Kalender, dann die alten Werte
  let calendarId = undo.calendar_id;
  let etag = undo.etag;
  if (undo.moved_from) {
    const from = sourceOf(calendarId);
    const to = sourceOf(undo.moved_from);
    if (!from || !to) return { ok: false, message: NOT_KNOWN };
    const moved = await moveCalendarEventToCalendar({
      sourceId: from,
      destinationSourceId: to,
      eventId: undo.event_id,
      etag,
    });
    if (!moved.ok) return failure(moved, "Zurück in den alten Kalender");
    calendarId = undo.moved_from;
    etag = moved.event.google?.etag ?? etag;
  }
  const { times, ...rest } = undo.before;
  // Titel war vorher leer: Die App setzt keinen leeren Titel (G-7) – er bleibt, der Rest kommt zurück
  const { summary, ...others } = rest;
  const texts = summary === "" ? others : rest;
  const note =
    summary === "" ? "Der Titel bleibt – er war vorher leer (in Google leeren)." : undefined;
  if (times || Object.keys(texts).length > 0) {
    const sourceId = sourceOf(calendarId);
    if (!sourceId) return { ok: false, message: NOT_KNOWN };
    const patched = await patchCalendarEvent({
      sourceId,
      eventId: undo.event_id,
      etag,
      ...texts,
      ...(times
        ? { allDay: times.allDay, start: times.start, end: times.end, timeZone: times.timeZone }
        : {}),
    });
    if (!patched.ok) {
      const part = undo.moved_from ? " (der Kalender ist schon zurück)" : "";
      return failure(patched, `Alte Werte zurückschreiben${part}`);
    }
  }
  return note ? { ok: true, note } : { ok: true };
}
