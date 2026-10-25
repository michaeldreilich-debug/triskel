/**
 * Google-Termine für die KI (#64, N1d, Rückmeldung: „KI ist mein Assistent“): lesen, anlegen, ändern
 * (Zeit, Dauer, Titel, Ort, Beschreibung, Kalender) und löschen – mit denselben Diensten wie die
 * App (`event-service.ts`, Eingabeprüfung aus `google/`). Gäste bekommen nie etwas
 * (`sendUpdates=none`), Änderungen laufen mit etag (If-Match), bei Serien trifft es nur den einen
 * Termin. Jede Schreibaktion steht im KI-Protokoll mit Rückgängig-Daten (`event-undo-model.ts`);
 * Löschen nur nach Rückfrage im Chat (E35, wie „trash“). Die Kalender kommen aus Googles
 * Kalenderliste – `calendar_sources` mit den geheimen iCal-Adressen sieht die KI nicht.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DEFAULT_TIME_ZONE } from "@/features/calendar/google/event-input";
import {
  type GoogleEventRaw,
  GoogleEventSchema,
  normalizeGoogleEvent,
} from "@/features/calendar/google/events";
import { getGoogleEvent, listGoogleEvents } from "@/features/calendar/google/events-api";
import {
  EVENT_ID,
  MAX_DESCRIPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_TITLE_LENGTH,
  parseTexts,
  type TextChanges,
} from "@/features/calendar/google/patch-input";
import type { GoogleCalendarEntry } from "@/features/calendar/google/types";
import { eventTimes } from "@/features/calendar/move";
import {
  createEvent,
  type GoogleSourceInfo,
  moveEventToCalendar,
  removeEvent,
  updateEvent,
} from "@/features/calendar/server/event-service";
import { clearGoogleEventsCache } from "@/features/calendar/server/load-all";
import type { CalendarEvent } from "@/features/calendar/types";
import { addDays, berlinDate, berlinTime, daysBetween } from "@/lib/dates";
import type { EventBefore, EventTimesUndo } from "../../event-undo-model";
import { type AiContext, appUrl, logActivity } from "../context";
import { resolveTimes } from "../event-times";
import {
  asToolError,
  GoogleUnavailable,
  type OpenGoogle,
  openGoogle,
  pickCalendar,
} from "../google";
import { ToolInputError } from "../resolve";
import { defineTool } from "./define";
import { linkedSuffixes } from "./event-link-list";
import { isoDate } from "./schema";

/** Höchstens so viele Tage umfasst eine Abfrage. */
export const MAX_RANGE_DAYS = 62;
const DEFAULT_RANGE_DAYS = 7;
const DEFAULT_LIMIT = 100;

const GOOGLE_READ = { readOnlyHint: true, openWorldHint: true } as const;
const GOOGLE_CREATES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
const GOOGLE_CHANGES = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;
/** Löschen: zerstörerisch, damit die KI-Oberfläche vor jedem Aufruf fragt (wie „trash“). */
const GOOGLE_DELETES = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const beginn = z
  .string()
  .trim()
  .max(20)
  .describe("Beginn „JJJJ-MM-TT HH:MM“ (Uhrzeit Europe/Berlin); ganztägig nur „JJJJ-MM-TT“");
export const kalenderRef = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .describe("Kalender: ID oder Name (aus list_events), „primär“ = Hauptkalender");
export const terminId = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(EVENT_ID, "Termin-ID aus list_events (Buchstaben, Ziffern, _ . @ -)")
  .describe("Termin-ID aus list_events (bei Serien die ID des einen Termins)");

const sourceOf = (calendar: GoogleCalendarEntry): GoogleSourceInfo => ({
  id: calendar.id,
  name: calendar.name,
  color: calendar.color,
  calendarId: calendar.id,
});

/** Termin lesen und wie die App normalisieren (Schreibrecht aus der Kalenderliste). */
export async function readEvent(
  google: OpenGoogle,
  calendar: GoogleCalendarEntry,
  eventId: string,
): Promise<{ event: CalendarEvent; raw: GoogleEventRaw }> {
  let rawEvent: Record<string, unknown>;
  try {
    rawEvent = await getGoogleEvent(
      google.access.endpoints,
      google.access.accessToken,
      calendar.id,
      eventId,
    );
  } catch (caught) {
    throw asToolError(caught);
  }
  const raw = GoogleEventSchema.safeParse(rawEvent);
  const event = normalizeGoogleEvent(rawEvent, {
    ...sourceOf(calendar),
    accessRole: calendar.accessRole,
  });
  if (!raw.success || !event) {
    throw new ToolInputError(
      "Dieser Termin ist in Google abgesagt, abgelehnt oder nicht lesbar – kein Termin zum Bearbeiten.",
    );
  }
  return { event, raw: raw.data };
}

