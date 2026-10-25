"use client";

/**
 * Kalender im Client (S2a):
 * - `useCalendarSources` / `useCalendarSourceActions`: Quellen lesen und schreiben (optimistisch
 *   über die Speicher-Warteschlange, Papierkorb mit Rückgängig). Nur die Einstellungen laden die
 *   Adresse; die Ansichten brauchen sie nicht.
 * - `useCalendarEvents(range)`: Termine im Zeitraum von GET /api/kalender – die Schnittstelle für
 *   Woche, Monat, Tag, Liste und den Tagesablauf auf Heute (S2b/S2c). Normalisiert auf
 *   Europe/Berlin, mit Status je Quelle (Fehler ohne Adresse).
 * - `probeCalendarUrl`: Probe-Abruf aus den Einstellungen.
 */
import {
  keepPreviousData,
  type QueryClient,
  type UseQueryResult,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchAll } from "@/lib/data/fetch-all";
import { useSupabase, useUserId } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import { type IsoDate, monthRange } from "@/lib/dates";
import { newId, stableId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import { trashWithUndo } from "@/lib/save-queue/soft-delete";
import { keyAfter, keyBetween } from "@/lib/sort-key";
import type { Supabase } from "@/lib/supabase/client";
import type { CreateEventBody, RestoreEventBody } from "./event-create";
import {
  type CalendarColor,
  type CalendarEvent,
  type CalendarProbe,
  type CalendarRange,
  type CalendarResponse,
  type CalendarSourceRow,
  DEFAULT_CALENDAR_COLOR,
  parseCalendarColor,
} from "./types";

/** Cache-Schlüssel = Tabellenname (Papierkorb lädt Zurückgeholtes darüber neu) */
export const calendarSourcesKey = ["calendar_sources"] as const;
/** Nur id + an/aus für die Ansichten (K-1): ohne die geheime Adresse, unter demselben Präfix */
export const calendarSourcesActiveKey = ["calendar_sources", "aktiv"] as const;
export const calendarEventsKey = ["calendar"] as const;

const SOURCE_COLUMNS =
  "id, kind, name, url, google_calendar_id, color, enabled, sort, created_at, updated_at, deleted_at";
const ACTIVE_COLUMNS = "id, enabled";

const bySort = (a: CalendarSourceRow, b: CalendarSourceRow) =>
  a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.id.localeCompare(b.id);

export function toCalendarSource(row: Record<string, unknown> & { id: string }): CalendarSourceRow {
  const str = (value: unknown) => (typeof value === "string" ? value : null);
  const now = new Date().toISOString();
  return {
    id: row.id,
    kind: row.kind === "google" ? "google" : "ical",
    name: str(row.name) ?? "",
    url: str(row.url) ?? "",
    google_calendar_id: str(row.google_calendar_id),
    color: parseCalendarColor(row.color),
    enabled: row.enabled !== false,
    sort: str(row.sort) ?? "",
    created_at: str(row.created_at) ?? now,
    updated_at: str(row.updated_at) ?? now,
    deleted_at: str(row.deleted_at),
  };
}

type RawRow = Record<string, unknown> & { id: string };

/** Alle Quellen ohne Papierkorb, in Reihenfolge (rohe Zeilen für die Überlagerung). */
export async function fetchCalendarSourceRows(client: Supabase): Promise<RawRow[]> {
  return fetchAll<RawRow>(
    async (from, to) =>
      (await client
        .from("calendar_sources")
        .select(SOURCE_COLUMNS)
        .is("deleted_at", null)
        .order("sort")
        .order("id")
        .range(from, to)) as { data: RawRow[] | null; error: unknown },
  );
}

export async function fetchCalendarSources(client: Supabase): Promise<CalendarSourceRow[]> {
  return (await fetchCalendarSourceRows(client)).map(toCalendarSource).sort(bySort);
}

export function useCalendarSources() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: calendarSourcesKey,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (
        await fetchWithOverlay(
          queue,
          "calendar_sources",
          () => fetchCalendarSourceRows(getSupabase()),
          { include: () => true },
        )
      )
        .map(toCalendarSource)
        .sort(bySort),
  });
}

export interface CalendarSourceInput {
  name: string;
  url: string;
  color?: CalendarColor;
}

