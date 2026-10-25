/**
 * Google-Ersatz für Tests (#64, N1a) – bedient `/dev/google/*` (in Produktion 404, wie `/dev/ics`).
 * Die Server-Routen sprechen ihn nur an, wenn `NODE_ENV=test` und `GOOGLE_OAUTH_BASE`/
 * `GOOGLE_API_BASE` darauf zeigen (playwright.config.ts). Kein echtes Google, keine echten
 * Zugangsdaten: Client-ID und -Schlüssel prüft er gegen die Test-Werte aus der Umgebung.
 *
 * Nachgebildet (so weit die App es braucht):
 * - OAuth: `oauth/auth` (sofort zurück mit Code; Rücksprung nur `/api/google/callback` des eigenen
 *   Ursprungs), `oauth/token` (Code-Tausch mit PKCE-Prüfung S256, Refresh), `oauth/revoke`.
 * - Calendar API v3: `users/me/calendarList` (primärer Kalender + ein nur lesbarer),
 *   `calendars/<id>/events` (list mit timeMin/timeMax, insert), `…/events/<id>` (get, patch mit
 *   If-Match → 412, delete), `…/events/<id>/move?destination=` – mit etag, 401 ohne gültigen
 *   Zugriffs-Token, 403 beim nur lesbaren Kalender. Gelöschtes bleibt wie in Google im Papierkorb:
 *   `get` → 410, `patch` mit `status: "confirmed"` holt es zurück (N1c), jeder andere Zugriff → 410.
 * - Steuerung für Tests unter `_test/`: `reset`, `revoke-all` (Zugang in Google entfernt),
 *   `next` ({ deny } oder { scope } für die nächste Anmeldung), `add-calendar` ({ id, summary,
 *   accessRole: writer|reader } – zusätzlicher Kalender bis zum nächsten `reset`), `purge-trash`
 *   (Papierkorb leeren), `seed` (Termine anlegen oder
 *   ersetzen, ohne die anderer Tests zu löschen), `touch` (etag ändern = in Google geändert),
 *   `state` (Zähler zum Prüfen, nie Tokens; mit `?calendar=<id>` auch die Termine, dazu `patches`:
 *   jeder events.patch mit If-Match, sendUpdates und Feldern).
 * Zustand im Speicher des Testservers (`globalThis`, übersteht Neuladen des Moduls).
 */
import { createHash } from "node:crypto";
import { berlinDateTime } from "@/lib/dates";

export const FAKE_PRIMARY_ID = "e2e-alex@example.com";
export const FAKE_READONLY_ID = "e2e-feiertage@group.v.calendar.google.com";
const REQUIRED_CALLBACK = "/api/google/callback";
const ACCESS_TTL_S = 3599;

interface FakeCalendar {
  id: string;
  summary: string;
  accessRole: "owner" | "writer" | "reader";
  primary: boolean;
  colorId: string;
}

interface EventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface FakeEvent {
  id: string;
  etag: string;
  status: "confirmed";
  summary?: string;
  description?: string;
  location?: string;
  start: EventTime;
  end: EventTime;
  transparency?: string;
  recurringEventId?: string;
  /** Ursprungstermin einer Serie (Wiederholungsregel) – nur zum Prüfen per `seed` (G-1) */
  recurrence?: string[];
  originalStartTime?: EventTime;
  organizer: { email: string; self?: boolean };
  created: string;
  updated: string;
  htmlLink: string;
  iCalUID: string;
}

interface FakeState {
  seq: number;
  codes: Map<
    string,
    { challenge: string; redirectUri: string; scope: string; offline: boolean; expires: number }
  >;
  refresh: Map<string, { scope: string; revoked: boolean }>;
  access: Map<string, { refresh: string | null; expires: number }>;
  calendars: FakeCalendar[];
  events: Map<string, Map<string, FakeEvent>>;
  /** gelöschte Termine (Googles Papierkorb): holt `patch` mit status "confirmed" zurück (N1c) */
  deleted: Map<string, FakeEvent>;
  next: { deny?: boolean; scope?: string };
  revokeCalls: number;
  /** jeder insert, delete, move und jede Wiederherstellung (N1c): Aufruf, Kalender, Termin, sendUpdates */
  ops: Array<{
    op: "insert" | "delete" | "move" | "restore";
    calendarId: string;
    eventId: string;
    ifMatch: string | null;
    sendUpdates: string | null;
    destination?: string;
  }>;
  /** jeder events.patch: wofür, mit welchem If-Match, sendUpdates und welchen Feldern (N1b) */
  patches: Array<{
    calendarId: string;
    eventId: string;
    ifMatch: string | null;
    sendUpdates: string | null;
    fields: string[];
    start?: EventTime;
    end?: EventTime;
  }>;
}

