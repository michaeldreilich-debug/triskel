"use client";

/**
 * Google-Termine verschieben und verlängern im Client (#64, N1b): Ziehen im Raster, „Verschieben
 * auf …“, Uhrzeit/Dauer im Termin-Fenster. Immer so:
 * 1. sofort an der neuen Stelle (alle geladenen Zeiträume im Query-Cache),
 * 2. Toast mit „Rückgängig“ (auch ⌘Z) – Rückgängig patcht die alten Zeiten mit dem dann aktuellen
 *    etag zurück,
 * 3. ein Aufruf je Änderung (erst beim Loslassen), je Termin nacheinander (jeder nimmt das etag des
 *    vorigen) – so gibt es keinen Doppel-Patch und keinen Wettlauf zwischen Ziehen und Rückgängig.
 * Konflikt (etag passt nicht) oder Fehler: Ansicht frisch laden, Meldung, Rückgängig verfällt.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { notifyWithUndo, toast } from "@/components/ui/toast";
import { appPath } from "@/lib/app-links";
import { berlinDate } from "@/lib/dates";
import { calendarEventsKey, patchCalendarEvent, refreshCalendarEvents } from "./api";
import {
  abortEventChain,
  enqueueOnEvent,
  eventChain,
  eventKey,
  lookupEvent,
  mapEvents,
} from "./event-cache";
import {
  applyEventTimes,
  type EventTimes,
  eventTimes,
  moveEventToDay,
  moveEventToSlot,
  moveMessage,
  sameTimes,
  setEventDuration,
  setEventEnd,
  setEventSchedule,
  setEventStartTime,
} from "./move";
import type { CalendarEvent } from "./types";

export function useCalendarEventMove() {
  const queryClient = useQueryClient();

  /** Wirkt auf den Termin (zeigt sofort, patcht nacheinander); `message` null = ohne Toast (Rückgängig). */
  const apply = useCallback(
    (event: CalendarEvent, times: EventTimes, message: string | null, undoOf?: EventTimes) => {
      const google = event.google;
      if (!google?.editable) return;
      const key = eventKey(event);
      const before = undoOf ?? eventTimes(event);
      if (sameTimes(before, times)) return;

      void queryClient.cancelQueries({ queryKey: calendarEventsKey });
      mapEvents(queryClient, key, (e) => applyEventTimes(e, times));

      let dead = false;
      let toastId: string | number | undefined;
      if (message) {
        toastId = notifyWithUndo(message, () => {
          if (dead) return;
          const current = lookupEvent(queryClient, key) ?? applyEventTimes(event, times);
          apply(current, before, null, times);
        });
      }

      enqueueOnEvent(key, async (epoch) => {
        const current = lookupEvent(queryClient, key);
        const etag = eventChain.etags.get(key) ?? current?.google?.etag ?? google.etag;
        const result = await patchCalendarEvent({
          sourceId: event.sourceId,
          eventId: google.eventId,
          etag,
          allDay: times.allDay,
          start: times.start,
          end: times.end,
          timeZone: google.timeZone,
        });
        if (result.ok) {
          eventChain.etags.set(key, result.etag);
          mapEvents(queryClient, key, (e) =>
            e.google ? { ...e, google: { ...e.google, etag: result.etag } } : e,
          );
          return;
        }
        // gescheitert: spätere Schritte dieses Termins verfallen, Rückgängig auch
        dead = true;
        abortEventChain(key, epoch);
        if (toastId !== undefined) toast.dismiss(toastId);
        await refreshCalendarEvents(queryClient);
        if (result.reason === "conflict") {
          toast("Der Termin wurde inzwischen in Google geändert – neu geladen");
        } else if (result.reason === "gone") {
          toast.error("Der Termin existiert in Google nicht mehr – neu geladen");
        } else if (result.reason === "reconnect") {
          toast.error("Google neu verbinden – der Termin steht wieder an der alten Stelle", {
            action: {
              label: "Neu verbinden",
              onClick: () => window.location.assign(appPath.settings("kalender")),
            },
          });
        } else {
          toast.error(`${result.message} Der Termin steht wieder an der alten Stelle.`);
        }
      });
    },
    [queryClient],
  );

  const run = useCallback(
    (event: CalendarEvent, times: EventTimes | null) => {
      if (!times) return;
      apply(event, times, moveMessage(event, times, berlinDate()));
    },
    [apply],
  );

  return useMemo(
    () => ({
      /** Auf einen Tag (ganztägig: um die Tage seit dem gegriffenen Tag, sonst gleiche Uhrzeit). */
      moveToDay: (event: CalendarEvent, date: string, fromDate?: string) =>
        run(event, moveEventToDay(event, date, fromDate)),
      /** Auf eine Uhrzeit (nur Termine mit Uhrzeit). */
      moveToSlot: (event: CalendarEvent, date: string, minutes: number) =>
        run(event, moveEventToSlot(event, date, minutes)),
      /** Ende am unteren Rand gezogen. */
      setEnd: (event: CalendarEvent, endDate: string, endMinutes: number) =>
        run(event, setEventEnd(event, endDate, endMinutes)),
      /** Dauer in Minuten (Termin-Fenster). */
      setDuration: (event: CalendarEvent, minutes: number) =>
        run(event, setEventDuration(event, minutes)),
      /** Neue Uhrzeit „HH:mm“ und Dauer in Minuten am selben Tag (Termin-Fenster, ein Aufruf). */
      setSchedule: (event: CalendarEvent, time: string, minutes: number) =>
        run(event, setEventSchedule(event, time, minutes)),
      /** Neue Uhrzeit „HH:mm“ am selben Tag (Termin-Fenster). */
      setStartTime: (event: CalendarEvent, time: string) =>
        run(event, setEventStartTime(event, time)),
    }),
    [run],
  );
}

export type CalendarEventMove = ReturnType<typeof useCalendarEventMove>;