/**
 * Quellen für die Ansichten (K-1): nur id und an/aus. Die geheime Adresse laden allein die
 * Einstellungen – Heute, Kalender, Datenbanken und Wochenreview brauchen sie nicht und halten sie
 * deshalb auch nicht im Speicher des Browsers.
 */
export interface ActiveCalendarSource {
  id: string;
  enabled: boolean;
}

export const toActiveSource = (row: { id: string; enabled?: unknown }): ActiveCalendarSource => ({
  id: row.id,
  enabled: row.enabled !== false,
});

export async function fetchActiveCalendarSourceRows(client: Supabase): Promise<RawRow[]> {
  return fetchAll<RawRow>(
    async (from, to) =>
      (await client
        .from("calendar_sources")
        .select(ACTIVE_COLUMNS)
        .is("deleted_at", null)
        .order("id")
        .range(from, to)) as { data: RawRow[] | null; error: unknown },
  );
}

export async function fetchActiveCalendarSources(
  client: Supabase,
): Promise<ActiveCalendarSource[]> {
  return (await fetchActiveCalendarSourceRows(client)).map(toActiveSource);
}

export function useCalendarSourcesActive() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: calendarSourcesActiveKey,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (
        await fetchWithOverlay(
          queue,
          "calendar_sources",
          () => fetchActiveCalendarSourceRows(getSupabase()),
          { include: () => true },
        )
      ).map(toActiveSource),
  });
}

/**
 * Feste ID der Zeile eines Google-Kalenders je Nutzer (G-4): „anzeigen“ auf zwei Geräten trifft
 * dieselbe Zeile, und liegt sie im Papierkorb, holt das Einschalten sie zurück (Upsert mit
 * `deleted_at: null`) statt eine zweite anzulegen, die am Eindeutigkeits-Index scheiterte.
 */
export const googleSourceId = (userId: string, calendarId: string) =>
  stableId(`calendar_source:google:${userId}:${calendarId}`);

