/**
 * Dienstschicht für Termine (N1c) gegen den Google-Ersatz: Anlegen, Ändern, Löschen,
 * Kalenderwechsel, Wiederherstellen (aus dem Papierkorb bzw. neu) – jeweils ohne Benachrichtigung.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleEndpoints } from "../google/config";
import type { NewGoogleEvent } from "../google/event-input";
import {
  FAKE_PRIMARY_ID,
  FAKE_READONLY_ID,
  handleFakeGoogle,
  resetFakeGoogle,
} from "../google/fake";
import { buildAuthUrl, exchangeCode, pkceChallenge, randomToken } from "../google/oauth";
import {
  type ConnectedAccess,
  createEvent,
  type GoogleSourceInfo,
  moveEventToCalendar,
  removeEvent,
  restoreEvent,
  updateEvent,
} from "./event-service";

const ORIGIN = "http://fake.test";
const env = {
  NODE_ENV: "test",
  GOOGLE_CLIENT_ID: "e2e.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "e2e-geheim",
  GOOGLE_OAUTH_BASE: `${ORIGIN}/dev/google/oauth`,
  GOOGLE_API_BASE: `${ORIGIN}/dev/google/calendar/v3`,
};
const endpoints = googleEndpoints(env);
const fakeFetch: typeof fetch = async (input, init) =>
  handleFakeGoogle(new Request(input instanceof URL ? input.href : String(input), init), env);

const main: GoogleSourceInfo = {
  id: "q1",
  name: "Haupt",
  color: "blau",
  calendarId: FAKE_PRIMARY_ID,
};
const other: GoogleSourceInfo = {
  id: "q2",
  name: "Feiertage",
  color: "gruen",
  calendarId: FAKE_READONLY_ID,
};

const draft: NewGoogleEvent = {
  summary: "Zahnarzt",
  location: "Praxis",
  description: "Kärtchen mitnehmen",
  times: {
    start: { dateTime: "2026-12-09T08:00:00.000Z", timeZone: "Europe/Berlin" },
    end: { dateTime: "2026-12-09T09:00:00.000Z", timeZone: "Europe/Berlin" },
  },
};

async function connect(): Promise<ConnectedAccess> {
  const verifier = randomToken();
  const redirectUri = `${ORIGIN}/api/google/callback`;
  const response = await fakeFetch(
    buildAuthUrl(endpoints, {
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri,
      state: randomToken(),
      challenge: pkceChallenge(verifier),
    }),
  );
  const back = new URL(response.headers.get("location") as string);
  const tokens = await exchangeCode(
    endpoints,
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      code: back.searchParams.get("code") as string,
      verifier,
      redirectUri,
    },
    { fetchImpl: fakeFetch },
  );
  return { endpoints, accessToken: tokens.accessToken };
}

interface FakeOps {
  ops: Array<{ op: string; eventId: string; sendUpdates: string | null; destination?: string }>;
  trash: string[];
}
const state = async (calendar = FAKE_PRIMARY_ID) =>
  (await (
    await fakeFetch(`${ORIGIN}/dev/google/_test/state?calendar=${encodeURIComponent(calendar)}`)
  ).json()) as FakeOps & { items: Array<{ id: string; summary?: string; location?: string }> };

let access: ConnectedAccess;
beforeEach(async () => {
  resetFakeGoogle();
  vi.stubGlobal("fetch", fakeFetch);
  access = await connect();
});
afterEach(() => vi.unstubAllGlobals());

describe("Termin-Dienste (Google-Ersatz)", () => {
  it("anlegen: normalisierter Termin mit Zeit, Ort, Beschreibung und Verweis; ohne Benachrichtigung", async () => {
    const event = await createEvent(access, main, draft);
    expect(event).toMatchObject({
      sourceId: "q1",
      title: "Zahnarzt",
      location: "Praxis",
      description: "Kärtchen mitnehmen",
      allDay: false,
      date: "2026-12-09",
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      google: { calendarId: FAKE_PRIMARY_ID, editable: true, recurringEventId: null },
    });
    expect(event.google?.etag).toBeTruthy();
    const { ops, items } = await state();
    expect(ops).toEqual([
      expect.objectContaining({
        op: "insert",
        eventId: event.google?.eventId,
        sendUpdates: "none",
      }),
    ]);
    expect(items).toHaveLength(1);
  });

  it("anlegen ganztägig; im nur lesbaren Kalender lehnt Google ab (403)", async () => {
    const day = await createEvent(access, main, {
      summary: "Urlaub",
      location: null,
      description: null,
      times: { start: { date: "2026-12-24" }, end: { date: "2026-12-27" } },
    });
    expect(day).toMatchObject({ allDay: true, date: "2026-12-24", endDate: "2026-12-26" });
    await expect(createEvent(access, other, draft)).rejects.toMatchObject({ status: 403 });
  });

  it("ändern: Titel, Ort leeren, Beschreibung; mit If-Match (altes etag → 412)", async () => {
    const created = await createEvent(access, main, draft);
    const eventId = created.google?.eventId as string;
    const updated = await updateEvent(access, main, {
      eventId,
      etag: created.google?.etag as string,
      text: { summary: "Zahnarzt Dr. Weiß", location: null },
    });
    expect(updated).toMatchObject({ title: "Zahnarzt Dr. Weiß", location: null });
    // Zeit und Beschreibung blieben, wie sie waren
    expect(updated.description).toBe("Kärtchen mitnehmen");
    expect(updated.startMinutes).toBe(9 * 60);
    await expect(
      updateEvent(access, main, {
        eventId,
        etag: created.google?.etag as string,
        text: { summary: "zu spät" },
      }),
    ).rejects.toMatchObject({ status: 412 });
  });

  it("löschen und wiederherstellen: derselbe Termin aus dem Papierkorb", async () => {
    const created = await createEvent(access, main, draft);
    const eventId = created.google?.eventId as string;
    await removeEvent(access, main, eventId, created.google?.etag as string);
    expect((await state()).items).toHaveLength(0);
    expect((await state()).ops.at(-1)).toMatchObject({ op: "delete", sendUpdates: "none" });
    const restored = await restoreEvent(access, main, eventId, draft);
    expect(restored.how).toBe("same");
    expect(restored.event.google?.eventId).toBe(eventId);
    expect((await state()).items.map((e) => e.id)).toEqual([eventId]);
    expect((await state()).trash).toEqual([]);
  });

  it("wiederherstellen ohne Papierkorb-Eintrag: neu anlegen mit allen Angaben", async () => {
    const restored = await restoreEvent(access, main, "gibtsnicht1", draft);
    expect(restored.how).toBe("new");
    expect(restored.event).toMatchObject({ title: "Zahnarzt", location: "Praxis" });
    expect(restored.event.google?.eventId).not.toBe("gibtsnicht1");
  });

  it("wiederherstellen ohne Schreibrecht: Fehler, kein Neuanlegen", async () => {
    await expect(restoreEvent(access, other, "abc12345", draft)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("Kalender wechseln: nicht in einen nur lesbaren (403); in einen beschreibbaren bleibt der Termin derselbe", async () => {
    const created = await createEvent(access, main, draft);
    const eventId = created.google?.eventId as string;
    await expect(
      moveEventToCalendar(access, main, other, eventId, created.google?.etag as string),
    ).rejects.toMatchObject({ status: 403 });
    expect((await state()).items).toHaveLength(1);

    await fakeFetch(`${ORIGIN}/dev/google/_test/add-calendar`, {
      method: "POST",
      body: JSON.stringify({ id: "privat@example.com", summary: "Privat" }),
    });
    const privat: GoogleSourceInfo = {
      id: "q3",
      name: "Privat",
      color: "lila",
      calendarId: "privat@example.com",
    };
    const moved = await moveEventToCalendar(
      access,
      main,
      privat,
      eventId,
      created.google?.etag as string,
    );
    expect(moved).toMatchObject({
      sourceId: "q3",
      title: "Zahnarzt",
      color: "lila",
      google: { calendarId: "privat@example.com", eventId },
    });
    expect((await state()).items).toHaveLength(0);
    expect((await state("privat@example.com")).items.map((e) => e.id)).toEqual([eventId]);
    expect((await state()).ops.at(-1)).toMatchObject({
      op: "move",
      sendUpdates: "none",
      destination: "privat@example.com",
    });
  });
});