const defaultCalendars = (): FakeCalendar[] => [
  {
    id: FAKE_PRIMARY_ID,
    summary: "E2E-Hauptkalender",
    accessRole: "owner",
    primary: true,
    colorId: "16",
  },
  {
    id: FAKE_READONLY_ID,
    summary: "E2E-Feiertage",
    accessRole: "reader",
    primary: false,
    colorId: "7",
  },
];

function freshState(): FakeState {
  return {
    seq: 1,
    codes: new Map(),
    refresh: new Map(),
    access: new Map(),
    calendars: defaultCalendars(),
    events: new Map(),
    deleted: new Map(),
    next: {},
    revokeCalls: 0,
    patches: [],
    ops: [],
  };
}

const KEY = "__szFakeGoogle";
type Global = typeof globalThis & { [KEY]?: FakeState };

function state(): FakeState {
  const g = globalThis as Global;
  g[KEY] ??= freshState();
  return g[KEY];
}

export function resetFakeGoogle(): void {
  (globalThis as Global)[KEY] = freshState();
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

const apiError = (code: number, message: string, reason: string) =>
  json({ error: { code, message, errors: [{ reason, message }] } }, code);

const token = (prefix: string) => {
  const s = state();
  s.seq += 1;
  return `${prefix}-${s.seq}-${createHash("sha256").update(`${prefix}${s.seq}${Date.now()}`).digest("base64url").slice(0, 16)}`;
};

const pkce = (verifier: string) =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

const clientOk = (form: URLSearchParams, env: Env) =>
  form.get("client_id") === (env.GOOGLE_CLIENT_ID ?? "").trim() &&
  form.get("client_secret") === (env.GOOGLE_CLIENT_SECRET ?? "").trim();

type Env = Record<string, string | undefined>;

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

function authorize(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const p = url.searchParams;
  const redirectUri = p.get("redirect_uri") ?? "";
  const expected = new URL(REQUIRED_CALLBACK, url.origin).href;
  const problems = [
    p.get("client_id") !== (env.GOOGLE_CLIENT_ID ?? "").trim() && "client_id",
    redirectUri !== expected && "redirect_uri_mismatch",
    p.get("response_type") !== "code" && "response_type",
    p.get("code_challenge_method") !== "S256" && "code_challenge_method",
    (p.get("code_challenge") ?? "").length !== 43 && "code_challenge",
    !p.get("state") && "state",
    !p.get("scope") && "scope",
    p.has("client_secret") && "client_secret_in_url",
  ].filter(Boolean);
  if (problems.length > 0) {
    return new Response(`Fehler 400: invalid_request (${problems.join(", ")})`, {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const s = state();
  const back = new URL(redirectUri);
  back.searchParams.set("state", p.get("state") ?? "");
  if (s.next.deny) {
    s.next = {};
    back.searchParams.set("error", "access_denied");
    return Response.redirect(back.href, 302);
  }
  const scope = s.next.scope ?? p.get("scope") ?? "";
  s.next = {};
  const code = token("code");
  s.codes.set(code, {
    challenge: p.get("code_challenge") ?? "",
    redirectUri,
    scope,
    offline: p.get("access_type") === "offline",
    expires: Date.now() + 5 * 60_000,
  });
  back.searchParams.set("code", code);
  back.searchParams.set("scope", scope);
  return Response.redirect(back.href, 302);
}

function issueAccess(refresh: string | null, scope: string) {
  const access = token("ya29");
  state().access.set(access, { refresh, expires: Date.now() + ACCESS_TTL_S * 1000 });
  return { access_token: access, expires_in: ACCESS_TTL_S, scope, token_type: "Bearer" };
}

async function tokenEndpoint(request: Request, env: Env): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  if (!clientOk(form, env)) {
    return json(
      { error: "invalid_client", error_description: "The OAuth client was not found." },
      401,
    );
  }
  const s = state();
  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = s.codes.get(form.get("code") ?? "");
    s.codes.delete(form.get("code") ?? "");
    if (!code || code.expires < Date.now() || code.redirectUri !== form.get("redirect_uri")) {
      return json({ error: "invalid_grant", error_description: "Bad Request" }, 400);
    }
    if (pkce(form.get("code_verifier") ?? "") !== code.challenge) {
      return json({ error: "invalid_grant", error_description: "Invalid code verifier." }, 400);
    }
    const refresh = code.offline ? token("1//refresh") : null;
    if (refresh) s.refresh.set(refresh, { scope: code.scope, revoked: false });
    return json({
      ...issueAccess(refresh, code.scope),
      ...(refresh ? { refresh_token: refresh } : {}),
    });
  }
  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token") ?? "";
    const known = s.refresh.get(refresh);
    if (!known || known.revoked) {
      return json(
        { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        400,
      );
    }
    return json(issueAccess(refresh, known.scope));
  }
  return json({ error: "unsupported_grant_type" }, 400);
}

async function revokeEndpoint(request: Request): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const value = form.get("token") ?? "";
  const s = state();
  s.revokeCalls += 1;
  const refresh = s.refresh.has(value) ? value : (s.access.get(value)?.refresh ?? null);
  if (!refresh && !s.access.has(value)) return json({ error: "invalid_token" }, 400);
  if (refresh) {
    const entry = s.refresh.get(refresh);
    if (entry) entry.revoked = true;
    for (const [access, info] of s.access) if (info.refresh === refresh) s.access.delete(access);
  }
  s.access.delete(value);
  return json({});
}

/* ------------------------------------------------------------------ */
/* Calendar API                                                        */
/* ------------------------------------------------------------------ */

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const value = header.startsWith("Bearer ") ? header.slice(7) : "";
  const s = state();
  const info = s.access.get(value);
  if (!info || info.expires < Date.now()) return false;
  return !info.refresh || s.refresh.get(info.refresh)?.revoked === false;
}