export function createCalendarSourceActions(
  queue: SaveQueue,
  queryClient: QueryClient,
  userId: string,
) {
  const list = () => queryClient.getQueryData<CalendarSourceRow[]>(calendarSourcesKey) ?? [];
  const setList = (update: (old: CalendarSourceRow[]) => CalendarSourceRow[]) =>
    queryClient.setQueryData<CalendarSourceRow[]>(calendarSourcesKey, (old) =>
      update(old ?? []).sort(bySort),
    );
  /** Termine neu laden, sobald sich an den Quellen etwas ändert; die Ansichten-Liste zieht mit */
  const refresh = () => {
    queryClient.setQueryData<ActiveCalendarSource[]>(
      calendarSourcesActiveKey,
      list().map(toActiveSource),
    );
    void queryClient.invalidateQueries({ queryKey: calendarEventsKey });
  };
  const nowIso = () => new Date().toISOString();

  return {
    /** Neue Quelle ans Ende; ohne Name oder Adresse: nichts. Liefert die Zeile. */
    create(input: CalendarSourceInput): CalendarSourceRow | null {
      const name = input.name.trim().slice(0, 80);
      const url = input.url.trim();
      if (!name || !url) return null;
      const row: CalendarSourceRow = {
        id: newId(),
        kind: "ical",
        name,
        url,
        google_calendar_id: null,
        color: input.color ?? DEFAULT_CALENDAR_COLOR,
        enabled: true,
        sort: keyAfter(list().map((s) => s.sort)),
        created_at: nowIso(),
        updated_at: nowIso(),
        deleted_at: null,
      };
      setList((old) => [...old, row]);
      queue.enqueue({
        table: "calendar_sources",
        id: row.id,
        mode: "upsert",
        values: {
          name: row.name,
          url: row.url,
          color: row.color,
          enabled: true,
          sort: row.sort,
          deleted_at: null,
        },
      });
      refresh();
      return row;
    },

    update(
      id: string,
      values: Partial<Pick<CalendarSourceRow, "name" | "url" | "color" | "enabled">>,
    ) {
      const patch = { ...values };
      if (patch.name !== undefined) {
        patch.name = patch.name.trim().slice(0, 80);
        if (!patch.name) delete patch.name;
      }
      if (patch.url !== undefined) {
        patch.url = patch.url.trim();
        if (!patch.url) delete patch.url;
      }
      if (Object.keys(patch).length === 0) return;
      setList((old) =>
        old.map((s) => (s.id === id ? { ...s, ...patch, updated_at: nowIso() } : s)),
      );
      queue.enqueue({ table: "calendar_sources", id, mode: "update", values: patch });
      refresh();
    },

    /** Eine Position nach oben (−1) oder unten (+1) – unter den Quellen derselben Art. */
    move(id: string, by: -1 | 1) {
      const kind = list().find((s) => s.id === id)?.kind;
      const rows = list().filter((s) => s.kind === kind);
      const index = rows.findIndex((s) => s.id === id);
      const target = index + by;
      if (index === -1 || target < 0 || target >= rows.length) return;
      const neighbour = rows[target] as CalendarSourceRow;
      const before = by === -1 ? (rows[target - 1]?.sort ?? null) : neighbour.sort;
      const after = by === -1 ? neighbour.sort : (rows[target + 1]?.sort ?? null);
      const sort = keyBetween(before, after);
      setList((old) => old.map((s) => (s.id === id ? { ...s, sort } : s)));
      queue.enqueue({ table: "calendar_sources", id, mode: "update", values: { sort } });
    },

    /**
     * Google-Kalender an/aus (#64, N1a): beim ersten Einschalten eine Zeile `kind = google` (Name
     * und Farbe aus der Kalenderliste bzw. der ersetzten iCal-Quelle), danach nur an/aus.
     */
    setGoogleCalendar(
      calendar: { id: string; name: string; color: CalendarColor },
      enabled: boolean,
    ): void {
      const existing = list().find(
        (s) => s.kind === "google" && s.google_calendar_id === calendar.id,
      );
      if (existing) {
        if (existing.enabled === enabled) return;
        setList((old) =>
          old.map((s) => (s.id === existing.id ? { ...s, enabled, updated_at: nowIso() } : s)),
        );
        queue.enqueue({
          table: "calendar_sources",
          id: existing.id,
          mode: "update",
          values: { enabled },
        });
        refresh();
        return;
      }
      if (!enabled) return;
      const row: CalendarSourceRow = {
        id: googleSourceId(userId, calendar.id),
        kind: "google",
        name: calendar.name.trim().slice(0, 80) || "Google-Kalender",
        url: "",
        google_calendar_id: calendar.id,
        color: calendar.color,
        enabled: true,
        sort: keyAfter(list().map((s) => s.sort)),
        created_at: nowIso(),
        updated_at: nowIso(),
        deleted_at: null,
      };
      setList((old) => [...old, row]);
      queue.enqueue({
        table: "calendar_sources",
        id: row.id,
        mode: "upsert",
        values: {
          kind: "google",
          google_calendar_id: row.google_calendar_id,
          name: row.name,
          color: row.color,
          enabled: true,
          sort: row.sort,
          deleted_at: null,
        },
      });
      refresh();
    },

    /** In den Papierkorb mit Rückgängig (auch ⌘Z). */
    trash(id: string) {
      const row = list().find((s) => s.id === id);
      if (!row) return;
      trashWithUndo(queue, queryClient, {
        table: "calendar_sources",
        queryKey: calendarSourcesKey,
        row,
        message: `Kalender „${row.name}“ liegt im Papierkorb`,
        restore: (rows, item) => [...rows, item].sort(bySort),
      });
      refresh();
    },
  };
}

export type CalendarSourceActions = ReturnType<typeof createCalendarSourceActions>;

export function useCalendarSourceActions(): CalendarSourceActions {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  const userId = useUserId();
  return useMemo(
    () => createCalendarSourceActions(queue, queryClient, userId),
    [queue, queryClient, userId],
  );
}

/* ------------------------------------------------------------------ */
/* Termine im Zeitraum (Schnittstelle für die Ansichten)               */
/* ------------------------------------------------------------------ */

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("application/json") ? ((await response.json()) as T) : null;
  if (!response.ok || body === null) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof error === "string" ? error : fallback);
  }
  return body;
}

