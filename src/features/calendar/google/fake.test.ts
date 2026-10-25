/**
 * Google-Ersatz (/dev/google) gegen die echten Bausteine der App: Anmelde-Adresse, Code-Tausch
 * mit PKCE, Refresh, Widerruf, Kalenderliste, Termine mit etag. Die Termin-Endpunkte nutzen
 * N1b–N1d; hier ist festgehalten, wie sie sich verhalten.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { apiPath, GoogleApiError, googleApiRequest, listGoogleCalendars } from "./calendar-api";
import { googleEndpoints } from "./config";
import { patchGoogleEvent } from "./events-api";
import { FAKE_PRIMARY_ID, FAKE_READONLY_ID, handleFakeGoogle, resetFakeGoogle } from "./fake";
import {
  buildAuthUrl,
  exchangeCode,
  GOOGLE_SCOPES,
  GoogleAuthError,
  pkceChallenge,
  randomToken,
  refreshAccessToken,
  revokeToken,
} from "./oauth";

const ORIGIN = "http://fake.test";
const env = {
  NODE_ENV: "test",
  GOOGLE_CLIENT_ID: "e2e.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "e2e-geheim",
  GOOGLE_OAUTH_BASE: `${ORIGIN}/dev/google/oauth`,
  GOOGLE_API_BASE: `${ORIGIN}/dev/google/calendar/v3`,
};
const endpoints = googleEndpoints(env);
const fetchImpl: typeof fetch = async (input, init) =>
  handleFakeGoogle(new Request(input instanceof URL ? input.href : String(input), init), env);
const deps = { fetchImpl };
const client = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
const redirectUri = `${ORIGIN}/api/google/callback`;

const control = async (action: string, body?: unknown) =>
  (
    await fetchImpl(`${ORIGIN}/dev/google/_test/${action}`, {
      method: body === undefined && action === "state" ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  ).json() as Promise<Record<string, unknown>>;

/** Anmelden wie der Browser: Adresse aufrufen, Code aus der Weiterleitung lesen, tauschen. */
async function connect(verifier = randomToken()) {
  const state = randomToken();
  const response = await fetchImpl(
    buildAuthUrl(endpoints, {
      clientId: client.clientId,
      redirectUri,
      state,
      challenge: pkceChallenge(verifier),
    }),
  );
  expect(response.status).toBe(302);
  const back = new URL(response.headers.get("location") as string);
  expect(`${back.origin}${back.pathname}`).toBe(redirectUri);
  expect(back.searchParams.get("state")).toBe(state);
  return { code: back.searchParams.get("code") as string, verifier, back };
}

beforeEach(() => resetFakeGoogle());

describe("OAuth im Google-Ersatz", () => {
  it("Code-Tausch mit PKCE liefert Refresh-Token und beide Berechtigungen", async () => {
    const { code, verifier } = await connect();
    const tokens = await exchangeCode(endpoints, { ...client, code, verifier, redirectUri }, deps);
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.scope.split(" ").sort()).toEqual([...GOOGLE_SCOPES].sort());
    // Code gilt nur einmal
    await expect(
      exchangeCode(endpoints, { ...client, code, verifier, redirectUri }, deps),
    ).rejects.toMatchObject({ kind: "reconnect" });
  });

  it("falscher PKCE-Verifier oder falscher Clientschlüssel → abgelehnt", async () => {
    const first = await connect();
    await expect(
      exchangeCode(
        endpoints,
        { ...client, code: first.code, verifier: randomToken(), redirectUri },
        deps,
      ),
    ).rejects.toBeInstanceOf(GoogleAuthError);
    const second = await connect();
    await expect(
      exchangeCode(
        endpoints,
        {
          ...client,
          clientSecret: "falsch",
          code: second.code,
          verifier: second.verifier,
          redirectUri,
        },
        deps,
      ),
    ).rejects.toMatchObject({ kind: "config" });
  });

  it("fremde Rücksprung-Adresse oder Clientschlüssel in der Adresse → Fehlerseite", async () => {
    const bad = new URL(
      buildAuthUrl(endpoints, {
        clientId: client.clientId,
        redirectUri: "https://evil.example/api/google/callback",
        state: randomToken(),
        challenge: pkceChallenge(randomToken()),
      }),
    );
    expect((await fetchImpl(bad)).status).toBe(400);
    bad.searchParams.set("redirect_uri", redirectUri);
    bad.searchParams.set("client_secret", "x");
    expect((await fetchImpl(bad)).status).toBe(400);
  });

  it("Abbrechen und abgewählte Berechtigung lassen sich für die nächste Anmeldung einstellen", async () => {
    await control("next", { deny: true });
    const denied = await connect();
    expect(denied.back.searchParams.get("error")).toBe("access_denied");
    expect(denied.code).toBeNull();
    await control("next", { scope: GOOGLE_SCOPES[0] });
    const { code, verifier } = await connect();
    const tokens = await exchangeCode(endpoints, { ...client, code, verifier, redirectUri }, deps);
    expect(tokens.scope).toBe(GOOGLE_SCOPES[0]);
  });

  it("Refresh, Kalenderliste, Widerruf → danach neu verbinden", async () => {
    const { code, verifier } = await connect();
    const tokens = await exchangeCode(endpoints, { ...client, code, verifier, redirectUri }, deps);
    const refreshToken = tokens.refreshToken as string;
    const fresh = await refreshAccessToken(endpoints, { ...client, refreshToken }, deps);
    const calendars = await listGoogleCalendars(endpoints, fresh.accessToken, deps);
    expect(calendars).toEqual([
      {
        id: FAKE_PRIMARY_ID,
        name: "E2E-Hauptkalender",
        color: "blau",
        accessRole: "owner",
        primary: true,
        writable: true,
      },
      {
        id: FAKE_READONLY_ID,
        name: "E2E-Feiertage",
        color: "gruen",
        accessRole: "reader",
        primary: false,
        writable: false,
      },
    ]);
    expect(await revokeToken(endpoints, refreshToken, deps)).toBe(true);
    expect(await control("state")).toMatchObject({
      refreshTokens: { live: 0, revoked: 1 },
      revokeCalls: 1,
    });
    await expect(
      refreshAccessToken(endpoints, { ...client, refreshToken }, deps),
    ).rejects.toMatchObject({ kind: "reconnect" });
    // der alte Zugriffs-Token gilt auch nicht mehr
    await expect(listGoogleCalendars(endpoints, fresh.accessToken, deps)).rejects.toMatchObject({
      kind: "reconnect",
    });
    // „Zugang in Google entfernt“ wirkt genauso
    const again = await connect();
    const second = await exchangeCode(
      endpoints,
      { ...client, code: again.code, verifier: again.verifier, redirectUri },
      deps,
    );
    await control("revoke-all");
    await expect(
      refreshAccessToken(
        endpoints,
        { ...client, refreshToken: second.refreshToken as string },
        deps,
      ),
    ).rejects.toMatchObject({ kind: "reconnect" });
  });
});

