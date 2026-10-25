/**
 * Kalender serverseitig laden (S2a): nur die Route /api/kalender ruft das auf – mit der Sitzung
 * des Nutzers (RLS, aal2). Die geheime iCal-Adresse verlässt den Server nie: Sie steht in keiner
 * Antwort, keiner Fehlermeldung und keinem Log.
 *
 * - SSRF-Schutz: nur https://calendar.google.com/calendar/ical/… (in Entwicklung und Tests
 *   zusätzlich die Ursprünge aus CALENDAR_ALLOWED_ORIGINS, nie in Produktion), keine
 *   Weiterleitungen, keine Zugangsdaten in der Adresse.
 * - Kurzer Cache je Adresse (5 Minuten, im Speicher der Instanz), damit Woche/Monat/Heute nicht
 *   bei jedem Wechsel neu bei Google laden; „frisch“ umgeht ihn (Probe-Abruf).
 * - Zeitlimit 10 s, höchstens 5 MB.
 */
import { addDays, berlinDate, berlinTime, type IsoDate } from "@/lib/dates";
import { expandCalendar } from "../events";
import { calendarIdFromIcalUrl, GOOGLE_ICAL_ORIGIN } from "../google/match";
import { parseIcs } from "../ics";
import type {
  CalendarColor,
  CalendarEvent,
  CalendarProbe,
  CalendarRange,
  CalendarSourceStatus,
} from "../types";

export { GOOGLE_ICAL_ORIGIN };

const GOOGLE_ICAL_PATH = "/calendar/ical/";
export const CALENDAR_CACHE_MS = 5 * 60_000;
export const MAX_ICS_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
/** Höchstens so viele Tage je Abfrage (Monat + Rand; die Liste zeigt 14 Tage) */
export const MAX_RANGE_DAYS = 400;

export const URL_HINT =
  "Nur die geheime iCal-Adresse von Google (beginnt mit https://calendar.google.com/calendar/ical/).";

/** Erlaubte Ursprünge: Google, in Entwicklung/Tests zusätzlich die aus der Umgebung. */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra =
    env.NODE_ENV === "production"
      ? []
      : (env.CALENDAR_ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  return [GOOGLE_ICAL_ORIGIN, ...extra];
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Adresse prüfen – jeder Fehler ist eine feste Meldung ohne die Adresse selbst. */
export function checkCalendarUrl(value: string, origins: string[] = allowedOrigins()): UrlCheck {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: `Das ist keine gültige Adresse. ${URL_HINT}` };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Adressen mit Zugangsdaten sind nicht erlaubt." };
  }
  if (!origins.includes(url.origin)) return { ok: false, error: URL_HINT };
  if (url.origin === GOOGLE_ICAL_ORIGIN && !url.pathname.startsWith(GOOGLE_ICAL_PATH)) {
    return { ok: false, error: URL_HINT };
  }
  return { ok: true, url };
}

/** Kalender-ID (E-Mail) aus der Google-Adresse `/calendar/ical/<id>/private-…/basic.ics`. */
export function calendarIdFromUrl(url: URL): string | null {
  return calendarIdFromIcalUrl(url);
}

export class CalendarLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarLoadError";
  }
}

export interface LoadDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Cache umgehen */
  fresh?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const cache = new Map<string, { at: number; text: string }>();

export function clearCalendarCache(): void {
  cache.clear();
}