/** Zeitpunkt eines Termins (ms); ganztägig = Mitternacht Europe/Berlin. */
function instant(time: EventTime): number {
  if (time.dateTime) return Date.parse(time.dateTime);
  if (time.date) return Date.parse(berlinDateTime(time.date, "00:00"));
  return Number.NaN;
}

const calendarOf = (id: string) => state().calendars.find((c) => c.id === id);
const writable = (calendar: FakeCalendar) => calendar.accessRole !== "reader";
const eventsOf = (calendarId: string) => {
  const s = state();
  let map = s.events.get(calendarId);
  if (!map) {
    map = new Map();
    s.events.set(calendarId, map);
  }
  return map;
};
const nextEtag = () => {
  const s = state();
  s.seq += 1;
  return `"${Date.now()}${String(s.seq).padStart(6, "0")}"`;
};

interface EventInput {
  id?: unknown;
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  start?: unknown;
  end?: unknown;
  transparency?: unknown;
  recurringEventId?: unknown;
  recurrence?: unknown;
  originalStartTime?: unknown;
  organizer?: unknown;
  status?: unknown;
}

const isTime = (value: unknown): value is EventTime =>
  typeof value === "object" &&
  value !== null &&
  (typeof (value as EventTime).dateTime === "string" ||
    typeof (value as EventTime).date === "string");

/**
 * Zeitfeld bei `patch` wie in Google zusammenführen (G-6): Angegebene Teile ersetzen, `null`
 * löscht, der Rest bleibt. Stehen danach `date` und `dateTime` nebeneinander → ungültig (null).
 */
function mergeTime(old: EventTime, input: unknown): EventTime | null {
  if (typeof input !== "object" || input === null) return null;
  const merged: Record<string, unknown> = { ...old, ...(input as Record<string, unknown>) };
  for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key];
  if (typeof merged.date === "string" && typeof merged.dateTime === "string") return null;
  return isTime(merged) ? (merged as EventTime) : null;
}

