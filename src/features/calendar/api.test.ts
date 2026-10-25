import { QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { type SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import type { Supabase } from "@/lib/supabase/client";
import {
  calendarSourcesKey,
  combineEventMonths,
  createCalendarSourceActions,
  fetchActiveCalendarSources,
  googleSourceId,
  toActiveSource,
  toCalendarSource,
} from "./api";
import type { CalendarEvent, CalendarResponse, CalendarSourceRow } from "./types";

/** Supabase-Attrappe: merkt sich die angefragten Spalten und liefert feste Zeilen. */
function fakeClient(rows: Record<string, unknown>[]) {
  const calls: { table: string; columns: string }[] = [];
  const builder = {
    is: () => builder,
    order: () => builder,
    range: async () => ({ data: rows, error: null }),
  };
  const client = {
    from: (table: string) => ({
      select: (columns: string) => {
        calls.push({ table, columns });
        return builder;
      },
    }),
  };
  return { client: client as unknown as Supabase, calls };
}

describe("Kalenderquellen für die Ansichten (K-1): nie die geheime Adresse", () => {
  it("fragt nur id und enabled ab – die Adresse bleibt den Einstellungen vorbehalten", async () => {
    const { client, calls } = fakeClient([
      {
        id: "a",
        enabled: true,
        url: "https://calendar.google.com/calendar/ical/x/private-1/basic.ics",
      },
      { id: "b", enabled: false },
    ]);
    const sources = await fetchActiveCalendarSources(client);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe("calendar_sources");
    expect(calls[0]?.columns).not.toMatch(/\burl\b/);
    expect(sources).toEqual([
      { id: "a", enabled: true },
      { id: "b", enabled: false },
    ]);
  });

  it("streift die Adresse auch aus Zeilen der Warteschlange (Überlagerung)", () => {
    const pending: Record<string, unknown> & { id: string } = {
      id: "q",
      enabled: true,
      url: "https://calendar.google.com/…",
      name: "X",
    };
    expect(toActiveSource(pending)).toEqual({ id: "q", enabled: true });
    expect(toActiveSource({ id: "r" })).toEqual({ id: "r", enabled: true });
  });
});

describe("Google-Kalender an/aus (#64, N1a)", () => {
  function setup(rows: CalendarSourceRow[]) {
    const calls: SaveOp[][] = [];
    const queue = new SaveQueue({
      persist: async (batch) => void calls.push(batch),
      debounceMs: 0,
    });
    const client = new QueryClient();
    client.setQueryData(calendarSourcesKey, rows);
    const list = () => client.getQueryData<CalendarSourceRow[]>(calendarSourcesKey) ?? [];
    return { calls, queue, list, actions: createCalendarSourceActions(queue, client, "user-a") };
  }
  const ical = toCalendarSource({
    id: "ical-1",
    kind: "ical",
    name: "Dienst",
    url: "https://calendar.google.com/calendar/ical/x/private-1/basic.ics",
    sort: "a0",
  });
  const primary = { id: "alex@gmail.com", name: "Alex", color: "lila" as const };

  it("erstes Einschalten legt eine Zeile kind = google ohne Adresse an", async () => {
    const { calls, queue, list, actions } = setup([ical]);
    actions.setGoogleCalendar(primary, true);
    const google = list().find((s) => s.kind === "google");
    expect(google).toMatchObject({
      kind: "google",
      google_calendar_id: "alex@gmail.com",
      name: "Alex",
      url: "",
      color: "lila",
      enabled: true,
    });
    expect((google?.sort ?? "") > "a0").toBe(true);
    await queue.flush();
    const op = calls.flat().find((o) => o.id === google?.id);
    expect(op?.mode).toBe("upsert");
    expect(op?.values).toEqual({
      kind: "google",
      google_calendar_id: "alex@gmail.com",
      name: "Alex",
      color: "lila",
      enabled: true,
      sort: google?.sort,
      deleted_at: null,
    });
    // nie eine Adresse für Google-Zeilen
    expect(op?.values).not.toHaveProperty("url");
  });

  it("danach nur an/aus an derselben Zeile; aus ohne Zeile tut nichts", async () => {
    const { calls, queue, list, actions } = setup([]);
    actions.setGoogleCalendar(primary, false);
    expect(list()).toEqual([]);
    actions.setGoogleCalendar(primary, true);
    const id = list()[0]?.id;
    actions.setGoogleCalendar({ ...primary, name: "Anders" }, false);
    actions.setGoogleCalendar(primary, false);
    expect(list()).toHaveLength(1);
    expect(list()[0]).toMatchObject({ id, enabled: false, name: "Alex" });
    await queue.flush();
    // angelegt und gleich wieder aus: zuletzt gespeichert ist „aus“
    const ops = calls.flat().filter((o) => o.id === id);
    expect(ops[0]?.mode).toBe("upsert");
    expect(ops.at(-1)?.values.enabled).toBe(false);
  });

  it("feste ID je Nutzer und Kalender: zweites Gerät und Papierkorb treffen dieselbe Zeile (G-4)", async () => {
    const id = googleSourceId("user-a", primary.id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(googleSourceId("user-a", primary.id)).toBe(id);
    expect(googleSourceId("user-b", primary.id)).not.toBe(id);
    expect(googleSourceId("user-a", "anders@gmail.com")).not.toBe(id);
    // zwei Geräte schalten denselben Kalender ein → dieselbe Zeile (Upsert), kein zweiter Eintrag
    const one = setup([]);
    const two = setup([]);
    one.actions.setGoogleCalendar(primary, true);
    two.actions.setGoogleCalendar(primary, true);
    expect(one.list()[0]?.id).toBe(id);
    expect(two.list()[0]?.id).toBe(id);
    // Zeile liegt im Papierkorb (nicht in der Liste): Einschalten holt sie per Upsert zurück
    await one.queue.flush();
    const op = one.calls.flat().find((o) => o.id === id);
    expect(op).toMatchObject({ mode: "upsert", values: { deleted_at: null, enabled: true } });
  });

  it("Name leer → „Google-Kalender“, höchstens 80 Zeichen", () => {
    const { list, actions } = setup([]);
    actions.setGoogleCalendar({ id: "a@x", name: "  ", color: "blau" }, true);
    actions.setGoogleCalendar({ id: "b@x", name: "x".repeat(120), color: "blau" }, true);
    expect(list().map((s) => s.name.length)).toEqual([15, 80]);
    expect(list()[0]?.name).toBe("Google-Kalender");
  });

  it("Reihenfolge ändern bleibt unter den Quellen derselben Art", () => {
    const google = { ...ical, id: "g", kind: "google" as const, url: "", sort: "a1" };
    const second = { ...ical, id: "ical-2", sort: "a2" };
    const { list, actions } = setup([ical, google, second]);
    actions.move("ical-2", -1);
    const icals = list()
      .filter((s) => s.kind === "ical")
      .map((s) => s.id);
    expect(icals).toEqual(["ical-2", "ical-1"]);
  });
});

describe("#85: Termine monatsweise zusammenführen", () => {
  const ev = (id: string, date: string) => ({ id, date, endDate: date }) as CalendarEvent;
  const month = (
    events: CalendarEvent[],
    at: number,
    sourceError: string | null = null,
  ): UseQueryResult<CalendarResponse> =>
    ({
      data: {
        range: { start: "2026-10-01", end: "2026-10-31" },
        events,
        sources: [{ id: "q", name: "Q", color: "blau", count: events.length, error: sourceError }],
        fetchedAt: "",
      },
      dataUpdatedAt: at,
      isError: false,
      refetch: async () => undefined,
    }) as unknown as UseQueryResult<CalendarResponse>;
  const pending = {
    data: undefined,
    isError: false,
  } as unknown as UseQueryResult<CalendarResponse>;
  const failed = { data: undefined, isError: true } as unknown as UseQueryResult<CalendarResponse>;

  it("Termine über die Monatsgrenze nur einmal, Stand der Quellen aus der jüngsten Antwort", () => {
    const result = combineEventMonths([
      month([ev("a", "2026-10-05"), ev("lang", "2026-10-31")], 2, "alt"),
      pending,
      month([ev("lang", "2026-10-31"), ev("b", "2026-11-03")], 5),
    ]);
    expect(result.data?.events.map((e) => e.id)).toEqual(["a", "lang", "b"]);
    expect(result.data?.sources[0]?.error).toBeNull();
    expect(result.isError).toBe(false);
  });

  it("noch nichts geladen: keine Daten; ein Monat ohne Antwort meldet den Fehler", () => {
    expect(combineEventMonths([pending]).data).toBeUndefined();
    const result = combineEventMonths([month([ev("a", "2026-10-05")], 1), failed]);
    expect(result.data?.events).toHaveLength(1);
    expect(result.isError).toBe(true);
  });
});