function assertEditable(event: CalendarEvent, calendar: GoogleCalendarEntry) {
  if (!calendar.writable) {
    throw new ToolInputError(`Der Kalender „${calendar.name}“ ist nur lesbar.`);
  }
  if (!event.google?.editable) {
    throw new ToolInputError(
      "Dieser Termin lässt sich in Google nicht ändern (gesperrt, Geburtstag/Gmail/Arbeitsort oder Einladung eines anderen ohne Änderungsrecht).",
    );
  }
}

/** Zeit des Termins für Menschen: „2026-12-09 08:00–09:00“, „… (ganztägig)“, über mehrere Tage mit Datum. */
export function whenText(event: CalendarEvent): string {
  if (event.allDay) {
    return event.endDate === event.date
      ? `${event.date} (ganztägig)`
      : `${event.date} bis ${event.endDate} (ganztägig)`;
  }
  const startDate = berlinDate(event.start);
  const endDate = berlinDate(event.end);
  const from = `${startDate} ${berlinTime(event.start)}`;
  return endDate === startDate
    ? `${from}–${berlinTime(event.end)}`
    : `${from} – ${endDate} ${berlinTime(event.end)}`;
}

const label = (event: CalendarEvent) => `„${event.title}“ (${whenText(event)})`;

const toUndoTimes = (event: CalendarEvent): EventTimesUndo => ({
  ...eventTimes(event),
  timeZone: event.google?.timeZone ?? null,
});

/** Text beschränkt auf das, was die App-Routen beim Zurückschreiben annehmen. */
const clipText = (value: string | undefined, max: number) => (value ?? "").slice(0, max);

/** Ein Feld ist zu lang, um es verlustfrei zu ändern/zurückzuschreiben → die KI soll es lassen. */
function assertFieldFits(raw: GoogleEventRaw, text: TextChanges) {
  const tooLong = (field: string, max: number) =>
    new ToolInputError(
      `${field} ist in Google länger als ${max} Zeichen – das ändert der Nutzer besser selbst in Google (sonst ginge Text verloren).`,
    );
  if (text.summary !== undefined && (raw.summary ?? "").length > MAX_TITLE_LENGTH) {
    throw tooLong("Der Titel", MAX_TITLE_LENGTH);
  }
  if (text.location !== undefined && (raw.location ?? "").length > MAX_LOCATION_LENGTH) {
    throw tooLong("Der Ort", MAX_LOCATION_LENGTH);
  }
  if (text.description !== undefined && (raw.description ?? "").length > MAX_DESCRIPTION_LENGTH) {
    throw tooLong("Die Beschreibung", MAX_DESCRIPTION_LENGTH);
  }
}

const SERIES_HINT =
  "Das ist ein Termin einer Serie – geändert wurde nur dieser eine, nicht die ganze Serie.";

/**
 * Die ganze Serie (Ursprungstermin mit Wiederholungsregel) ändert oder löscht die KI nie (G-1):
 * `list_events` nennt nur einzelne Termine, eine erratene Serien-ID träfe sonst alle Termine.
 */
function assertSingleEvent(raw: GoogleEventRaw) {
  if ((raw.recurrence ?? []).length > 0) {
    throw new ToolInputError(
      "Das ist die ganze Serie, kein einzelner Termin – ändern und löschen gehen nur für einzelne Termine (IDs aus list_events). Die ganze Serie ändert der Nutzer in Google.",
    );
  }
}