function buildEvent(calendarId: string, input: EventInput, now: string): FakeEvent | null {
  if (!isTime(input.start) || !isTime(input.end)) return null;
  const s = state();
  s.seq += 1;
  const id =
    typeof input.id === "string" && /^[a-v0-9]{5,1024}$/.test(input.id) ? input.id : `evt${s.seq}`;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const organizer =
    typeof input.organizer === "object" && input.organizer !== null
      ? (input.organizer as { email: string; self?: boolean })
      : { email: calendarId, self: true };
  return {
    id,
    etag: nextEtag(),
    status: "confirmed",
    summary: str(input.summary),
    description: str(input.description),
    location: str(input.location),
    start: input.start,
    end: input.end,
    transparency: str(input.transparency),
    recurringEventId: str(input.recurringEventId),
    recurrence:
      Array.isArray(input.recurrence) && input.recurrence.every((r) => typeof r === "string")
        ? (input.recurrence as string[])
        : undefined,
    originalStartTime: isTime(input.originalStartTime) ? input.originalStartTime : undefined,
    organizer,
    created: now,
    updated: now,
    htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
    iCalUID: `${id}@google.com`,
  };
}

async function readJson(request: Request): Promise<EventInput | null> {
  try {
    const body = (await request.json()) as unknown;
    return typeof body === "object" && body !== null ? (body as EventInput) : null;
  } catch {
    return null;
  }
}

async function eventsCollection(request: Request, calendarId: string): Promise<Response> {
  const calendar = calendarOf(calendarId);
  if (!calendar) return apiError(404, "Not Found", "notFound");
  const map = eventsOf(calendarId);
  if (request.method === "GET") {
    const p = new URL(request.url).searchParams;
    const min = p.get("timeMin")
      ? Date.parse(p.get("timeMin") as string)
      : Number.NEGATIVE_INFINITY;
    const max = p.get("timeMax")
      ? Date.parse(p.get("timeMax") as string)
      : Number.POSITIVE_INFINITY;
    const items = [...map.values()]
      .filter((e) => instant(e.start) < max && instant(e.end) > min)
      .sort((a, b) => instant(a.start) - instant(b.start) || a.id.localeCompare(b.id));
    return json({
      kind: "calendar#events",
      etag: nextEtag(),
      summary: calendar.summary,
      timeZone: "Europe/Berlin",
      accessRole: calendar.accessRole,
      items,
    });
  }
  if (request.method === "POST") {
    if (!writable(calendar)) return apiError(403, "Forbidden", "requiredAccessLevel");
    const input = await readJson(request);
    const event = input ? buildEvent(calendarId, input, new Date().toISOString()) : null;
    if (!event) return apiError(400, "Missing start or end time.", "required");
    map.set(event.id, event);
    state().ops.push({
      op: "insert",
      calendarId,
      eventId: event.id,
      ifMatch: null,
      sendUpdates: new URL(request.url).searchParams.get("sendUpdates"),
    });
    return json(event);
  }
  return apiError(405, "Method Not Allowed", "methodNotAllowed");
}

