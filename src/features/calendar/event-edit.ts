"use client";

/**
 * Google-Termine anlegen, Texte ändern, Kalender wechseln und löschen im Client (#64, N1c).
 * Wie das Verschieben (`event-move`): sofort angezeigt (Query-Cache aller geladenen Zeiträume),
 * Toast mit „Rückgängig“ (auch ⌘Z), ein Aufruf je Änderung, je Termin nacheinander mit dem
 * aktuellen etag (`event-cache`: dieselben Ketten wie beim Verschieben). Scheitert ein Schritt:
 * Ansicht frisch laden, Meldung, Rückgängig verfällt.
 * - Anlegen → Rückgängig = löschen (ohne etag).
 * - Texte ändern → Rückgängig = alte Werte zurück.
 * - Kalender wechseln → Rückgängig = zurück in den alten Kalender.
 * - Löschen → Rückgängig = wiederherstellen (derselbe Termin aus Googles Papierkorb, sonst neu
 *   mit allen Angaben).
 * Verknüpfte Notizen und Aufgaben (#68) bleiben immer: Die Meldung beim Löschen nennt sie, ein neu
 * angelegter bzw. umgezogener Termin nimmt seine Verknüpfungen mit (`retarget`).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { notifyWithUndo, toast } from "@/components/ui/toast";
import { appPath } from "@/lib/app-links";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import {
  calendarEventsKey,
  createCalendarEvent,
  deleteCalendarEvent,
  moveCalendarEventToCalendar,
  patchCalendarEvent,
  refreshCalendarEvents,
  restoreCalendarEvent,
  type TerminFailure,
} from "./api";
import {
  abortEventChain,
  dropEvent,
  enqueueOnEvent,
  eventChain,
  eventKey,
  insertEvent,
  lookupEvent,
  mapEvents,
} from "./event-cache";
import {
  createdMessage,
  deletedMessage,
  type EventDraft,
  type EventTexts,
  optimisticEvent,
  textChange,
  textChangeMessage,
  toCreateBody,
  toRestoreBody,
  type WritableCalendar,
} from "./event-create";
import { type EventLinkRow, linkableEvent, linksOfEvent } from "./links";
import { createEventLinkActions, eventLinksKey } from "./links-api";
import type { CalendarEvent } from "./types";

/** „ · 1 Notiz und 2 Aufgaben bleiben“ – was am gelöschten Termin hängt (#68). */
export function keptLinksSuffix(links: EventLinkRow[], event: CalendarEvent): string {
  const linkable = linkableEvent(event);
  if (!linkable) return "";
  const hanging = linksOfEvent(links, linkable);
  const notes = hanging.filter((l) => l.note_id).length;
  const tasks = hanging.length - notes;
  const parts = [
    notes ? `${notes} ${notes === 1 ? "Notiz" : "Notizen"}` : null,
    tasks ? `${tasks} ${tasks === 1 ? "Aufgabe" : "Aufgaben"}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return ` · ${parts.join(" und ")} ${hanging.length === 1 ? "bleibt" : "bleiben"}`;
}

type Target = Pick<WritableCalendar, "sourceId" | "name" | "color">;

/** Meldung zu einem gescheiterten Schritt; `tail` sagt, wie es nun steht. */
function failureToast(result: TerminFailure, tail: string) {
  if (result.reason === "conflict") {
    toast(`Der Termin wurde inzwischen in Google geändert – neu geladen. ${tail}`);
  } else if (result.reason === "gone") {
    toast.error("Der Termin existiert in Google nicht mehr – neu geladen");
  } else if (result.reason === "reconnect") {
    toast.error(`Google neu verbinden – ${tail}`, {
      action: {
        label: "Neu verbinden",
        onClick: () => window.location.assign(appPath.settings("kalender")),
      },
    });
  } else {
    toast.error(`${result.message} ${tail}`);
  }
}

const applyTexts = (event: CalendarEvent, texts: Partial<EventTexts>): CalendarEvent => ({
  ...event,
  title: texts.summary !== undefined ? texts.summary || event.title : event.title,
  location: texts.location !== undefined ? texts.location.trim() || null : event.location,
  description:
    texts.description !== undefined
      ? texts.description.trim()
        ? texts.description
        : null
      : event.description,
});

export function useCalendarEventEdit() {
  const queryClient = useQueryClient();
  const queue = useSaveQueue();
  const links = useMemo(() => createEventLinkActions(queue, queryClient), [queue, queryClient]);

  /* ---------------------------------------------------------------- */
  /* Löschen                                                           */
  /* ---------------------------------------------------------------- */

  /** Termin aus Google löschen; `etag` null = auch wenn er sich inzwischen geändert hat (Rückgängig von „anlegen“). */
  const dropRemote = useCallback(
    (event: CalendarEvent, guarded: boolean, onFailed: () => void, tail: string) => {
      const google = event.google;
      if (!google) return;
      const key = eventKey(event);
      void queryClient.cancelQueries({ queryKey: calendarEventsKey });
      dropEvent(queryClient, key);
      enqueueOnEvent(key, async (epoch) => {
        const etag = guarded ? (eventChain.etags.get(key) ?? google.etag) : undefined;
        const result = await deleteCalendarEvent({
          sourceId: event.sourceId,
          eventId: google.eventId,
          etag,
        });
        if (result.ok) {
          eventChain.etags.delete(key);
          return;
        }
        abortEventChain(key, epoch);
        onFailed();
        await refreshCalendarEvents(queryClient);
        failureToast(result, tail);
      });
    },
    [queryClient],
  );

  /** Gelöschten Termin zurückholen (Rückgängig): sofort wieder zeigen, dann wiederherstellen. */
  const restore = useCallback(
    (event: CalendarEvent) => {
      const body = toRestoreBody(event);
      if (!body) return;
      const key = eventKey(event);
      void queryClient.cancelQueries({ queryKey: calendarEventsKey });
      insertEvent(queryClient, event);
      enqueueOnEvent(key, async (epoch) => {
        const result = await restoreCalendarEvent(body);
        if (result.ok) {
          // bei „new“ hat der Termin eine neue ID: die alte Anzeige weg, die neue hin
          dropEvent(queryClient, key);
          insertEvent(queryClient, result.event);
          // … und seine Verknüpfungen ziehen mit (#68)
          const restored = linkableEvent(result.event);
          if (restored && event.google && restored.eventId !== event.google.eventId) {
            links.retarget(event.google.eventId, restored);
          }
          if (result.event.google) {
            eventChain.etags.set(eventKey(result.event), result.event.google.etag);
          }
          void refreshCalendarEvents(queryClient);
          return;
        }
        abortEventChain(key, epoch);
        dropEvent(queryClient, key);
        await refreshCalendarEvents(queryClient);
        failureToast(result, "Der Termin konnte nicht zurückgeholt werden.");
      });
    },
    [queryClient, links],
  );

  const remove = useCallback(
    (event: CalendarEvent) => {
      if (!event.google?.editable) return;
      let dead = false;
      const kept = keptLinksSuffix(
        queryClient.getQueryData<EventLinkRow[]>(eventLinksKey) ?? [],
        event,
      );
      const toastId = notifyWithUndo(
        `${deletedMessage(event.title, event.google.recurringEventId !== null)}${kept}`,
        () => {
          if (!dead) restore(event);
        },
      );
      dropRemote(
        event,
        true,
        () => {
          dead = true;
          toast.dismiss(toastId);
        },
        "Der Termin wurde nicht gelöscht.",
      );
    },
    [dropRemote, restore, queryClient],
  );

  /* ---------------------------------------------------------------- */
  /* Anlegen                                                           */
  /* ---------------------------------------------------------------- */

  const create = useCallback(
    (draft: EventDraft, calendar: Target) => {
      const tempId = `neu-${newId()}`;
      const shown = optimisticEvent(draft, calendar, tempId);
      const tempKey = eventKey(shown);
      void queryClient.cancelQueries({ queryKey: calendarEventsKey });
      insertEvent(queryClient, shown);
      void (async () => {
        const result = await createCalendarEvent(toCreateBody(draft));
        dropEvent(queryClient, tempKey);
        if (!result.ok) {
          failureToast(result, "Der Termin wurde nicht angelegt.");
          return;
        }
        const created = result.event;
        insertEvent(queryClient, created);
        if (created.google) eventChain.etags.set(eventKey(created), created.google.etag);
        void refreshCalendarEvents(queryClient);
        notifyWithUndo(createdMessage(created.title), () => {
          // Rückgängig = löschen (ohne etag: auch wenn Google ihn inzwischen geändert hat)
          dropRemote(created, false, () => {}, "Der Termin bleibt bestehen.");
        });
      })();
    },
    [queryClient, dropRemote],
  );

  /* ---------------------------------------------------------------- */
  /* Texte ändern                                                      */
  /* ---------------------------------------------------------------- */

  const applyText = useCallback(
    (
      event: CalendarEvent,
      changes: Partial<EventTexts>,
      previous: Partial<EventTexts>,
      message: string | null,
    ) => {
      const google = event.google;
      if (!google?.editable) return;
      const key = eventKey(event);
      void queryClient.cancelQueries({ queryKey: calendarEventsKey });
      mapEvents(queryClient, key, (e) => applyTexts(e, changes));

      let dead = false;
      let toastId: string | number | undefined;
      if (message) {
        toastId = notifyWithUndo(message, () => {
          if (dead) return;
          const current = lookupEvent(queryClient, key) ?? applyTexts(event, changes);
          applyText(current, previous, changes, null);
        });
      }
      enqueueOnEvent(key, async (epoch) => {
        const etag =
          eventChain.etags.get(key) ?? lookupEvent(queryClient, key)?.google?.etag ?? google.etag;
        const result = await patchCalendarEvent({
          sourceId: event.sourceId,
          eventId: google.eventId,
          etag,
          ...changes,
        });
        if (result.ok) {
          eventChain.etags.set(key, result.etag);
          mapEvents(queryClient, key, (e) =>
            e.google ? { ...e, google: { ...e.google, etag: result.etag } } : e,
          );
          return;
        }
        dead = true;
        abortEventChain(key, epoch);
        if (toastId !== undefined) toast.dismiss(toastId);
        await refreshCalendarEvents(queryClient);
        failureToast(result, "Die Änderung wurde nicht gespeichert.");
      });
    },
    [queryClient],
  );

  const updateTexts = useCallback(
    (event: CalendarEvent, next: Partial<EventTexts>) => {
      const change = textChange(event, next);
      if (!change) return;
      applyText(event, change.changes, change.previous, textChangeMessage(event, change.changes));
    },
    [applyText],
  );

  /* ---------------------------------------------------------------- */
  /* Kalender wechseln                                                 */
  /* ---------------------------------------------------------------- */

  const moveCalendar = useCallback(
    (event: CalendarEvent, to: Target, message: string | null) => {
      const google = event.google;
      if (!google?.editable || google.recurringEventId || event.sourceId === to.sourceId) return;
      const key = eventKey(event);
      const newKey = `${to.sourceId}|${event.uid}`;
      const from: Target = { sourceId: event.sourceId, name: event.sourceName, color: event.color };
      void queryClient.cancelQueries({ queryKey: calendarEventsKey });
      const shown: CalendarEvent = {
        ...event,
        sourceId: to.sourceId,
        sourceName: to.name,
        color: to.color,
        id: `${to.sourceId}:${event.uid}:${event.start}`,
      };
      dropEvent(queryClient, key);
      insertEvent(queryClient, shown);

      let dead = false;
      let toastId: string | number | undefined;
      if (message) {
        toastId = notifyWithUndo(message, () => {
          if (dead) return;
          moveCalendar(lookupEvent(queryClient, newKey) ?? shown, from, null);
        });
      }
      enqueueOnEvent(
        key,
        async (epoch) => {
          const etag = eventChain.etags.get(key) ?? google.etag;
          const result = await moveCalendarEventToCalendar({
            sourceId: event.sourceId,
            destinationSourceId: to.sourceId,
            eventId: google.eventId,
            etag,
          });
          if (result.ok) {
            eventChain.etags.delete(key);
            dropEvent(queryClient, newKey);
            insertEvent(queryClient, result.event);
            if (result.event.google) eventChain.etags.set(newKey, result.event.google.etag);
            // Verknüpfungen kennen den Kalender des Termins (#68)
            const moved = linkableEvent(result.event);
            if (moved) links.retarget(google.eventId, moved);
            return;
          }
          dead = true;
          abortEventChain(key, epoch);
          abortEventChain(newKey, eventChain.epochs.get(newKey) ?? 0);
          if (toastId !== undefined) toast.dismiss(toastId);
          await refreshCalendarEvents(queryClient);
          failureToast(result, "Der Termin liegt weiter im alten Kalender.");
        },
        newKey,
      );
    },
    [queryClient, links],
  );

  const changeCalendar = useCallback(
    (event: CalendarEvent, to: Target) => {
      const title = event.title.length > 60 ? `${event.title.slice(0, 59)}…` : event.title;
      moveCalendar(event, to, `„${title}“ → Kalender „${to.name}“`);
    },
    [moveCalendar],
  );

  return useMemo(
    () => ({ create, updateTexts, changeCalendar, remove }),
    [create, updateTexts, changeCalendar, remove],
  );
}

export type CalendarEventEdit = ReturnType<typeof useCalendarEventEdit>;
