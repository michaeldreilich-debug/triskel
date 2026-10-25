import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleAccess } from "../google/access";
import { GoogleApiError } from "../google/calendar-api";
import { GoogleAuthError } from "../google/oauth";
import type { CalendarEvent } from "../types";
import {
  clearGoogleEventsCache,
  GOOGLE_CACHE_MAX,
  GOOGLE_CACHE_MS,
  googleEventsCacheSize,
  type LoadAllDeps,
  loadAllSources,
  type SourceRow,
} from "./load-all";

const RANGE = { start: "2026-10-19", end: "2026-10-25" };
const CAL = "alex@example.com";
const ICAL_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL)}/private-x/basic.ics`;

const google = (extra: Partial<SourceRow> = {}): SourceRow => ({
  id: "g1",
  kind: "google",
  name: "Hauptkalender",
  url: null,
  google_calendar_id: CAL,
  color: "lila",
  ...extra,
});
const ical = (extra: Partial<SourceRow> = {}): SourceRow => ({
  id: "i1",
  kind: "ical",
  name: "iCal",
  url: ICAL_URL,
  google_calendar_id: null,
  color: "blau",
  ...extra,
});

const connected: GoogleAccess = {
  state: "connected",
  email: CAL,
  scope: "x",
  accessToken: "token",
  endpoints: { auth: "a", token: "t", revoke: "r", api: "https://x.example/calendar/v3" },
};

const page = (items: unknown[] = []) => ({ accessRole: "owner" as const, items });
const item = (id: string) => ({
  id,
  etag: '"1"',
  summary: id,
  start: { dateTime: "2026-10-21T09:00:00+02:00" },
  end: { dateTime: "2026-10-21T10:00:00+02:00" },
});

const icalEvent = { id: "ev", title: "aus iCal" } as unknown as CalendarEvent;

function deps(over: Partial<Omit<LoadAllDeps, "access">> & { access?: GoogleAccess } = {}) {
  const { access = connected, ...rest } = over;
  const accessFn = vi.fn(async () => access);
  const listEvents = vi.fn(async () => page([item("a")]));
  const loadIcal = vi.fn(async (source: { id: string; name: string; color: "blau" }) => ({
    events: [icalEvent],
    status: { id: source.id, name: source.name, color: source.color, count: 1, error: null },
  }));
  return {
    accessFn,
    listEvents,
    loadIcal,
    deps: {
      access: accessFn,
      userId: "u1",
      listEvents,
      loadIcal,
      ...rest,
    } as unknown as LoadAllDeps,
  };
}

beforeEach(() => clearGoogleEventsCache());

describe("verbunden: Google über die Schnittstelle, iCal nicht doppelt", () => {
  it("lädt Google-Termine und lässt die ersetzte iCal-Quelle weg", async () => {
    const d = deps();
    const result = await loadAllSources([google(), ical()], RANGE, d.deps);
    expect(d.listEvents).toHaveBeenCalledTimes(1);
    expect(d.listEvents).toHaveBeenCalledWith(connected.endpoints, "token", CAL, RANGE);
    expect(d.loadIcal).not.toHaveBeenCalled();
    expect(result.events.map((e) => e.title)).toEqual(["a"]);
    expect(result.events[0]?.google?.editable).toBe(true);
    expect(result.sources).toEqual([
      {
        id: "g1",
        name: "Hauptkalender",
        color: "lila",
        count: 1,
        error: null,
        writable: true,
        primary: true,
      },
    ]);
  });

  it("andere iCal-Quellen (andere Adresse) laufen weiter", async () => {
    const d = deps();
    const other = ical({
      id: "i2",
      url: "https://calendar.google.com/calendar/ical/anders%40example.com/private-y/basic.ics",
    });
    const result = await loadAllSources([google(), ical(), other], RANGE, d.deps);
    expect(d.loadIcal).toHaveBeenCalledTimes(1);
    expect(result.events.map((e) => e.title)).toEqual(["a", "aus iCal"]);
    expect(result.sources.map((s) => s.id)).toEqual(["g1", "i2"]);
  });

  it("nur lesbarer Kalender: Termine nicht editierbar", async () => {
    const d = deps();
    d.listEvents.mockResolvedValue({ accessRole: "reader" as never, items: [item("f")] });
    const result = await loadAllSources([google()], RANGE, d.deps);
    expect(result.events[0]?.google?.editable).toBe(false);
  });

  it("Cache: zweiter Abruf ohne Google, frisch und abgelaufen holen neu", async () => {
    const d = deps({ now: () => 1_000 });
    await loadAllSources([google()], RANGE, d.deps);
    await loadAllSources([google()], RANGE, d.deps);
    expect(d.listEvents).toHaveBeenCalledTimes(1);
    expect(d.accessFn).toHaveBeenCalledTimes(1);
    await loadAllSources([google()], RANGE, { ...d.deps, fresh: true });
    expect(d.listEvents).toHaveBeenCalledTimes(2);
    await loadAllSources([google()], RANGE, { ...d.deps, now: () => 1_000 + GOOGLE_CACHE_MS + 1 });
    expect(d.listEvents).toHaveBeenCalledTimes(3);
    clearGoogleEventsCache("u1");
    await loadAllSources([google()], RANGE, { ...d.deps, now: () => 1_000 + GOOGLE_CACHE_MS + 2 });
    expect(d.listEvents).toHaveBeenCalledTimes(4);
  });

  it("Cache wächst nicht ohne Ende: Abgelaufenes fliegt raus, höchstens GOOGLE_CACHE_MAX (G-5)", async () => {
    const d = deps({ now: () => 1_000 });
    for (let i = 0; i < 5; i += 1) {
      await loadAllSources([google({ google_calendar_id: `cal${i}@x` })], RANGE, d.deps);
    }
    expect(googleEventsCacheSize()).toBe(5);
    // eine Minute später: der neue Eintrag räumt die abgelaufenen ab
    await loadAllSources([google()], RANGE, { ...d.deps, now: () => 1_000 + GOOGLE_CACHE_MS });
    expect(googleEventsCacheSize()).toBe(1);
    // viele Zeiträume in kurzer Zeit: gedeckelt
    for (let i = 0; i < GOOGLE_CACHE_MAX + 20; i += 1) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
      await loadAllSources(
        [google()],
        { start: `2027-${month}-${day}`, end: `2027-${month}-${day}` },
        { ...d.deps, now: () => 2_000 + GOOGLE_CACHE_MS },
      );
    }
    expect(googleEventsCacheSize()).toBe(GOOGLE_CACHE_MAX);
    // Trennen/Verbinden leeren den Cache des Nutzers
    clearGoogleEventsCache("u1");
    expect(googleEventsCacheSize()).toBe(0);
  });

  it("anderer Zeitraum, anderer Nutzer: eigener Cache", async () => {
    const d = deps();
    await loadAllSources([google()], RANGE, d.deps);
    await loadAllSources([google()], { start: "2026-10-26", end: "2026-11-01" }, d.deps);
    await loadAllSources([google()], RANGE, { ...d.deps, userId: "u2" });
    expect(d.listEvents).toHaveBeenCalledTimes(3);
  });
});

describe("ohne Verbindung oder bei Fehlern", () => {
  it("nicht verbunden / nicht eingerichtet: Google-Zeilen schweigen, iCal läuft", async () => {
    for (const access of [
      { state: "disconnected" } as GoogleAccess,
      { state: "not-configured", error: "fehlt" } as GoogleAccess,
    ]) {
      const d = deps({ access });
      const result = await loadAllSources([google(), ical()], RANGE, d.deps);
      expect(d.listEvents).not.toHaveBeenCalled();
      expect(result.events.map((e) => e.title)).toEqual(["aus iCal"]);
      expect(result.sources.map((s) => s.id)).toEqual(["i1"]);
    }
  });

  it("Zugang weg: Hinweis „neu verbinden“ und Rückfall auf die ersetzte iCal-Quelle", async () => {
    const d = deps({
      access: { state: "reconnect", email: CAL, error: "Zugang weg – bitte neu verbinden." },
    });
    const result = await loadAllSources([google(), ical()], RANGE, d.deps);
    expect(result.events.map((e) => e.title)).toEqual(["aus iCal"]);
    expect(result.sources).toEqual([
      {
        id: "g1",
        name: "Hauptkalender",
        color: "lila",
        count: 0,
        error: "Zugang weg – bitte neu verbinden.",
        reconnect: true,
      },
      { id: "i1", name: "iCal", color: "blau", count: 1, error: null },
    ]);
  });

  it("Google antwortet mit 401 mitten im Laden: ebenso", async () => {
    const d = deps();
    d.listEvents.mockRejectedValue(new GoogleAuthError("nein", "reconnect"));
    const result = await loadAllSources([google(), ical()], RANGE, d.deps);
    expect(result.sources[0]).toMatchObject({ id: "g1", reconnect: true });
    expect(result.sources[0]?.error).toContain("neu verbinden");
    expect(result.events.map((e) => e.title)).toEqual(["aus iCal"]);
  });

  it("anderer Fehler (404, nicht erreichbar): Meldung ohne Details, kein Reconnect, Rückfall", async () => {
    const d = deps();
    d.listEvents.mockRejectedValue(
      new GoogleApiError("Google kennt diesen Kalender nicht.", 404, null),
    );
    const r1 = await loadAllSources([google(), ical()], RANGE, d.deps);
    expect(r1.sources[0]).toMatchObject({ error: "Google kennt diesen Kalender nicht." });
    expect(r1.sources[0]?.reconnect).toBeUndefined();
    expect(r1.events).toHaveLength(1);
    d.listEvents.mockRejectedValue(new Error("secret-token-xyz"));
    const r2 = await loadAllSources([google()], RANGE, d.deps);
    expect(JSON.stringify(r2)).not.toContain("secret");
    expect(r2.sources[0]?.error).toBe("Der Google-Kalender ließ sich nicht laden.");
  });

  it("Zugang lässt sich nicht lesen (Ausnahme): Hinweis statt Absturz", async () => {
    const d = deps();
    d.accessFn.mockRejectedValue(new Error("db"));
    const result = await loadAllSources([google()], RANGE, d.deps);
    expect(result.sources[0]?.error).toBe("Das Google-Konto ließ sich nicht laden.");
  });

  it("nur iCal: Google wird nicht angefragt", async () => {
    const d = deps();
    await loadAllSources([ical()], RANGE, d.deps);
    expect(d.accessFn).not.toHaveBeenCalled();
    expect(d.loadIcal).toHaveBeenCalledTimes(1);
  });
});

describe("Schreibrecht je Kalender (N1c)", () => {
  it("Status nennt `writable` nur bei owner/writer; nur lesbar und Fehler: ohne", async () => {
    const listEvents = vi.fn(async (...args: unknown[]) => ({
      accessRole: args[2] === CAL ? ("writer" as const) : ("reader" as const),
      items: [],
    })) as unknown as LoadAllDeps["listEvents"];
    const d = deps({ listEvents });
    const result = await loadAllSources(
      [google(), google({ id: "g2", google_calendar_id: "feiertage@example.com" })],
      RANGE,
      d.deps,
    );
    expect(result.sources[0]?.writable).toBe(true);
    expect(result.sources[1]?.writable).toBeUndefined();
    // primär = die Kalender-ID ist die Adresse des Kontos; auch aus dem Cache
    expect(result.sources[0]?.primary).toBe(true);
    expect(result.sources[1]?.primary).toBeUndefined();
    const again = await loadAllSources([google()], RANGE, d.deps);
    expect(again.sources[0]).toMatchObject({ writable: true, primary: true });

    clearGoogleEventsCache();
    const failing = deps();
    failing.listEvents.mockRejectedValue(new GoogleApiError("nein", 500, null));
    const failed = await loadAllSources([google()], RANGE, failing.deps);
    expect(failed.sources[0]?.writable).toBeUndefined();
  });
});