async function eventResource(
  request: Request,
  calendarId: string,
  eventId: string,
  action: string | undefined,
): Promise<Response> {
  const calendar = calendarOf(calendarId);
  if (!calendar) return apiError(404, "Not Found", "notFound");
  const map = eventsOf(calendarId);
  const event = map.get(eventId);
  const s = state();
  if (!event) {
    const trashed = s.deleted.get(`${calendarId}/${eventId}`);
    if (!trashed) return apiError(404, "Not Found", "notFound");
    // Papierkorb: nur `patch` mit status "confirmed" holt den Termin zurück, sonst 410
    if (request.method === "PATCH" && !action && writable(calendar)) {
      const input = await readJson(request);
      if (input && input.status === "confirmed") {
        const restored = { ...trashed, etag: nextEtag(), updated: new Date().toISOString() };
        map.set(eventId, restored);
        s.deleted.delete(`${calendarId}/${eventId}`);
        s.ops.push({
          op: "restore",
          calendarId,
          eventId,
          ifMatch: request.headers.get("if-match"),
          sendUpdates: new URL(request.url).searchParams.get("sendUpdates"),
        });
        return json(restored);
      }
    }
    return apiError(410, "Resource has been deleted", "deleted");
  }
  if (request.method === "GET" && !action) return json(event);
  if (!writable(calendar)) return apiError(403, "Forbidden", "requiredAccessLevel");
  const ifMatch = request.headers.get("if-match");
  if (ifMatch && ifMatch !== "*" && ifMatch !== event.etag) {
    return apiError(412, "Precondition Failed", "conditionNotMet");
  }
  if (request.method === "POST" && action === "move") {
    const destination = calendarOf(new URL(request.url).searchParams.get("destination") ?? "");
    if (!destination) return apiError(404, "Not Found", "notFound");
    if (!writable(destination)) return apiError(403, "Forbidden", "requiredAccessLevel");
    map.delete(eventId);
    const moved = { ...event, etag: nextEtag(), updated: new Date().toISOString() };
    eventsOf(destination.id).set(eventId, moved);
    s.ops.push({
      op: "move",
      calendarId,
      eventId,
      ifMatch,
      sendUpdates: new URL(request.url).searchParams.get("sendUpdates"),
      destination: destination.id,
    });
    return json(moved);
  }
  if (request.method === "PATCH" && !action) {
    const input = await readJson(request);
    if (!input) return apiError(400, "Bad Request", "badRequest");
    s.patches.push({
      calendarId,
      eventId,
      ifMatch,
      sendUpdates: new URL(request.url).searchParams.get("sendUpdates"),
      fields: Object.keys(input).sort(),
      start: isTime(input.start) ? input.start : undefined,
      end: isTime(input.end) ? input.end : undefined,
    });
    const patch: Partial<FakeEvent> = {};
    for (const key of ["summary", "description", "location", "transparency"] as const) {
      if (key in input)
        patch[key] = typeof input[key] === "string" ? (input[key] as string) : undefined;
    }
    if ("start" in input) {
      const start = mergeTime(event.start, input.start);
      if (!start) return apiError(400, "Invalid start time.", "invalid");
      patch.start = start;
    }
    if ("end" in input) {
      const end = mergeTime(event.end, input.end);
      if (!end) return apiError(400, "Invalid end time.", "invalid");
      patch.end = end;
    }
    const next = { ...event, ...patch, etag: nextEtag(), updated: new Date().toISOString() };
    if (instant(next.end) < instant(next.start)) {
      return apiError(400, "The specified time range is empty.", "timeRangeEmpty");
    }
    map.set(eventId, next);
    return json(next);
  }
  if (request.method === "DELETE" && !action) {
    map.delete(eventId);
    s.deleted.set(`${calendarId}/${eventId}`, event);
    s.ops.push({
      op: "delete",
      calendarId,
      eventId,
      ifMatch,
      sendUpdates: new URL(request.url).searchParams.get("sendUpdates"),
    });
    return new Response(null, { status: 204 });
  }
  return apiError(405, "Method Not Allowed", "methodNotAllowed");
}

/* ------------------------------------------------------------------ */
/* Steuerung für Tests                                                 */
/* ------------------------------------------------------------------ */

