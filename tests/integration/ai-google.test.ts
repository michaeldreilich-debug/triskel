/**
 * KI-Werkzeuge für Google-Termine (#64, N1d) gegen das Testprojekt und den Google-Ersatz im
 * Testprozess (`fetch` auf die Ersatz-Adresse wird abgefangen, nichts geht an Google). Arbeitet
 * mit einem echten KI-Token (aal1 + `ai_client_allowed()`), sobald der OAuth-Server im
 * Testprojekt an ist – sonst mit der Sitzung von Testnutzer A. Prüft: nicht verbunden, Lesen,
 * Anlegen, Ändern (Zeit, Texte, Kalender), Konflikt, Serie, nur lesbar, Löschen mit Rückgängig-
 * Daten im KI-Protokoll, kein Token in Antworten und Protokoll.
 */
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { parseUndo } from "@/features/ai/activity";
import { saveGoogleAccount } from "@/features/calendar/google/access";
import { googleEndpoints } from "@/features/calendar/google/config";
import {
  FAKE_PRIMARY_ID,
  FAKE_READONLY_ID,
  handleFakeGoogle,
  resetFakeGoogle,
} from "@/features/calendar/google/fake";
import {
  buildAuthUrl,
  exchangeCode,
  pkceChallenge,
  randomToken,
} from "@/features/calendar/google/oauth";
import { addDays, berlinDate } from "@/lib/dates";
import { assertTestBackend } from "../guard";
import { connectAi } from "../support/mcp";
import { connectClient, oauthMetadata, revokeGrant } from "../support/oauth";
import { runMarker, userClient } from "../support/supabase-node";

