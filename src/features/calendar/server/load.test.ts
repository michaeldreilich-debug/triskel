import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  allowedOrigins,
  calendarIdFromUrl,
  checkCalendarUrl,
  clearCalendarCache,
  fetchIcsText,
  loadSourceEvents,
  parseRange,
  probeCalendar,
} from "./load";

const ics = readFileSync(path.join(__dirname, "..", "__fixtures__", "probe.ics"), "utf8");
const GOOGLE = "https://calendar.google.com/calendar/ical/alex%40example.com/private-abc/basic.ics";

const respond = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/calendar" }, ...init });

beforeEach(() => clearCalendarCache());

describe("Adresse prüfen (SSRF-Schutz)", () => {
  it("nur die geheime Google-Adresse, ohne Zugangsdaten, ohne fremde Hosts", () => {
    expect(checkCalendarUrl(GOOGLE).ok).toBe(true);
    for (const bad of [
      "http://calendar.google.com/calendar/ical/x/basic.ics",
      "https://calendar.google.com/calendar/embed?src=x",
      "https://calendar.google.com.evil.example/calendar/ical/x",
      "https://user:pw@calendar.google.com/calendar/ical/x/basic.ics",
      "https://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "nix",
      "",
    ]) {
      const result = checkCalendarUrl(bad, ["https://calendar.google.com"]);
      expect(result.ok, bad).toBe(false);
      // die Meldung nennt nie die geprüfte Adresse (nur den festen Google-Anfang)
      if (!result.ok && bad.length > 4) expect(result.error).not.toContain(bad);
    }
  });

  it("zusätzliche Ursprünge nur außerhalb der Produktion", () => {
    expect(
      allowedOrigins({ NODE_ENV: "test", CALENDAR_ALLOWED_ORIGINS: "http://localhost:3100" }),
    ).toEqual(["https://calendar.google.com", "http://localhost:3100"]);
    expect(
      allowedOrigins({ NODE_ENV: "production", CALENDAR_ALLOWED_ORIGINS: "http://localhost:3100" }),
    ).toEqual(["https://calendar.google.com"]);
    expect(checkCalendarUrl("http://localhost:3100/dev/ics", ["http://localhost:3100"]).ok).toBe(
      true,
    );
  });

  it("Kalender-ID aus der Adresse (für Links nach Google)", () => {
    expect(calendarIdFromUrl(new URL(GOOGLE))).toBe("alex@example.com");
    expect(calendarIdFromUrl(new URL("http://localhost:3100/dev/ics"))).toBeNull();
  });

  it("Zeitraum: gültige Tage, Ende nicht vor Beginn, höchstens 400 Tage", () => {
    expect(parseRange("2026-10-12", "2026-10-18")).toEqual({
      start: "2026-10-12",
      end: "2026-10-18",
    });
    expect(parseRange("2026-10-18", "2026-10-12")).toBeNull();
    expect(parseRange("heute", "2026-10-12")).toBeNull();
    expect(parseRange(null, null)).toBeNull();
    expect(parseRange("2026-01-01", "2028-01-01")).toEqual({
      start: "2026-01-01",
      end: "2027-02-04",
    });
  });
});

describe("ICS laden", () => {
  it("lädt, liefert den Text und bedient den zweiten Aufruf aus dem Cache", async () => {
    const fetchImpl = vi.fn(async () => respond(ics));
    const url = new URL(GOOGLE);
    let now = 1_000_000;
    const deps = { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now };
    expect(await fetchIcsText(url, deps)).toContain("Probe-Kalender");
    expect(await fetchIcsText(url, deps)).toContain("Probe-Kalender");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.redirect).toBe("manual");
    now += 6 * 60_000;
    await fetchIcsText(url, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await fetchIcsText(url, { ...deps, fresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("Fehler als feste Meldungen ohne Adresse: Weiterleitung, 404, Serverfehler, kein Kalender, zu groß", async () => {
    const url = new URL(GOOGLE);
    const cases: Array<[Response, RegExp]> = [
      [
        respond("", { status: 302, headers: { location: "https://evil.example" } }),
        /leitet weiter/,
      ],
      [respond("", { status: 404 }), /404/],
      [respond("", { status: 500 }), /Status 500/],
      [respond("<html>nope</html>"), /kein Kalender/],
      [respond(ics.repeat(2)), /zu groß/],
    ];
    for (const [response, message] of cases) {
      clearCalendarCache();
      const fetchImpl = (async () => response) as unknown as typeof fetch;
      await expect(fetchIcsText(url, { fetchImpl, maxBytes: ics.length + 10 })).rejects.toThrow(
        message,
      );
    }
    const failing = (async () => {
      throw new TypeError(`fetch failed ${GOOGLE}`);
    }) as unknown as typeof fetch;
    await expect(fetchIcsText(url, { fetchImpl: failing })).rejects.toThrow(/nicht erreichbar/);
    await expect(fetchIcsText(url, { fetchImpl: failing })).rejects.not.toThrow(/private-abc/);
  });

  it("Termine einer Quelle mit Status; ungültige Adresse oder Fehler → leer mit Meldung", async () => {
    const source = { id: "q1", name: "Dienst", color: "orange" as const, url: GOOGLE };
    const ok = await loadSourceEvents(
      source,
      { start: "2026-10-20", end: "2026-10-22" },
      { fetchImpl: (async () => respond(ics)) as unknown as typeof fetch },
    );
    expect(ok.status).toEqual({ id: "q1", name: "Dienst", color: "orange", count: 3, error: null });
    expect(ok.events.map((e) => e.title)).toEqual(["Call New York", "Online-Schulung", "Übung"]);
    expect(ok.events[0]?.link).toContain("calendar.google.com/calendar/event?eid=");
    expect(JSON.stringify(ok)).not.toContain("private-abc");

    const bad = await loadSourceEvents(
      { ...source, url: "https://evil.example/x.ics" },
      { start: "2026-10-20", end: "2026-10-22" },
    );
    expect(bad.events).toEqual([]);
    expect(bad.status.error).toMatch(/calendar\.google\.com/);
    clearCalendarCache();
    const down = await loadSourceEvents(
      source,
      { start: "2026-10-20", end: "2026-10-22" },
      { fetchImpl: (async () => respond("", { status: 503 })) as unknown as typeof fetch },
    );
    expect(down.status.error).toBe("Google antwortet mit Status 503.");
  });

  it("Probe-Abruf: Name, Anzahl der nächsten 30 Tage, die nächsten drei Termine", async () => {
    const probe = await probeCalendar(
      GOOGLE,
      { fetchImpl: (async () => respond(ics)) as unknown as typeof fetch },
      new Date("2026-10-23T09:00:00Z"),
    );
    expect(probe.ok).toBe(true);
    expect(probe.calendarName).toBe("Probe-Kalender");
    expect(probe.count).toBeGreaterThan(5);
    expect(probe.next).toEqual([
      { title: "Herbstfest", date: "2026-10-24", time: null },
      { title: "Morgenlauf", date: "2026-10-24", time: "08:00" },
      { title: "Morgenlauf", date: "2026-10-25", time: "08:00" },
    ]);
    const failed = await probeCalendar("https://example.com/x.ics");
    expect(failed).toMatchObject({ ok: false, count: 0, next: [] });
    expect(failed.error).toMatch(/calendar\.google\.com/);
  });
});