async function control(request: Request, action: string): Promise<Response> {
  const s = state();
  const body =
    request.method === "POST"
      ? ((await readJson(request)) as Record<string, unknown> | null)
      : null;
  switch (action) {
    case "reset":
      resetFakeGoogle();
      return json({ ok: true });
    case "revoke-all":
      for (const entry of s.refresh.values()) entry.revoked = true;
      s.access.clear();
      return json({ ok: true });
    case "next":
      s.next = {
        deny: body?.deny === true,
        scope: typeof body?.scope === "string" ? body.scope : undefined,
      };
      return json({ ok: true });
    case "seed": {
      const calendarId = typeof body?.calendarId === "string" ? body.calendarId : "";
      if (!calendarOf(calendarId) || !Array.isArray(body?.events)) {
        return json({ error: "calendarId und events nötig" }, 400);
      }
      const now = new Date().toISOString();
      const created = [];
      for (const raw of body.events as EventInput[]) {
        const event = buildEvent(calendarId, raw, now);
        if (!event) return json({ error: "Termin ohne start/end" }, 400);
        eventsOf(calendarId).set(event.id, event);
        s.deleted.delete(`${calendarId}/${event.id}`);
        created.push(event);
      }
      return json({ events: created });
    }
    case "add-calendar": {
      // zweiter Kalender für Tests (z. B. Kalender wechseln): überlebt `reset` nicht
      const id = typeof body?.id === "string" ? body.id : "";
      const role = body?.accessRole === "reader" ? "reader" : "writer";
      if (!id || calendarOf(id)) return json({ error: "id fehlt oder gibt es schon" }, 400);
      s.calendars.push({
        id,
        summary: typeof body?.summary === "string" ? body.summary : id,
        accessRole: role,
        primary: false,
        colorId: "9",
      });
      return json({ ok: true });
    }
    case "purge-trash":
      // Google hat Gelöschtes nicht mehr (Papierkorb geleert): Wiederherstellen muss neu anlegen
      s.deleted.clear();
      return json({ ok: true });
    case "touch": {
      const calendarId = typeof body?.calendarId === "string" ? body.calendarId : "";
      const eventId = typeof body?.eventId === "string" ? body.eventId : "";
      const event = eventsOf(calendarId).get(eventId);
      if (!event) return json({ error: "unbekannter Termin" }, 404);
      const touched = { ...event, etag: nextEtag(), updated: new Date().toISOString() };
      eventsOf(calendarId).set(eventId, touched);
      return json(touched);
    }
    case "state": {
      // ?calendar=<id>: zusätzlich die Termine dieses Kalenders (Zeiten, etag) zum Prüfen
      const calendar = new URL(request.url).searchParams.get("calendar");
      return json({
        patches: s.patches,
        ops: s.ops,
        trash: [...s.deleted.keys()],
        ...(calendar
          ? {
              items: [...eventsOf(calendar).values()].map((e) => ({
                id: e.id,
                etag: e.etag,
                summary: e.summary,
                location: e.location,
                description: e.description,
                start: e.start,
                end: e.end,
              })),
            }
          : {}),
        refreshTokens: {
          live: [...s.refresh.values()].filter((r) => !r.revoked).length,
          revoked: [...s.refresh.values()].filter((r) => r.revoked).length,
        },
        revokeCalls: s.revokeCalls,
        events: Object.fromEntries([...s.events].map(([id, map]) => [id, map.size])),
      });
    }
    default:
      return json({ error: "unbekannt" }, 404);
  }
}

/** Einstieg für die Route `/dev/google/[...path]`. */
export async function handleFakeGoogle(
  request: Request,
  env: Env = process.env,
): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/dev\/google\/?/, "");
  let segments: string[];
  try {
    segments = path
      .split("/")
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));
  } catch {
    return json({ error: "ungültiger Pfad" }, 400);
  }
  const [a, b, c, d, e, f, g, h] = segments;
  const method = request.method;

  if (a === "_test" && b) return control(request, b);
  if (a === "oauth") {
    if (b === "auth" && method === "GET") return authorize(request, env);
    if (b === "token" && method === "POST") return tokenEndpoint(request, env);
    if (b === "revoke" && method === "POST") return revokeEndpoint(request);
    return json({ error: "not_found" }, 404);
  }
  if (a === "calendar" && b === "v3") {
    if (!authorized(request)) {
      return json(
        { error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } },
        401,
      );
    }
    if (c === "users" && d === "me" && e === "calendarList" && !f && method === "GET") {
      return json({
        kind: "calendar#calendarList",
        items: state().calendars.map((cal) => ({
          kind: "calendar#calendarListEntry",
          id: cal.id,
          summary: cal.summary,
          colorId: cal.colorId,
          accessRole: cal.accessRole,
          ...(cal.primary ? { primary: true } : {}),
        })),
      });
    }
    if (c === "calendars" && d && e === "events") {
      if (!f) return eventsCollection(request, d);
      if (!h) return eventResource(request, d, f, g);
    }
  }
  return apiError(404, "Not Found", "notFound");
}
