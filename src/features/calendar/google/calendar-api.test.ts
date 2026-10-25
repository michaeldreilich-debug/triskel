import { describe, expect, it, vi } from "vitest";
import { apiPath, googleApiRequest } from "./calendar-api";
import { deleteGoogleEvent, patchGoogleEvent, patchTimeField } from "./events-api";
import { eventIdSchema } from "./patch-input";

const endpoints = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://www.googleapis.com/calendar/v3",
};

describe("Adressen der Calendar API (G-3)", () => {
  it("kodiert jeden Teil – /, ?, # und % bleiben im Teil", () => {
    expect(apiPath("calendars", "de.german#holiday@group.v.calendar.google.com", "events")).toBe(
      "/calendars/de.german%23holiday%40group.v.calendar.google.com/events",
    );
    expect(apiPath("calendars", "a/../b?x=1", "events")).toBe(
      "/calendars/a%2F..%2Fb%3Fx%3D1/events",
    );
  });

  it("„.“, „..“ und leere Teile sind verboten (der URL-Parser löste sie sonst auf)", () => {
    for (const bad of [".", "..", ""]) {
      expect(() => apiPath("calendars", "primary", "events", bad)).toThrow("Ungültiger API-Pfad.");
    }
    // so hätte es ausgesehen: …/events/.. wird zu …/calendars/primary/
    expect(
      new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events/..").pathname,
    ).toBe("/calendar/v3/calendars/primary/");
  });

  it("ein Termin „..“ erreicht Google nie", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      deleteGoogleEvent(endpoints, "token", "primary", "..", null, { fetchImpl }),
    ).rejects.toThrow("Ungültiger API-Pfad.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Termin-IDs: Google-IDs und Serien-Instanzen ja, nur Punkte nein", () => {
    for (const id of ["abc123", "abc_20261021T070000Z", "x.y@google.com", "a..b"]) {
      expect(eventIdSchema.safeParse(id).success, id).toBe(true);
    }
    for (const id of [".", "..", "a/b", "a?b", "a#b", "a b", ""]) {
      expect(eventIdSchema.safeParse(id).success, id).toBe(false);
    }
  });

  it("bleibt bei der festen Basis", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    await googleApiRequest(
      endpoints,
      "token",
      apiPath("users", "me", "calendarList"),
      {},
      { fetchImpl },
    );
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    );
    await expect(googleApiRequest(endpoints, "token", "//evil.example/x")).rejects.toThrow(
      "Ungültiger API-Pfad.",
    );
  });
});

describe("Zeitfelder beim Ändern (G-6)", () => {
  it("leeren das jeweils andere Feld ausdrücklich", () => {
    expect(patchTimeField({ date: "2026-10-21" })).toEqual({ date: "2026-10-21", dateTime: null });
    expect(
      patchTimeField({ dateTime: "2026-10-21T07:00:00.000Z", timeZone: "Europe/Berlin" }),
    ).toEqual({ dateTime: "2026-10-21T07:00:00.000Z", timeZone: "Europe/Berlin", date: null });
  });

  it("gehen so an Google; Texte und Status unverändert, ohne Zeit kein start/end", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "e1", etag: '"2"' });
    });
    await patchGoogleEvent(
      endpoints,
      "token",
      "primary",
      "e1",
      '"1"',
      { start: { date: "2026-10-21" }, end: { date: "2026-10-22" } },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    await patchGoogleEvent(
      endpoints,
      "token",
      "primary",
      "e1",
      null,
      { summary: "Neu", status: "confirmed" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(bodies).toEqual([
      {
        start: { date: "2026-10-21", dateTime: null },
        end: { date: "2026-10-22", dateTime: null },
      },
      { summary: "Neu", status: "confirmed" },
    ]);
  });
});
