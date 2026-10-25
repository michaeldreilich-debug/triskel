/**
 * „Rückgängig“ für Google-Termine im KI-Protokoll (N1d): ruft die richtigen App-Routen auf
 * (gemocktes fetch), meldet Fehler verständlich und liefert dann „nicht zurückgeholt“.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canUndo, isEventUndo, parseUndo, undoOps } from "./activity";
import { undoEventAction } from "./event-undo";
import type { EventUndo } from "./event-undo-model";

const SOURCES = new Map([
  ["haupt@example.com", "src-haupt"],
  ["zweit@example.com", "src-zweit"],
]);

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}
let calls: Call[] = [];
let respond: (call: Call) => { status: number; body: Record<string, unknown> };

beforeEach(() => {
  calls = [];
  respond = () => ({ status: 200, body: { ok: true } });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { url, method: init.method ?? "GET", body: JSON.parse(String(init.body)) };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const times = {
  allDay: false,
  start: "2026-12-09T09:00:00.000Z",
  end: "2026-12-09T10:00:00.000Z",
  timeZone: "Europe/Berlin",
};

describe("Rückgängig für Termine: Daten", () => {
  const create: EventUndo = {
    kind: "event_create",
    calendar_id: "haupt@example.com",
    event_id: "ev1",
    etag: '"nach-anlegen"',
    date: "2026-12-09",
  };

  it("parseUndo erkennt die Arten; kaputte Daten nicht; canUndo gilt auch für Termine", () => {
    expect(parseUndo(create)).toEqual(create);
    expect(isEventUndo(parseUndo(create))).toBe(true);
    expect(parseUndo({ kind: "event_create", calendar_id: "x" })).toBeNull();
    expect(parseUndo({ kind: "event_update", calendar_id: "x", event_id: "e" })).toBeNull();
    expect(canUndo({ undo: create, undone_at: null })).toBe(true);
    expect(canUndo({ undo: create, undone_at: "2026-10-18T10:00:00Z" })).toBe(false);
  });

  it("undoOps für Termine vermerkt nur „zurückgeholt“ – die Routen laufen vorher", () => {
    expect(undoOps({ id: "l1", undo: create }, "2026-10-18T10:00:00.000Z")).toEqual([
      {
        table: "ai_activity",
        id: "l1",
        mode: "update",
        values: { undone_at: "2026-10-18T10:00:00.000Z" },
      },
    ]);
  });
});

describe("Rückgängig für Termine: Routen", () => {
  it("angelegt ohne etag → kein Rückgängig (M-1/K-4); schon weg gilt als erledigt", async () => {
    // ohne etag ließe sich über die App-Route (prüft keine Serie) eine ganze Serie löschen
    expect(
      parseUndo({ kind: "event_create", calendar_id: "haupt@example.com", event_id: "ev1" }),
    ).toBeNull();
    const undo: EventUndo = {
      kind: "event_create",
      calendar_id: "haupt@example.com",
      event_id: "ev1",
      etag: '"nach-anlegen"',
    };
    expect(await undoEventAction(undo, SOURCES)).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        url: "/api/kalender/termin",
        method: "DELETE",
        body: { sourceId: "src-haupt", eventId: "ev1", etag: '"nach-anlegen"' },
      },
    ]);
    respond = () => ({ status: 404, body: { error: "weg", gone: true } });
    expect(await undoEventAction(undo, SOURCES)).toMatchObject({
      ok: true,
      note: expect.any(String),
    });
  });

  it("angelegt mit etag → löschen nur, wenn unverändert; seitdem geändert → Meldung (G-7)", async () => {
    const undo: EventUndo = {
      kind: "event_create",
      calendar_id: "haupt@example.com",
      event_id: "ev1",
      etag: '"nach-anlegen"',
    };
    expect(parseUndo(undo)).toEqual(undo);
    expect(await undoEventAction(undo, SOURCES)).toEqual({ ok: true });
    expect(calls[0]?.body).toEqual({
      sourceId: "src-haupt",
      eventId: "ev1",
      etag: '"nach-anlegen"',
    });
    respond = () => ({ status: 412, body: { error: "x", conflict: true } });
    expect(await undoEventAction(undo, SOURCES)).toMatchObject({
      ok: false,
      message: expect.stringContaining("seit der KI-Änderung in Google geändert"),
    });
  });

  it("Titel war vorher leer: der Rest kommt zurück, der Titel bleibt mit Hinweis (G-7)", async () => {
    const undo: EventUndo = {
      kind: "event_update",
      calendar_id: "haupt@example.com",
      event_id: "ev1",
      etag: "nach-ki",
      before: { summary: "", location: "Alt" },
    };
    respond = () => ({ status: 200, body: { ok: true, etag: "x" } });
    expect(await undoEventAction(undo, SOURCES)).toEqual({
      ok: true,
      note: expect.stringContaining("Titel bleibt"),
    });
    expect(calls[0]?.body).toEqual({
      sourceId: "src-haupt",
      eventId: "ev1",
      etag: "nach-ki",
      location: "Alt",
    });
    // nur der leere Titel: kein Aufruf, aber erledigt mit Hinweis
    calls = [];
    expect(await undoEventAction({ ...undo, before: { summary: "" } }, SOURCES)).toMatchObject({
      ok: true,
      note: expect.stringContaining("Titel bleibt"),
    });
    expect(calls).toHaveLength(0);
  });

  it("gelöscht → wiederherstellen mit allen Angaben; neu angelegt wird vermerkt", async () => {
    const undo: EventUndo = {
      kind: "event_delete",
      calendar_id: "haupt@example.com",
      event: { event_id: "ev1", summary: "Zahnarzt", location: "Praxis", description: "", times },
    };
    respond = () => ({
      status: 200,
      body: { ok: true, event: { google: { etag: "e2" } }, how: "same" },
    });
    expect(await undoEventAction(undo, SOURCES)).toEqual({ ok: true });
    expect(calls[0]).toEqual({
      url: "/api/kalender/termin/wiederherstellen",
      method: "POST",
      body: {
        sourceId: "src-haupt",
        eventId: "ev1",
        summary: "Zahnarzt",
        location: "Praxis",
        description: "",
        allDay: false,
        start: times.start,
        end: times.end,
        timeZone: "Europe/Berlin",
      },
    });
    respond = () => ({
      status: 200,
      body: { ok: true, event: { google: { etag: "e3" } }, how: "new" },
    });
    expect(await undoEventAction(undo, SOURCES)).toMatchObject({
      ok: true,
      note: expect.stringContaining("neu angelegt"),
    });
  });

  it("geändert und verschoben → erst zurück in den alten Kalender, dann alte Werte mit dem neuen etag", async () => {
    const undo: EventUndo = {
      kind: "event_update",
      calendar_id: "zweit@example.com",
      event_id: "ev1",
      etag: "nach-ki",
      moved_from: "haupt@example.com",
      before: { summary: "Alt", location: "", times },
    };
    respond = (call) =>
      call.url.endsWith("/verschieben-kalender")
        ? { status: 200, body: { ok: true, event: { google: { etag: "nach-move" } } } }
        : { status: 200, body: { ok: true, etag: "fertig" } };
    expect(await undoEventAction(undo, SOURCES)).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        url: "/api/kalender/termin/verschieben-kalender",
        method: "POST",
        body: {
          sourceId: "src-zweit",
          destinationSourceId: "src-haupt",
          eventId: "ev1",
          etag: "nach-ki",
        },
      },
      {
        url: "/api/kalender/termin",
        method: "PATCH",
        body: {
          sourceId: "src-haupt",
          eventId: "ev1",
          etag: "nach-move",
          summary: "Alt",
          location: "",
          allDay: false,
          start: times.start,
          end: times.end,
          timeZone: "Europe/Berlin",
        },
      },
    ]);
  });

  it("nur Werte zurück: PATCH mit dem etag nach der KI-Änderung", async () => {
    const undo: EventUndo = {
      kind: "event_update",
      calendar_id: "haupt@example.com",
      event_id: "ev1",
      etag: "nach-ki",
      before: { description: "Alt" },
    };
    respond = () => ({ status: 200, body: { ok: true, etag: "x" } });
    await undoEventAction(undo, SOURCES);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      sourceId: "src-haupt",
      eventId: "ev1",
      etag: "nach-ki",
      description: "Alt",
    });
  });

  it("Fehler verständlich: Konflikt, Termin weg, nicht verbunden, Kalender unbekannt", async () => {
    const undo: EventUndo = {
      kind: "event_update",
      calendar_id: "haupt@example.com",
      event_id: "ev1",
      etag: "nach-ki",
      before: { summary: "Alt" },
    };
    respond = () => ({ status: 412, body: { error: "x", conflict: true } });
    expect(await undoEventAction(undo, SOURCES)).toMatchObject({
      ok: false,
      message: expect.stringContaining("seit der KI-Änderung in Google geändert"),
    });
    respond = () => ({ status: 404, body: { error: "x", gone: true } });
    expect(await undoEventAction(undo, SOURCES)).toMatchObject({
      ok: false,
      message: expect.stringContaining("nicht mehr"),
    });
    respond = () => ({ status: 409, body: { error: "x", state: "reconnect" } });
    expect(await undoEventAction(undo, SOURCES)).toMatchObject({
      ok: false,
      message: expect.stringContaining("neu verbinden"),
    });
    calls = [];
    expect(await undoEventAction(undo, new Map())).toMatchObject({
      ok: false,
      message: expect.stringContaining("nicht eingeschaltet"),
    });
    expect(calls).toHaveLength(0);
  });
});