/** Termine im Zeitraum laden (GET /api/kalender). */
export async function fetchCalendarEvents(
  range: CalendarRange,
  options: { fresh?: boolean; signal?: AbortSignal } = {},
): Promise<CalendarResponse> {
  const params = new URLSearchParams({ von: range.start, bis: range.end });
  if (options.fresh) params.set("frisch", "1");
  const response = await fetch(`/api/kalender?${params}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal: options.signal,
  });
  return readJson<CalendarResponse>(response, "Termine ließen sich nicht laden.");
}

/**
 * Termine im Zeitraum (Kalendertage Europe/Berlin, inklusive) – 5 Minuten frisch, beim Wechsel
 * des Zeitraums bleiben die alten Daten stehen, bis die neuen da sind. `enabled: false`, solange
 * es keine Quellen gibt (die Route liefert dann ohnehin nichts).
 */
export function useCalendarEvents(range: CalendarRange, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...calendarEventsKey, range.start, range.end],
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) => fetchCalendarEvents(range, { signal }),
  });
}

/** Termine mehrerer Monate zusammengeführt (`useCalendarEventMonths`). */
export interface CalendarEventMonths {
  data: Pick<CalendarResponse, "events" | "sources"> | undefined;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function combineEventMonths(
  results: UseQueryResult<CalendarResponse>[],
): CalendarEventMonths {
  const loaded = results.filter((r) => r.data !== undefined);
  const refetch = () =>
    Promise.all(results.filter((r) => r.data !== undefined || r.isError).map((r) => r.refetch()));
  const isError = results.some((r) => r.isError && r.data === undefined);
  const latest = loaded.reduce<UseQueryResult<CalendarResponse> | null>(
    (best, r) => (!best || r.dataUpdatedAt > best.dataUpdatedAt ? r : best),
    null,
  );
  if (!latest?.data) return { data: undefined, isError, refetch };
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const r of loaded) {
    for (const event of r.data?.events ?? []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
  }
  return { data: { events, sources: latest.data.sources }, isError, refetch };
}

/**
 * Termine monatsweise (#85, Monat zum Durchscrollen): je Kalendermonat eine Abfrage unter
 * demselben Schlüssel wie `useCalendarEvents` – die Helfer in `event-cache.ts` erreichen also
 * jede. Geladen werden nur die Monate in `active`, schon geladene bleiben sichtbar. Termine über
 * eine Monatsgrenze stehen in beiden Antworten (zusammengeführt nach `id`), der Stand der Quellen
 * kommt aus der jüngsten Antwort.
 */
export function useCalendarEventMonths(
  months: IsoDate[],
  active: IsoDate[],
  options: { enabled?: boolean } = {},
): CalendarEventMonths {
  const enabled = options.enabled ?? true;
  return useQueries({
    queries: months.map((month) => {
      const range = monthRange(month);
      return {
        queryKey: [...calendarEventsKey, range.start, range.end],
        staleTime: 5 * 60_000,
        retry: 1,
        enabled: enabled && active.includes(month),
        queryFn: ({ signal }: { signal: AbortSignal }) => fetchCalendarEvents(range, { signal }),
      };
    }),
    combine: combineEventMonths,
  });
}

/** Probe-Abruf (POST /api/kalender/probe) – die Adresse geht nur an den eigenen Server. */
export async function probeCalendarUrl(url: string): Promise<CalendarProbe> {
  const response = await fetch("/api/kalender/probe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ url }),
  });
  return readJson<CalendarProbe>(response, "Probe-Abruf fehlgeschlagen.");
}

/* ------------------------------------------------------------------ */
/* Google-Termine ändern (#64, N1b)                                    */
/* ------------------------------------------------------------------ */

export interface PatchEventInput {
  sourceId: string;
  eventId: string;
  etag: string;
  /** Zeiten (ganz oder gar nicht) */
  allDay?: boolean;
  start?: string;
  end?: string;
  timeZone?: string | null;
  /** Texte (N1c); leerer Ort/leere Beschreibung leert das Feld */
  summary?: string;
  location?: string;
  description?: string;
}

export type TerminFailure = {
  ok: false;
  reason: "conflict" | "reconnect" | "gone" | "error";
  message: string;
};

export type PatchEventResult = { ok: true; etag: string } | TerminFailure;

interface TerminBody {
  ok?: boolean;
  etag?: string;
  event?: CalendarEvent;
  how?: "same" | "new";
  error?: string;
  conflict?: boolean;
  gone?: boolean;
  state?: string;
}

/** Aufruf einer Termin-Route; Fehler als Ergebnis, nie als Ausnahme. */
async function callTermin(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  payload: unknown,
  fallback: string,
): Promise<{ ok: true; body: TerminBody } | TerminFailure> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, reason: "error", message: "Keine Verbindung zum Server." };
  }
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("application/json")
    ? ((await response.json().catch(() => null)) as TerminBody | null)
    : null;
  if (response.ok && body?.ok) return { ok: true, body };
  const message = typeof body?.error === "string" ? body.error : fallback;
  if (response.status === 412 || body?.conflict) return { ok: false, reason: "conflict", message };
  if (body?.state === "reconnect") return { ok: false, reason: "reconnect", message };
  if (response.status === 404 || body?.gone) return { ok: false, reason: "gone", message };
  return { ok: false, reason: "error", message };
}

const TERMIN = "/api/kalender/termin";
const NOT_ACCEPTED = "Google hat die Änderung nicht angenommen.";

/** Zeit und/oder Texte eines Google-Termins ändern (PATCH /api/kalender/termin). */
export async function patchCalendarEvent(input: PatchEventInput): Promise<PatchEventResult> {
  const result = await callTermin(TERMIN, "PATCH", input, NOT_ACCEPTED);
  if (!result.ok) return result;
  if (typeof result.body.etag !== "string") {
    return { ok: false, reason: "error", message: NOT_ACCEPTED };
  }
  return { ok: true, etag: result.body.etag };
}

export type EventResult = { ok: true; event: CalendarEvent; how?: "same" | "new" } | TerminFailure;

async function eventCall(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  payload: unknown,
  fallback: string,
): Promise<EventResult> {
  const result = await callTermin(path, method, payload, fallback);
  if (!result.ok) return result;
  if (!result.body.event) return { ok: false, reason: "error", message: fallback };
  return { ok: true, event: result.body.event, how: result.body.how };
}

/** Neuen Termin in Google anlegen (POST /api/kalender/termin). */
export const createCalendarEvent = (body: CreateEventBody): Promise<EventResult> =>
  eventCall(TERMIN, "POST", body, "Google hat den Termin nicht angenommen.");

/** Termin löschen (DELETE /api/kalender/termin); `etag` = nur, wenn unverändert. */
export async function deleteCalendarEvent(input: {
  sourceId: string;
  eventId: string;
  etag?: string;
}): Promise<{ ok: true } | TerminFailure> {
  const result = await callTermin(
    TERMIN,
    "DELETE",
    input,
    "Google hat das Löschen nicht angenommen.",
  );
  return result.ok ? { ok: true } : result;
}

/** Termin in einen anderen Google-Kalender legen. */
export const moveCalendarEventToCalendar = (input: {
  sourceId: string;
  destinationSourceId: string;
  eventId: string;
  etag: string;
}): Promise<EventResult> =>
  eventCall(
    `${TERMIN}/verschieben-kalender`,
    "POST",
    input,
    "Google hat den Kalenderwechsel nicht angenommen.",
  );

/** Gelöschten Termin zurückholen (aus Googles Papierkorb oder neu angelegt). */
export const restoreCalendarEvent = (body: RestoreEventBody): Promise<EventResult> =>
  eventCall(
    `${TERMIN}/wiederherstellen`,
    "POST",
    body,
    "Google hat das Zurückholen nicht angenommen.",
  );

/**
 * Alle geladenen Termin-Zeiträume frisch von Google holen (`frisch=1`, am Server-Cache vorbei):
 * angezeigte sofort, die übrigen werden beim nächsten Anzeigen neu geladen.
 */
export async function refreshCalendarEvents(queryClient: QueryClient): Promise<void> {
  // Köpfe „Termin: …“ in Notiz und Aufgabe (#68) beim nächsten Anzeigen frisch
  void queryClient.invalidateQueries({ queryKey: ["termin"], refetchType: "none" });
  const queries = queryClient.getQueryCache().findAll({ queryKey: calendarEventsKey });
  await Promise.all(
    queries.map(async (query) => {
      const [, start, end] = query.queryKey as [string, string?, string?];
      if (!start || !end || query.getObserversCount() === 0) {
        void queryClient.invalidateQueries({ queryKey: query.queryKey, refetchType: "none" });
        return;
      }
      try {
        const fresh = await fetchCalendarEvents({ start, end }, { fresh: true });
        queryClient.setQueryData(query.queryKey, fresh);
      } catch {
        void queryClient.invalidateQueries({ queryKey: query.queryKey });
      }
    }),
  );
}