const backend = assertTestBackend();
const meta = await oauthMetadata(backend);
const sessionA = inject("sessionA");
const app = userClient(sessionA);
const marker = runMarker();
const ORIGIN = "http://fake.test";
const KEY = Buffer.alloc(32, 7);
const env = {
  GOOGLE_CLIENT_ID: "e2e.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "e2e-geheim",
  GOOGLE_TOKEN_KEY: KEY.toString("base64"),
  GOOGLE_OAUTH_BASE: `${ORIGIN}/dev/google/oauth`,
  GOOGLE_API_BASE: `${ORIGIN}/dev/google/calendar/v3`,
};
const realFetch = globalThis.fetch;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(ORIGIN)) return realFetch(input, init);
  return handleFakeGoogle(new Request(url, init), { NODE_ENV: "test", ...env });
};
const control = async (path: string, body?: unknown) =>
  (await (
    await fakeFetch(`${ORIGIN}/dev/google/_test/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  ).json()) as Record<string, unknown>;
/** Termine im Ersatz anlegen; der Ersatz vergibt die IDs selbst. */
const seed = async (calendarId: string, events: unknown[]) =>
  ((await control("seed", { calendarId, events })).events as Array<{ id: string }>).map(
    (e) => e.id,
  );
const fakeState = async (calendar = FAKE_PRIMARY_ID) =>
  (await control(`state?calendar=${encodeURIComponent(calendar)}`)) as {
    ops: Array<{ op: string; eventId: string; sendUpdates: string | null; ifMatch: string | null }>;
    patches: Array<{ eventId: string; ifMatch: string | null; sendUpdates: string | null }>;
    items: Array<{ id: string; summary?: string; location?: string; start: { dateTime?: string } }>;
  };

/** Echte Anmeldung beim Ersatz → Refresh-Token (wie die App beim Verbinden). */
async function refreshTokenFromFake(): Promise<string> {
  const endpoints = googleEndpoints({ NODE_ENV: "test", ...env });
  const verifier = randomToken();
  const redirectUri = `${ORIGIN}/api/google/callback`;
  const auth = await fakeFetch(
    buildAuthUrl(endpoints, {
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri,
      state: randomToken(),
      challenge: pkceChallenge(verifier),
    }),
  );
  const code = new URL(auth.headers.get("location") as string).searchParams.get("code") as string;
  const tokens = await exchangeCode(
    endpoints,
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      code,
      verifier,
      redirectUri,
    },
    { fetchImpl: fakeFetch },
  );
  return tokens.refreshToken as string;
}

const clientId = `test-google-${marker}`;
const grants: string[] = [];
let ai: Awaited<ReturnType<typeof connectAi>>;
let aiDb = app;
let viaKiToken = false;
let refreshToken = "";

const today = berlinDate(new Date());
const day = addDays(today, 10);
const activity = async () =>
  (
    await app
      .from("ai_activity")
      .select("tool, entity, entity_id, summary, undo")
      .eq("client_id", viaKiToken ? (grants[0] ?? clientId) : clientId)
      .order("created_at")
  ).data ?? [];
const idsOf = (structured: Record<string, unknown> | undefined) => ({
  kalender: String(structured?.kalender ?? ""),
  termin: String(structured?.termin ?? ""),
});

beforeAll(async () => {
  vi.stubGlobal("fetch", fakeFetch);
  vi.stubEnv("NODE_ENV", "test");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetFakeGoogle();
  // kein Google-Konto: Ausgangslage „nicht verbunden“
  await app.from("google_accounts").delete().eq("user_id", sessionA.userId);
  refreshToken = await refreshTokenFromFake();

  let cid = clientId;
  if (meta) {
    const connected = await connectClient(backend, meta, sessionA.accessToken, {
      name: `${marker} KI-Google`,
      redirectUri: "http://localhost:3100/oauth-test-callback",
    });
    if (connected.tokens) {
      grants.push(connected.clientId);
      cid = connected.clientId;
      aiDb = userClient({ accessToken: connected.tokens.access_token });
      viaKiToken = true;
    }
  }
  ai = await connectAi({
    db: aiDb,
    userId: sessionA.userId,
    clientId: cid,
    origin: "https://app.test",
    now: () => new Date(),
  });
});

afterAll(async () => {
  await ai?.close();
  await app.from("google_accounts").delete().eq("user_id", sessionA.userId);
  if (grants.length > 0) {
    await app.from("ai_activity").delete().in("client_id", grants);
    for (const id of grants) await revokeGrant(backend, sessionA.accessToken, id);
    await app.from("ai_clients").delete().in("client_id", grants);
  } else {
    await app.from("ai_activity").delete().eq("client_id", clientId);
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => undefined);

describe("Google-Termine für die KI", () => {
  it("läuft mit echtem KI-Token (aal1) – sonst mit der App-Sitzung", () => {
    if (!meta) console.warn("OAuth-Server im Testprojekt aus – KI-Token nicht geprüft");
    expect(viaKiToken || !meta).toBe(true);
  });

  it("nicht verbunden: list_events sagt, was zu tun ist; Schreiben scheitert verständlich", async () => {
    const list = await ai.call("list_events");
    expect(list.isError).toBe(false);
    expect(list.text).toContain("Google ist nicht verbunden");
    expect(list.text).toContain("Einstellungen › Kalender");
    const create = await ai.call("create_event", { titel: "X", beginn: `${day} 10:00` });
    expect(create.isError).toBe(true);
    expect(create.text).toContain("Google ist nicht verbunden");
    expect(await activity()).toHaveLength(0);
  });

  it("verbunden: list_events zeigt Termine mit IDs, Kalender, Serie und änderbar; Zeitraum begrenzt", async () => {
    await saveGoogleAccount(
      app,
      sessionA.userId,
      { email: FAKE_PRIMARY_ID, refreshToken, scope: "s" },
      KEY,
    );
    [readId] = (await seed(FAKE_PRIMARY_ID, [
      {
        summary: `${marker} Lesen`,
        location: "Ort X",
        start: { dateTime: `${day}T08:00:00.000Z`, timeZone: "Europe/Berlin" },
        end: { dateTime: `${day}T09:00:00.000Z`, timeZone: "Europe/Berlin" },
      },
    ])) as [string];
    [holidayId] = (await seed(FAKE_READONLY_ID, [
      { summary: `${marker} Feiertag`, start: { date: day }, end: { date: addDays(day, 1) } },
    ])) as [string];
    const list = await ai.call("list_events", { von: day, bis: day });
    expect(list.isError, list.text).toBe(false);
    expect(list.text).toContain(`${marker} Lesen`);
    expect(list.text).toContain(`kalender: ${FAKE_PRIMARY_ID}, termin: ${readId}`);
    expect(list.text).toContain("änderbar");
    expect(list.text).toContain(`${marker} Feiertag`);
    expect(list.text).toContain("nur lesbar");
    expect(list.text).toContain("https://app.test/kalender?ansicht=woche&tag=");
    // kein Token, kein Refresh-Token in Antworten
    expect(list.text).not.toContain(refreshToken);
    expect(JSON.stringify(list.structured)).not.toMatch(/access_token|refresh/i);

    const only = await ai.call("list_events", { von: day, bis: day, kalender: "E2E-Feiertage" });
    expect(only.text).toContain(`${marker} Feiertag`);
    expect(only.text).not.toContain(`${marker} Lesen`);

    expect((await ai.call("list_events", { von: day, bis: addDays(day, 62) })).isError).toBe(true);
    expect((await ai.call("list_events", { von: day, bis: addDays(day, -1) })).isError).toBe(true);
    expect((await ai.call("list_events", { kalender: "gibt es nicht" })).text).toContain(
      "nicht gefunden",
    );
  });

  let created = { kalender: "", termin: "" };
  let readId = "";
  let holidayId = "";
  let seriesId = "";

  it("create_event: Hauptkalender, Berliner Zeit, ohne Benachrichtigung; Protokoll mit Rückgängig (löschen)", async () => {
    const result = await ai.call("create_event", {
      titel: `${marker} Zahnarzt`,
      beginn: `${day} 10:00`,
      dauer_min: 45,
      ort: "Praxis",
      beschreibung: "Karte mitnehmen",
    });
    expect(result.isError, result.text).toBe(false);
    created = idsOf(result.structured);
    expect(created.kalender).toBe(FAKE_PRIMARY_ID);
    expect(result.text).toContain("Im Kalender: https://app.test/kalender");
    const state = await fakeState();
    const item = state.items.find((e) => e.id === created.termin);
    expect(item?.summary).toBe(`${marker} Zahnarzt`);
    // 10:00 Berlin im Oktober/Dezember = 09:00/08:00 UTC; Dauer 45 min
    expect(new Date(item?.start.dateTime as string).getUTCMinutes()).toBe(0);
    const op = state.ops.find((o) => o.op === "insert" && o.eventId === created.termin);
    expect(op?.sendUpdates).toBe("none");

    const log = (await activity()).find((a) => a.tool === "create_event");
    expect(log).toMatchObject({ entity: "termin", entity_id: null });
    expect(log?.summary).toContain(`${marker} Zahnarzt`);
    expect(parseUndo(log?.undo)).toMatchObject({
      kind: "event_create",
      calendar_id: FAKE_PRIMARY_ID,
      event_id: created.termin,
      // Stand nach dem Anlegen: Rückgängig löscht nur, wenn seitdem unverändert (G-7)
      etag: (item as unknown as { etag: string }).etag,
      date: day,
    });
    expect(JSON.stringify(log)).not.toContain(refreshToken);
  });

  it("create_event: Eingabe prüfen (Uhrzeit fehlt, nur lesbarer Kalender, unbekannter Kalender)", async () => {
    expect((await ai.call("create_event", { titel: "A", beginn: day })).text).toContain("Uhrzeit");
    const readonly = await ai.call("create_event", {
      titel: "A",
      beginn: `${day} 10:00`,
      kalender: "E2E-Feiertage",
    });
    expect(readonly.isError).toBe(true);
    expect(readonly.text).toContain("nur lesbar");
    const allDay = await ai.call("create_event", {
      titel: `${marker} Ganztag`,
      beginn: day,
      ganztaegig: true,
      dauer_tage: 2,
    });
    expect(allDay.isError, allDay.text).toBe(false);
    expect(allDay.text).toContain(`${day} bis ${addDays(day, 1)} (ganztägig)`);
  });

  it("update_event: Zeit und Texte mit etag, Vorwerte im Protokoll; gleiche Werte ändern nichts", async () => {
    const result = await ai.call("update_event", {
      ...created,
      beginn: `${day} 14:30`,
      titel: `${marker} Zahnarzt neu`,
      ort: "",
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain("Zeit, Titel, Ort");
    const state = await fakeState();
    const patch = state.patches.find((p) => p.eventId === created.termin);
    expect(patch?.ifMatch).toBeTruthy();
    expect(patch?.sendUpdates).toBe("none");
    const item = state.items.find((e) => e.id === created.termin);
    expect(item?.summary).toBe(`${marker} Zahnarzt neu`);
    expect(item?.location ?? "").toBe("");

    const log = (await activity()).filter((a) => a.tool === "update_event").at(-1);
    const undo = parseUndo(log?.undo);
    expect(undo).toMatchObject({
      kind: "event_update",
      calendar_id: FAKE_PRIMARY_ID,
      event_id: created.termin,
      before: { summary: `${marker} Zahnarzt`, location: "Praxis" },
    });
    if (undo?.kind !== "event_update") throw new Error("falsche Art");
    // Dauer blieb bei 45 min, die alte Zeit steht zum Zurückschreiben bereit
    expect(undo.before.times).toMatchObject({ allDay: false, timeZone: "Europe/Berlin" });
    expect(undo.etag).toBeTruthy();

    const same = await ai.call("update_event", { ...created, titel: `${marker} Zahnarzt neu` });
    expect(same.text).toContain("Nichts geändert");
  });

  it("update_event: Konflikt (in Google geändert) → verständlicher Fehler, nichts überschrieben", async () => {
    // zwischen Lesen und Schreiben ändert Google den Termin: etag wechselt beim Lesen im Werkzeug nicht –
    // deshalb den Konflikt über eine Änderung genau dazwischen erzwingen
    const original = globalThis.fetch;
    let touched = false;
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as string, init);
      if (!touched && request.method === "PATCH") {
        touched = true;
        await control("touch", { calendarId: FAKE_PRIMARY_ID, eventId: created.termin });
      }
      return original(input, init);
    }) as typeof fetch);
    try {
      const result = await ai.call("update_event", { ...created, titel: `${marker} Konflikt` });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("inzwischen geändert");
      expect(result.text).toContain("list_events");
    } finally {
      vi.stubGlobal("fetch", original);
    }
    const item = (await fakeState()).items.find((e) => e.id === created.termin);
    expect(item?.summary).toBe(`${marker} Zahnarzt neu`);
  });

  it("update_event: Termin in anderen Kalender legen; nur lesbare Ziele und nur lesbare Termine abgelehnt", async () => {
    await control("add-calendar", {
      id: `${marker}-zweit@example.com`,
      summary: `${marker} Zweit`,
      accessRole: "writer",
    });
    const moved = await ai.call("update_event", {
      ...created,
      kalender_neu: `${marker} Zweit`,
      ort: "Neuer Ort",
    });
    expect(moved.isError, moved.text).toBe(false);
    expect(moved.structured?.kalender).toBe(`${marker}-zweit@example.com`);
    const log = (await activity()).filter((a) => a.tool === "update_event").at(-1);
    expect(parseUndo(log?.undo)).toMatchObject({
      kind: "event_update",
      calendar_id: `${marker}-zweit@example.com`,
      moved_from: FAKE_PRIMARY_ID,
      before: { location: "" },
    });
    created = { kalender: `${marker}-zweit@example.com`, termin: created.termin };

    const toReadonly = await ai.call("update_event", { ...created, kalender_neu: "E2E-Feiertage" });
    expect(toReadonly.text).toContain("nur lesbar");
    const readonlyEvent = await ai.call("update_event", {
      kalender: "E2E-Feiertage",
      termin: holidayId,
      titel: "X",
    });
    expect(readonlyEvent.isError).toBe(true);
    expect(readonlyEvent.text).toContain("nur lesbar");
  });

  it("Serie: Änderung trifft nur diesen Termin und sagt es; Verschieben in anderen Kalender abgelehnt", async () => {
    [seriesId] = (await seed(FAKE_PRIMARY_ID, [
      {
        recurringEventId: `${marker}serie`,
        summary: `${marker} Serie`,
        start: { dateTime: `${day}T07:00:00.000Z`, timeZone: "Europe/Berlin" },
        end: { dateTime: `${day}T08:00:00.000Z`, timeZone: "Europe/Berlin" },
      },
    ])) as [string];
    const result = await ai.call("update_event", {
      kalender: FAKE_PRIMARY_ID,
      termin: seriesId,
      ort: "Raum 1",
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain("nur dieser eine");
    const moved = await ai.call("update_event", {
      kalender: FAKE_PRIMARY_ID,
      termin: seriesId,
      kalender_neu: `${marker} Zweit`,
    });
    expect(moved.isError).toBe(true);
    expect(moved.text).toContain("Serie");
  });

  it("update_event: mit Uhrzeit → ganztägig und zurück (G-6)", async () => {
    const [switchId] = (await seed(FAKE_PRIMARY_ID, [
      {
        summary: `${marker} Umstellen`,
        start: { dateTime: `${addDays(day, 22)}T07:00:00.000Z`, timeZone: "Europe/Berlin" },
        end: { dateTime: `${addDays(day, 22)}T08:00:00.000Z`, timeZone: "Europe/Berlin" },
      },
    ])) as [string];
    const allDay = await ai.call("update_event", {
      kalender: FAKE_PRIMARY_ID,
      termin: switchId,
      ganztaegig: true,
    });
    expect(allDay.isError, allDay.text).toBe(false);
    const stored = (await fakeState()).items.find((e) => e.id === switchId) as {
      start: { date?: string; dateTime?: string };
    };
    expect(stored.start.date).toBe(addDays(day, 22));
    expect(stored.start.dateTime).toBeUndefined();
    const back = await ai.call("update_event", {
      kalender: FAKE_PRIMARY_ID,
      termin: switchId,
      ganztaegig: false,
      beginn: `${addDays(day, 22)} 10:00`,
    });
    expect(back.isError, back.text).toBe(false);
    const again = (await fakeState()).items.find((e) => e.id === switchId) as {
      start: { date?: string; dateTime?: string };
    };
    expect(again.start.date).toBeUndefined();
    expect(again.start.dateTime).toBeTruthy();
  });

  it("ganze Serie (Ursprungstermin mit Regel): ändern und löschen abgelehnt, nichts geschrieben (G-1)", async () => {
    const [masterId] = (await seed(FAKE_PRIMARY_ID, [
      {
        summary: `${marker} Serien-Ursprung`,
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        start: { dateTime: `${addDays(day, 20)}T07:00:00.000Z`, timeZone: "Europe/Berlin" },
        end: { dateTime: `${addDays(day, 20)}T08:00:00.000Z`, timeZone: "Europe/Berlin" },
      },
    ])) as [string];
    const before = await fakeState();
    const changed = await ai.call("update_event", {
      kalender: FAKE_PRIMARY_ID,
      termin: masterId,
      beginn: `${addDays(day, 21)} 09:00`,
    });
    expect(changed.isError).toBe(true);
    expect(changed.text).toContain("ganze Serie");
    const deleted = await ai.call("delete_event", { kalender: FAKE_PRIMARY_ID, termin: masterId });
    expect(deleted.isError).toBe(true);
    expect(deleted.text).toContain("ganze Serie");
    const after = await fakeState();
    expect(after.items.map((e) => e.id)).toContain(masterId);
    expect(after.patches.filter((p) => p.eventId === masterId)).toHaveLength(0);
    expect(after.ops.length).toBe(before.ops.length);
  });

  it("delete_event: destruktiv markiert, löscht, Protokoll hält den ganzen Termin zum Wiederherstellen", async () => {
    const { tools } = await ai.client.listTools();
    const tool = tools.find((t) => t.name === "delete_event");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toContain("erst nach seiner Bestätigung im Chat");

    const result = await ai.call("delete_event", created);
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain("Papierkorb");
    expect(result.text).toContain("Rückgängig");
    const left = (await fakeState(created.kalender)).items.map((e) => e.id);
    expect(left).not.toContain(created.termin);

    const log = (await activity()).find((a) => a.tool === "delete_event");
    const undo = parseUndo(log?.undo);
    expect(undo).toMatchObject({
      kind: "event_delete",
      calendar_id: created.kalender,
      event: {
        event_id: created.termin,
        summary: `${marker} Zahnarzt neu`,
        location: "Neuer Ort",
        description: "Karte mitnehmen",
        times: { allDay: false, timeZone: "Europe/Berlin" },
      },
    });
    // schon gelöscht → noch einmal löschen ist ein klarer Fehler
    const again = await ai.call("delete_event", created);
    expect(again.isError).toBe(true);
    expect(again.text).toContain("existiert in Google nicht");
  });

  it("Termine verknüpfen (#68): create_note mit termin, link_event, list_events nennt es, unlink_event mit Rückgängig-Daten", async () => {
    const [eventId] = (await seed(FAKE_PRIMARY_ID, [
      {
        summary: `${marker} Übungsdienst`,
        start: { dateTime: `${day}T17:00:00.000Z`, timeZone: "Europe/Berlin" },
        end: { dateTime: `${day}T19:00:00.000Z`, timeZone: "Europe/Berlin" },
      },
    ])) as [string];
    const termin = { kalender: FAKE_PRIMARY_ID, termin: eventId };
    const note = await ai.call("create_note", {
      titel: `${marker} Protokoll Übungsdienst`,
      typ: "protokoll",
      bereich: "Privat",
      inhalt: "- Teilnehmende",
      termin,
    });
    expect(note.isError, note.text).toBe(false);
    expect(note.text).toContain(`verknüpft mit Termin`);
    const noteId = String(note.structured?.id);
    const task = await ai.call("create_task", {
      titel: `${marker} Material prüfen`,
      bereich: "Privat",
    });
    const taskId = String(task.structured?.id);
    try {
      const linked = await ai.call("link_event", { ...termin, aufgabe: taskId });
      expect(linked.isError, linked.text).toBe(false);
      expect(linked.text).toContain("Verknüpft");
      // doppelt: nichts Neues
      expect((await ai.call("link_event", { ...termin, aufgabe: taskId })).text).toContain(
        "Schon verknüpft",
      );
      const rows =
        (
          await app
            .from("event_links")
            .select("id, task_id, note_id, event_title, scope, deleted_at")
            .eq("event_id", eventId)
            // der Ersatz vergibt IDs nach jedem reset neu – nur die Zeilen dieses Laufs
            .or(`task_id.eq.${taskId},note_id.eq.${noteId}`)
        ).data ?? [];
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.event_title === `${marker} Übungsdienst` && !r.deleted_at)).toBe(
        true,
      );
      // Serie nur bei Serien
      const series = await ai.call("link_event", { ...termin, serie: true, notiz: noteId });
      expect(series.isError).toBe(true);
      expect(series.text).toContain("keiner Serie");

      const list = await ai.call("list_events", { von: day, bis: day });
      expect(list.text).toMatch(
        new RegExp(`termin: ${eventId}\\) · verknüpft: Notiz .*${marker} Protokoll`),
      );
      expect(list.text).toContain(`${marker} Material prüfen`);
      const fetched = await ai.call("fetch", { id: noteId, bilder: false });
      expect(fetched.text).toContain(`${marker} Übungsdienst`);
      // Uhrzeit in Europe/Berlin (je nach Tag Sommer- oder Winterzeit)
      expect(fetched.text).toMatch(
        new RegExp(`termin: ".+ \\d\\d:\\d\\d–\\d\\d:\\d\\d · ${marker} Übungsdienst"`),
      );

      const unlinked = await ai.call("unlink_event", { termin: eventId, aufgabe: taskId });
      expect(unlinked.isError, unlinked.text).toBe(false);
      const taskLink = rows.find((r) => r.task_id === taskId);
      const after = (
        await app
          .from("event_links")
          .select("deleted_at")
          .eq("id", taskLink?.id as string)
          .single()
      ).data;
      expect(after?.deleted_at).toBeTruthy();
      const log = (await activity()).filter(
        (a) => a.tool === "unlink_event" || a.tool === "link_event",
      );
      expect(parseUndo(log.at(-1)?.undo)).toEqual({
        kind: "trash",
        table: "event_links",
        id: taskLink?.id,
      });
      expect(parseUndo(log.find((a) => a.tool === "link_event")?.undo)).toMatchObject({
        kind: "update",
        table: "event_links",
      });
      // die Aufgabe selbst bleibt
      expect(
        (await app.from("tasks").select("deleted_at").eq("id", taskId).single()).data?.deleted_at,
      ).toBeNull();
    } finally {
      // auch wenn eine Prüfung scheitert: Reste mit „it-“ fänden sonst andere Tests (Suche)
      await app.from("notes").delete().eq("id", noteId);
      await app.from("tasks").delete().eq("id", taskId);
    }
  });

  it("Zugang in Google widerrufen → Hinweis zum Neu-Verbinden", async () => {
    await control("revoke-all", {});
    const result = await ai.call("update_event", {
      kalender: FAKE_PRIMARY_ID,
      termin: readId,
      titel: "Y",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("neu verbinden");
    const list = await ai.call("list_events");
    expect(list.text).toContain("neu verbinden");
  });
});