export function registerCalendarTools(server: McpServer, ctx: AiContext) {
  /* ---------------- list_events ---------------- */
  defineTool(
    server,
    "list_events",
    {
      title: "Termine lesen",
      description: [
        "Liest Termine aus dem Google Kalender des Nutzers im Zeitraum von bis (Standard: heute bis in 7 Tagen, höchstens 62 Tage), optional nur ein Kalender.",
        "Je Termin: Zeit (Europe/Berlin), Titel, Ort, Kalender, ob er änderbar ist, ob er zu einer Serie gehört, verknüpfte Notizen und Aufgaben – und die IDs (kalender, termin), die update_event, delete_event und link_event brauchen.",
        "Ist Google nicht verbunden, sagt die Antwort, was zu tun ist.",
      ].join(" "),
      input: z.object({
        von: isoDate.optional().describe("erster Tag JJJJ-MM-TT (Standard: heute)"),
        bis: isoDate
          .optional()
          .describe("letzter Tag JJJJ-MM-TT, inklusive (Standard: von + 7 Tage)"),
        kalender: kalenderRef.optional(),
        limit: z.number().int().min(1).max(300).default(DEFAULT_LIMIT),
      }),
      annotations: GOOGLE_READ,
    },
    async (input) => {
      const from = input.von ?? berlinDate(ctx.now());
      const to = input.bis ?? addDays(from, DEFAULT_RANGE_DAYS);
      if (to < from) throw new ToolInputError("bis liegt vor von.");
      if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
        throw new ToolInputError(`Der Zeitraum darf höchstens ${MAX_RANGE_DAYS} Tage umfassen.`);
      }
      let google: OpenGoogle;
      try {
        google = await openGoogle(ctx);
      } catch (caught) {
        // nicht verbunden o. Ä.: klare Antwort statt Fehler
        if (caught instanceof GoogleUnavailable) {
          return { text: caught.message, structured: { verbunden: false, termine: [] } };
        }
        throw asToolError(caught);
      }
      const calendars = input.kalender
        ? [pickCalendar(google.calendars, input.kalender)]
        : google.calendars;
      const settled = await Promise.allSettled(
        calendars.map(async (calendar) => {
          const page = await listGoogleEvents(
            google.access.endpoints,
            google.access.accessToken,
            calendar.id,
            { start: from, end: to },
          );
          return {
            calendar,
            events: page.items
              .map((item) =>
                normalizeGoogleEvent(item, {
                  ...sourceOf(calendar),
                  accessRole: calendar.accessRole,
                }),
              )
              .filter((e): e is CalendarEvent => e !== null),
          };
        }),
      );
      const rejected = settled.flatMap((r, i) =>
        r.status === "rejected"
          ? [{ calendar: calendars[i] as GoogleCalendarEntry, why: r.reason }]
          : [],
      );
      // Zugang weg mitten im Lesen → Fehler statt halber Liste
      if (rejected.length === calendars.length) throw asToolError(rejected[0]?.why);
      const events = settled
        .flatMap((r) => (r.status === "fulfilled" ? r.value.events : []))
        .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "de"));
      const shown = events.slice(0, input.limit);
      // #68: woran Notizen und Aufgaben hängen
      const linked = await linkedSuffixes(ctx, shown);
      const lines = shown.map((e) => {
        const g = e.google;
        const flags = [
          g?.editable ? "änderbar" : "nur lesbar",
          e.recurring ? "Serie" : null,
        ].filter(Boolean);
        return `- ${whenText(e)} · ${e.title}${e.location ? ` · ${e.location}` : ""} · ${e.sourceName} · ${flags.join(", ")} (kalender: ${g?.calendarId}, termin: ${g?.eventId})${g ? (linked.get(g.eventId) ?? "") : ""}`;
      });
      const notes = rejected.map(
        (r) => `_Nicht gelesen: „${r.calendar.name}“ (Google antwortet nicht)._`,
      );
      const head = `${events.length} Termine von ${from} bis ${to}`;
      return {
        text: [
          events.length ? `${head}:` : `Keine Termine von ${from} bis ${to}.`,
          ...lines,
          events.length > shown.length
            ? `_… ${events.length - shown.length} weitere (limit erhöhen oder Zeitraum verkleinern)._`
            : "",
          ...notes,
          `Im Kalender: ${appUrl.calendar(ctx.origin, from)}`,
        ]
          .filter(Boolean)
          .join("\n"),
        structured: {
          verbunden: true,
          von: from,
          bis: to,
          termine: shown.map((e) => ({
            kalender: e.google?.calendarId,
            termin: e.google?.eventId,
            titel: e.title,
            beginn: e.allDay ? e.date : `${berlinDate(e.start)} ${berlinTime(e.start)}`,
            ende: e.allDay ? e.endDate : `${berlinDate(e.end)} ${berlinTime(e.end)}`,
            ganztaegig: e.allDay,
            ort: e.location,
            kalender_name: e.sourceName,
            aenderbar: e.google?.editable ?? false,
            serie: e.recurring,
          })),
        },
      };
    },
  );

  /* ---------------- create_event ---------------- */
  defineTool(
    server,
    "create_event",
    {
      title: "Termin anlegen",
      description: [
        "Legt einen Termin im Google Kalender des Nutzers an (Standard: Hauptkalender; nur Kalender mit Schreibrecht). Gäste werden nicht eingeladen oder benachrichtigt.",
        "beginn „JJJJ-MM-TT HH:MM“ (Europe/Berlin), dauer_min (Standard 60); ganztägig: ganztaegig true, beginn „JJJJ-MM-TT“, dauer_tage (Standard 1).",
        "Bei Terminen, die der Nutzer nur nebenbei erwähnt, vorher kurz nachfragen. Im KI-Protokoll der App lässt sich das Anlegen zurücknehmen.",
      ].join(" "),
      input: z.object({
        titel: z.string().trim().min(1).max(500),
        beginn,
        dauer_min: z.number().int().min(1).max(10_080).optional(),
        ganztaegig: z.boolean().optional(),
        dauer_tage: z.number().int().min(1).max(366).optional(),
        kalender: kalenderRef.optional(),
        ort: z.string().max(2000).optional(),
        beschreibung: z.string().max(100_000).optional(),
      }),
      annotations: GOOGLE_CREATES,
    },
    async (input) => {
      const texts = parseTexts(
        { summary: input.titel, location: input.ort, description: input.beschreibung },
        true,
      );
      if (!texts.ok) throw new ToolInputError(texts.error);
      const resolved = resolveTimes(input, null, DEFAULT_TIME_ZONE);
      if (!resolved.ok) throw new ToolInputError(resolved.error);
      const patch = resolved.value.patch;
      if (!patch) throw new ToolInputError("beginn fehlt („JJJJ-MM-TT HH:MM“, Berlin).");
      let google: OpenGoogle;
      try {
        google = await openGoogle(ctx);
      } catch (caught) {
        throw asToolError(caught);
      }
      const calendar = pickCalendar(google.calendars, input.kalender ?? "primär", {
        writable: true,
      });
      let event: CalendarEvent;
      try {
        event = await createEvent(google.access, sourceOf(calendar), {
          summary: (texts.value.summary as string) ?? input.titel,
          location: texts.value.location ?? null,
          description: texts.value.description ?? null,
          times: patch,
        });
      } catch (caught) {
        throw asToolError(caught, "Google hat den Termin nicht angenommen.");
      }
      clearGoogleEventsCache(ctx.userId);
      const eventId = event.google?.eventId ?? "";
      await logActivity(ctx, {
        tool: "create_event",
        entity: "termin",
        entityId: null,
        summary: `Termin ${label(event)} in „${calendar.name}“ angelegt`,
        // Rückgängig nur mit etag (M-1/K-4) – ohne ihn gäbe es kein sicheres Löschen
        undo: event.google?.etag
          ? {
              kind: "event_create",
              calendar_id: calendar.id,
              event_id: eventId,
              etag: event.google.etag,
              date: event.date,
            }
          : null,
      });
      return {
        text: `Termin angelegt: ${label(event)} in „${calendar.name}“ (kalender: ${calendar.id}, termin: ${eventId}). Im Kalender: ${appUrl.calendar(ctx.origin, event.date)}`,
        structured: { kalender: calendar.id, termin: eventId, titel: event.title },
      };
    },
  );

  /* ---------------- update_event ---------------- */
  defineTool(
    server,
    "update_event",
    {
      title: "Termin ändern",
      description: [
        "Ändert einen Termin in Google Kalender: Zeit (beginn, dauer_min bzw. dauer_tage, ganztaegig), titel, ort, beschreibung (leer = Feld leeren) und/oder in einen anderen Kalender legen (kalender_neu, nicht bei Serien).",
        "Nur angegebene Felder ändern sich. kalender und termin kommen aus list_events (vorher lesen – bei einem Konflikt, weil der Termin inzwischen geändert wurde, neu lesen).",
        "Bei Serien trifft es nur diesen einen Termin. Gäste werden nicht benachrichtigt. Nur änderbare Termine; Einladungen anderer lassen sich meist nicht ändern. Im KI-Protokoll der App lässt sich die Änderung zurücknehmen.",
      ].join(" "),
      input: z.object({
        kalender: kalenderRef,
        termin: terminId,
        titel: z.string().trim().min(1).max(500).optional(),
        beginn: beginn.optional(),
        dauer_min: z.number().int().min(1).max(10_080).optional(),
        ganztaegig: z.boolean().optional(),
        dauer_tage: z.number().int().min(1).max(366).optional(),
        ort: z.string().max(2000).optional(),
        beschreibung: z.string().max(100_000).optional(),
        kalender_neu: kalenderRef
          .optional()
          .describe("in diesen Kalender verschieben (ID oder Name)"),
      }),
      annotations: GOOGLE_CHANGES,
    },
    async (input) => {
      let google: OpenGoogle;
      try {
        google = await openGoogle(ctx);
      } catch (caught) {
        throw asToolError(caught);
      }
      const calendar = pickCalendar(google.calendars, input.kalender);
      const { event, raw } = await readEvent(google, calendar, input.termin);
      assertSingleEvent(raw);
      assertEditable(event, calendar);
      const eventId = event.google?.eventId ?? input.termin;

      // Eingabe prüfen, bevor etwas geschrieben wird
      const texts = parseTexts(
        { summary: input.titel, location: input.ort, description: input.beschreibung },
        false,
      );
      if (!texts.ok) throw new ToolInputError(texts.error);
      const current = eventTimes(event);
      const resolved = resolveTimes(input, current, event.google?.timeZone ?? null);
      if (!resolved.ok) throw new ToolInputError(resolved.error);
      const destination = input.kalender_neu
        ? pickCalendar(google.calendars, input.kalender_neu, { writable: true })
        : null;
      if (destination && destination.id === calendar.id) {
        throw new ToolInputError(`Der Termin liegt schon im Kalender „${calendar.name}“.`);
      }
      if (destination && event.recurring) {
        throw new ToolInputError(
          "Ein Termin einer Serie lässt sich nicht in einen anderen Kalender verschieben (das würde die Serie zerreißen) – das macht der Nutzer in Google.",
        );
      }

      // nur Felder, die sich wirklich ändern; Vorwerte für Rückgängig aus dem ungekürzten Stand
      const text: TextChanges = {};
      const before: EventBefore = {};
      const rawSummary = raw.summary ?? "";
      const rawLocation = raw.location ?? "";
      const rawDescription = raw.description ?? "";
      if (texts.value.summary !== undefined && texts.value.summary !== rawSummary) {
        text.summary = texts.value.summary;
        before.summary = clipText(rawSummary, MAX_TITLE_LENGTH);
      }
      if (texts.value.location !== undefined && (texts.value.location ?? "") !== rawLocation) {
        text.location = texts.value.location;
        before.location = clipText(rawLocation, MAX_LOCATION_LENGTH);
      }
      if (
        texts.value.description !== undefined &&
        (texts.value.description ?? "") !== rawDescription
      ) {
        text.description = texts.value.description;
        before.description = clipText(rawDescription, MAX_DESCRIPTION_LENGTH);
      }
      assertFieldFits(raw, text);
      const patchTimes = resolved.value.patch;
      if (patchTimes) before.times = toUndoTimes(event);
      const hasPatch = Boolean(patchTimes) || Object.keys(text).length > 0;
      if (!hasPatch && !destination) {
        return {
          text: `Nichts geändert: ${label(event)} hat schon diese Werte.`,
          structured: { kalender: calendar.id, termin: eventId, geaendert: false },
        };
      }

      const source = sourceOf(calendar);
      let etag = event.google?.etag ?? "";
      let updated = event;
      let patched = false;
      try {
        if (hasPatch) {
          updated = await updateEvent(google.access, source, {
            eventId,
            etag,
            times: patchTimes ?? undefined,
            text: Object.keys(text).length > 0 ? text : undefined,
          });
          etag = updated.google?.etag ?? etag;
          patched = true;
        }
        if (destination) {
          updated = await moveEventToCalendar(
            google.access,
            source,
            sourceOf(destination),
            eventId,
            etag,
          );
          etag = updated.google?.etag ?? etag;
        }
      } catch (caught) {
        // halb gelungen (geändert, aber nicht verschoben): trotzdem protokollieren
        if (patched) {
          await logActivity(ctx, {
            tool: "update_event",
            entity: "termin",
            entityId: null,
            summary: `Termin ${label(updated)} geändert`,
            undo: {
              kind: "event_update",
              calendar_id: calendar.id,
              event_id: eventId,
              etag,
              before,
              date: updated.date,
            },
          });
        }
        clearGoogleEventsCache(ctx.userId);
        const base = asToolError(caught, "Google hat die Änderung nicht angenommen.");
        throw new ToolInputError(
          patched
            ? `${base.message} (Die Änderungen an Zeit/Texten sind schon gespeichert, der Kalenderwechsel nicht.)`
            : base.message,
        );
      }
      clearGoogleEventsCache(ctx.userId);
      const finalCalendar = destination ?? calendar;
      const what = [
        before.times ? "Zeit" : null,
        before.summary !== undefined ? "Titel" : null,
        before.location !== undefined ? "Ort" : null,
        before.description !== undefined ? "Beschreibung" : null,
        destination ? `Kalender → „${destination.name}“` : null,
      ].filter(Boolean);
      await logActivity(ctx, {
        tool: "update_event",
        entity: "termin",
        entityId: null,
        summary: `Termin ${label(updated)} geändert (${what.join(", ")})`,
        undo: {
          kind: "event_update",
          calendar_id: finalCalendar.id,
          event_id: eventId,
          etag,
          before,
          ...(destination ? { moved_from: calendar.id } : {}),
          date: updated.date,
        },
      });
      return {
        text: `Termin geändert (${what.join(", ")}): ${label(updated)} in „${finalCalendar.name}“ (kalender: ${finalCalendar.id}, termin: ${eventId}).${event.recurring ? ` ${SERIES_HINT}` : ""} Im Kalender: ${appUrl.calendar(ctx.origin, updated.date)}`,
        structured: { kalender: finalCalendar.id, termin: eventId, geaendert: true },
      };
    },
  );

  /* ---------------- delete_event ---------------- */
  defineTool(
    server,
    "delete_event",
    {
      title: "Termin löschen",
      description: [
        "Löscht einen Termin in Google Kalender – nur auf ausdrücklichen Wunsch des Nutzers und erst nach seiner Bestätigung im Chat; vorher mit list_events prüfen (und ihm Titel und Zeit nennen), dass es der richtige Termin ist.",
        "Nur per kalender und termin aus list_events. Bei Serien wird nur dieser eine Termin gelöscht. Gäste werden nicht benachrichtigt.",
        "Google hält gelöschte Termine eine Weile in seinem Papierkorb; „Rückgängig“ im KI-Protokoll der App holt den Termin zurück.",
      ].join(" "),
      input: z.object({ kalender: kalenderRef, termin: terminId }),
      annotations: GOOGLE_DELETES,
    },
    async (input) => {
      let google: OpenGoogle;
      try {
        google = await openGoogle(ctx);
      } catch (caught) {
        throw asToolError(caught);
      }
      const calendar = pickCalendar(google.calendars, input.kalender);
      const { event, raw } = await readEvent(google, calendar, input.termin);
      assertSingleEvent(raw);
      assertEditable(event, calendar);
      const eventId = event.google?.eventId ?? input.termin;
      // #68: Verknüpfungen bleiben – die Antwort nennt sie
      const kept = (await linkedSuffixes(ctx, [event])).get(eventId);
      try {
        await removeEvent(google.access, sourceOf(calendar), eventId, event.google?.etag ?? null);
      } catch (caught) {
        throw asToolError(caught, "Google hat das Löschen nicht angenommen.");
      }
      clearGoogleEventsCache(ctx.userId);
      await logActivity(ctx, {
        tool: "delete_event",
        entity: "termin",
        entityId: null,
        summary: `Termin ${label(event)} aus „${calendar.name}“ gelöscht`,
        undo: {
          kind: "event_delete",
          calendar_id: calendar.id,
          event: {
            event_id: eventId,
            summary: clipText(raw.summary, MAX_TITLE_LENGTH) || event.title,
            location: clipText(raw.location, MAX_LOCATION_LENGTH),
            description: clipText(raw.description, MAX_DESCRIPTION_LENGTH),
            times: toUndoTimes(event),
          },
          date: event.date,
        },
      });
      return {
        text: `Termin gelöscht: ${label(event)} aus „${calendar.name}“.${event.recurring ? " Es war ein Termin einer Serie – nur dieser eine wurde gelöscht." : ""} Google hält ihn eine Weile in seinem Papierkorb; Zurückholen: in der App unter Einstellungen › KI-Zugänge › „Rückgängig“.${kept ? ` Weiter ${kept.replace(/^ · /, "")} (bleiben erhalten, in der App als „Termin nicht mehr gefunden“).` : ""}`,
        structured: { kalender: calendar.id, termin: eventId, geloescht: true },
      };
    },
  );
}