describe("Termine im Google-Ersatz (für N1b–N1d)", () => {
  async function accessToken() {
    const { code, verifier } = await connect();
    return (await exchangeCode(endpoints, { ...client, code, verifier, redirectUri }, deps))
      .accessToken;
  }
  const events = (calendarId: string) => apiPath("calendars", calendarId, "events");

  it("list mit Zeitraum, insert, patch mit If-Match (412 bei altem etag), delete (danach 410)", async () => {
    const token = await accessToken();
    await control("seed", {
      calendarId: FAKE_PRIMARY_ID,
      events: [
        {
          id: "termin1",
          summary: "E2E-Dienst",
          start: { dateTime: "2026-10-20T08:00:00+02:00", timeZone: "Europe/Berlin" },
          end: { dateTime: "2026-10-20T09:00:00+02:00", timeZone: "Europe/Berlin" },
        },
        {
          id: "termin2",
          summary: "E2E-Ganztägig",
          start: { date: "2026-10-22" },
          end: { date: "2026-10-23" },
        },
      ],
    });
    const list = await googleApiRequest(
      endpoints,
      token,
      events(FAKE_PRIMARY_ID),
      {
        query: {
          timeMin: "2026-10-20T00:00:00+02:00",
          timeMax: "2026-10-21T00:00:00+02:00",
          singleEvents: "true",
          orderBy: "startTime",
        },
      },
      deps,
    );
    const items = (list.body as { items: Array<{ id: string; etag: string }> }).items;
    expect(items.map((e) => e.id)).toEqual(["termin1"]);
    const etag = items[0]?.etag as string;

    const patched = await googleApiRequest(
      endpoints,
      token,
      apiPath("calendars", FAKE_PRIMARY_ID, "events", "termin1"),
      {
        method: "PATCH",
        ifMatch: etag,
        body: {
          start: { dateTime: "2026-10-20T10:00:00+02:00" },
          end: { dateTime: "2026-10-20T11:30:00+02:00" },
        },
      },
      deps,
    );
    const next = patched.body as { etag: string; start: { dateTime: string } };
    expect(next.start.dateTime).toBe("2026-10-20T10:00:00+02:00");
    expect(next.etag).not.toBe(etag);

    const stale = await googleApiRequest(
      endpoints,
      token,
      apiPath("calendars", FAKE_PRIMARY_ID, "events", "termin1"),
      { method: "PATCH", ifMatch: etag, body: { summary: "zu spät" } },
      deps,
    ).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(GoogleApiError);
    expect(stale).toMatchObject({ status: 412, reason: "conditionNotMet" });

    // in Google geändert (touch) → altes etag passt nicht mehr
    await control("touch", { calendarId: FAKE_PRIMARY_ID, eventId: "termin1" });
    await expect(
      googleApiRequest(
        endpoints,
        token,
        apiPath("calendars", FAKE_PRIMARY_ID, "events", "termin1"),
        { method: "PATCH", ifMatch: next.etag, body: { summary: "x" } },
        deps,
      ),
    ).rejects.toMatchObject({ status: 412 });

    const created = await googleApiRequest(
      endpoints,
      token,
      events(FAKE_PRIMARY_ID),
      {
        method: "POST",
        body: {
          summary: "E2E-Neu",
          start: { dateTime: "2026-10-21T14:00:00+02:00" },
          end: { dateTime: "2026-10-21T15:00:00+02:00" },
        },
      },
      deps,
    );
    const id = (created.body as { id: string }).id;
    const removed = await googleApiRequest(
      endpoints,
      token,
      apiPath("calendars", FAKE_PRIMARY_ID, "events", id),
      { method: "DELETE" },
      deps,
    );
    expect(removed.status).toBe(204);
    await expect(
      googleApiRequest(
        endpoints,
        token,
        apiPath("calendars", FAKE_PRIMARY_ID, "events", id),
        {},
        deps,
      ),
    ).rejects.toMatchObject({ status: 410 });
  });

  it("ganztägig ↔ mit Uhrzeit: Google führt start/end zusammen – die App leert das alte Feld (G-6)", async () => {
    const token = await accessToken();
    await control("seed", {
      calendarId: FAKE_PRIMARY_ID,
      events: [
        {
          id: "termin3",
          summary: "E2E-Wechsel",
          start: { dateTime: "2026-10-20T08:00:00.000Z", timeZone: "Europe/Berlin" },
          end: { dateTime: "2026-10-20T09:00:00.000Z", timeZone: "Europe/Berlin" },
        },
      ],
    });
    const path = apiPath("calendars", FAKE_PRIMARY_ID, "events", "termin3");
    // nur `date` geschickt: dateTime bliebe stehen → Google lehnt ab
    await expect(
      googleApiRequest(
        endpoints,
        token,
        path,
        { method: "PATCH", body: { start: { date: "2026-10-21" }, end: { date: "2026-10-22" } } },
        deps,
      ),
    ).rejects.toMatchObject({ status: 400 });
    // so schickt es die App: dateTime ausdrücklich leer
    const allDay = await patchGoogleEvent(
      endpoints,
      token,
      FAKE_PRIMARY_ID,
      "termin3",
      null,
      { start: { date: "2026-10-21" }, end: { date: "2026-10-22" } },
      deps,
    );
    expect(allDay.start).toEqual({ date: "2026-10-21", timeZone: "Europe/Berlin" });
    expect(allDay.end).toEqual({ date: "2026-10-22", timeZone: "Europe/Berlin" });
    // und zurück auf eine Uhrzeit: date ausdrücklich leer
    const timed = await patchGoogleEvent(
      endpoints,
      token,
      FAKE_PRIMARY_ID,
      "termin3",
      null,
      {
        start: { dateTime: "2026-10-21T07:00:00.000Z", timeZone: "Europe/Berlin" },
        end: { dateTime: "2026-10-21T08:00:00.000Z", timeZone: "Europe/Berlin" },
      },
      deps,
    );
    expect(timed.start).toEqual({
      dateTime: "2026-10-21T07:00:00.000Z",
      timeZone: "Europe/Berlin",
    });
  });

  it("nur lesbarer Kalender: anlegen/ändern → 403; unbekannter Kalender → 404; ohne Token → 401", async () => {
    const token = await accessToken();
    await expect(
      googleApiRequest(
        endpoints,
        token,
        events(FAKE_READONLY_ID),
        {
          method: "POST",
          body: { start: { date: "2026-12-24" }, end: { date: "2026-12-25" } },
        },
        deps,
      ),
    ).rejects.toMatchObject({ status: 403, reason: "requiredAccessLevel" });
    await expect(
      googleApiRequest(endpoints, token, events("unbekannt@example.com"), {}, deps),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      googleApiRequest(endpoints, "ya29.falsch", events(FAKE_PRIMARY_ID), {}, deps),
    ).rejects.toMatchObject({ kind: "reconnect" });
  });

  it("move in einen nur lesbaren Kalender → 403; keine Pfade nach außen", async () => {
    const token = await accessToken();
    await control("seed", {
      calendarId: FAKE_PRIMARY_ID,
      events: [{ id: "termin3", start: { date: "2026-10-24" }, end: { date: "2026-10-25" } }],
    });
    await expect(
      googleApiRequest(
        endpoints,
        token,
        apiPath("calendars", FAKE_PRIMARY_ID, "events", "termin3", "move"),
        { method: "POST", query: { destination: FAKE_READONLY_ID } },
        deps,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(googleApiRequest(endpoints, token, "//evil.example/x", {}, deps)).rejects.toThrow(
      "Ungültiger API-Pfad.",
    );
    expect(apiPath("calendars", "a/b@x", "events")).toBe("/calendars/a%2Fb%40x/events");
  });
});