/** ICS-Text einer geprüften Adresse laden (mit Cache, Zeitlimit, Größenlimit). */
export async function fetchIcsText(url: URL, deps: LoadDeps = {}): Promise<string> {
  const now = deps.now ?? Date.now;
  const key = url.href;
  const cached = cache.get(key);
  if (cached && !deps.fresh && now() - cached.at < CALENDAR_CACHE_MS) return cached.text;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxBytes = deps.maxBytes ?? MAX_ICS_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "text/calendar, text/plain;q=0.5, */*;q=0.1" },
      cache: "no-store",
    });
  } catch (error) {
    clearTimeout(timer);
    if ((error as { name?: string } | null)?.name === "AbortError") {
      throw new CalendarLoadError("Google antwortet nicht (Zeitlimit 10 Sekunden).");
    }
    throw new CalendarLoadError("Kalender nicht erreichbar – Netzwerkfehler beim Abruf.");
  }
  try {
    if (response.status >= 300 && response.status < 400) {
      throw new CalendarLoadError("Die Adresse leitet weiter – das ist nicht die iCal-Adresse.");
    }
    if (response.status === 404) {
      throw new CalendarLoadError(
        "Google kennt diese Adresse nicht (404) – wurde die geheime Adresse zurückgesetzt?",
      );
    }
    if (!response.ok) {
      throw new CalendarLoadError(`Google antwortet mit Status ${response.status}.`);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new CalendarLoadError("Der Kalender ist zu groß (über 5 MB).");
    const text = await readLimited(response, maxBytes);
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new CalendarLoadError("Die Antwort ist kein Kalender (kein VCALENDAR).");
    }
    cache.set(key, { at: now(), text });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new CalendarLoadError("Der Kalender ist zu groß (über 5 MB).");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(all);
}

export interface LoadableSource {
  id: string;
  name: string;
  color: CalendarColor;
  url: string;
}

/** Termine einer Quelle im Zeitraum; Fehler landen im Status, nie als Ausnahme. */
export async function loadSourceEvents(
  source: LoadableSource,
  range: CalendarRange,
  deps: LoadDeps = {},
): Promise<{ events: CalendarEvent[]; status: CalendarSourceStatus }> {
  const status = (count: number, error: string | null): CalendarSourceStatus => ({
    id: source.id,
    name: source.name,
    color: source.color,
    count,
    error,
  });
  const check = checkCalendarUrl(source.url);
  if (!check.ok) return { events: [], status: status(0, check.error) };
  try {
    const text = await fetchIcsText(check.url, deps);
    const events = expandCalendar(parseIcs(text), range, {
      id: source.id,
      name: source.name,
      color: source.color,
      calendarId: calendarIdFromUrl(check.url),
    });
    return { events, status: status(events.length, null) };
  } catch (error) {
    const message =
      error instanceof CalendarLoadError ? error.message : "Der Kalender ließ sich nicht lesen.";
    return { events: [], status: status(0, message) };
  }
}

/** Zeitraum aus `von`/`bis` (Kalendertage); fehlt etwas oder ist es zu lang: null. */
export function parseRange(von: string | null, bis: string | null): CalendarRange | null {
  const ok = (v: string | null): v is IsoDate =>
    v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  if (!ok(von) || !ok(bis) || bis < von) return null;
  const limit = addDays(von, MAX_RANGE_DAYS - 1);
  return { start: von, end: bis > limit ? limit : bis };
}

/** Probe-Abruf aus den Einstellungen: Name, Anzahl der nächsten 30 Tage, die nächsten drei. */
export async function probeCalendar(
  value: string,
  deps: LoadDeps = {},
  now: Date = new Date(),
): Promise<CalendarProbe> {
  const fail = (error: string): CalendarProbe => ({
    ok: false,
    calendarName: null,
    count: 0,
    next: [],
    error,
  });
  const check = checkCalendarUrl(value);
  if (!check.ok) return fail(check.error);
  try {
    const text = await fetchIcsText(check.url, { ...deps, fresh: true });
    const calendar = parseIcs(text);
    const today = berlinDate(now);
    const events = expandCalendar(
      calendar,
      { start: today, end: addDays(today, 29) },
      { id: "probe", name: "", color: "blau", calendarId: null },
    );
    const nowIso = now.toISOString();
    const upcoming = events.filter((e) => e.end > nowIso || e.allDay);
    return {
      ok: true,
      calendarName: calendar.name,
      count: events.length,
      next: upcoming.slice(0, 3).map((e) => ({
        title: e.title,
        date: e.date,
        time: e.allDay ? null : berlinTime(e.start),
      })),
      error: null,
    };
  } catch (error) {
    return fail(
      error instanceof CalendarLoadError ? error.message : "Der Kalender ließ sich nicht lesen.",
    );
  }
}
