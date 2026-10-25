"use client";

/**
 * Google-Termine im Query-Cache der Kalenderansichten (#64, N1b/N1c): suchen, ändern, einfügen,
 * entfernen – und die gemeinsame Reihenfolge der Änderungen je Termin. Verschieben (`event-move`)
 * und Bearbeiten/Anlegen/Löschen (`event-edit`) hängen an denselben Ketten, damit zwei
 * Änderungen am selben Termin nie gleichzeitig zu Google gehen und jede das etag der vorigen nimmt.
 */
import type { QueryClient } from "@tanstack/react-query";
import { calendarEventsKey } from "./api";
import type { CalendarEvent, CalendarResponse } from "./types";

export const eventKey = (event: Pick<CalendarEvent, "sourceId" | "uid">) =>
  `${event.sourceId}|${event.uid}`;

/** Zustand der Änderungsketten (je Termin: letztes etag, laufende Kette, Zähler für Abbrüche). */
export const eventChain = {
  etags: new Map<string, string>(),
  chains: new Map<string, Promise<void>>(),
  epochs: new Map<string, number>(),
};

type Cached = Array<[readonly unknown[], CalendarResponse | undefined]>;

export function lookupEvent(queryClient: QueryClient, key: string): CalendarEvent | null {
  const all = queryClient.getQueriesData<CalendarResponse>({
    queryKey: calendarEventsKey,
  }) as Cached;
  for (const [, data] of all) {
    const found = data?.events.find((e) => e.google && eventKey(e) === key);
    if (found) return found;
  }
  return null;
}

export function mapEvents(
  queryClient: QueryClient,
  key: string,
  change: (event: CalendarEvent) => CalendarEvent,
) {
  queryClient.setQueriesData<CalendarResponse>({ queryKey: calendarEventsKey }, (old) =>
    old?.events.some((e) => e.google && eventKey(e) === key)
      ? { ...old, events: old.events.map((e) => (e.google && eventKey(e) === key ? change(e) : e)) }
      : old,
  );
}

/** Termin in jeden geladenen Zeitraum legen, den er berührt (ersetzt einen mit gleichem Schlüssel). */
export function insertEvent(queryClient: QueryClient, event: CalendarEvent) {
  const key = eventKey(event);
  queryClient.setQueriesData<CalendarResponse>({ queryKey: calendarEventsKey }, (old) => {
    if (!old) return old;
    const overlaps = event.date <= old.range.end && event.endDate >= old.range.start;
    const others = old.events.filter((e) => !(e.google && eventKey(e) === key));
    if (!overlaps) return others.length === old.events.length ? old : { ...old, events: others };
    return { ...old, events: [...others, event] };
  });
}

/** Termin aus allen geladenen Zeiträumen nehmen. */
export function dropEvent(queryClient: QueryClient, key: string) {
  queryClient.setQueriesData<CalendarResponse>({ queryKey: calendarEventsKey }, (old) =>
    old?.events.some((e) => e.google && eventKey(e) === key)
      ? { ...old, events: old.events.filter((e) => !(e.google && eventKey(e) === key)) }
      : old,
  );
}

/**
 * Schritt in die Kette des Termins hängen: läuft erst, wenn der vorige fertig ist. `run` bekommt
 * den Zähler; ist er inzwischen weitergezählt (ein früherer Schritt scheiterte), entfällt der Schritt.
 */
export function enqueueOnEvent(
  key: string,
  run: (epoch: number) => Promise<void>,
  /** zweiter Schlüssel, unter dem derselbe Schritt gilt (Termin wechselt den Kalender, damit auch seine neue Kennung wartet) */
  alsoKey?: string,
): void {
  const epoch = eventChain.epochs.get(key) ?? 0;
  const previous = eventChain.chains.get(key) ?? Promise.resolve();
  const step = previous.then(async () => {
    if ((eventChain.epochs.get(key) ?? 0) !== epoch) return;
    await run(epoch);
  });
  const settled = step.catch(() => {});
  eventChain.chains.set(key, settled);
  if (alsoKey) eventChain.chains.set(alsoKey, settled);
}

/** Ein Schritt scheiterte: spätere Schritte dieses Termins verfallen. */
export function abortEventChain(key: string, epoch: number) {
  eventChain.epochs.set(key, epoch + 1);
  eventChain.etags.delete(key);
}
