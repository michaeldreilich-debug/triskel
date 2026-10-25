/**
 * Google Calendar API (#64) – nur im Server, nur mit einem Zugriffs-Token aus dieser Anfrage.
 * Alle Aufrufe gehen an die feste Basis (`googleEndpoints().api`); Kalender- und Termin-IDs werden
 * je Pfadteil kodiert, eine andere Adresse lässt sich so nicht bauen. N1a nutzt die
 * Kalenderliste; N1b–N1d bauen Termine auf `googleApiRequest` auf.
 */
import { z } from "zod";
import { googleCalendarColor } from "./colors";
import type { GoogleEndpoints } from "./config";
import { type FetchDeps, GOOGLE_TIMEOUT_MS, GoogleAuthError } from "./oauth";
import type { GoogleAccessRole, GoogleCalendarEntry } from "./types";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Googles Grund (z. B. `conditionNotMet`, `requiredAccessLevel`), wenn vorhanden */
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/**
 * Pfad aus Teilen, jeder Teil kodiert: `apiPath("calendars", id, "events")`. Leere Teile und „.“/„..“
 * sind verboten (G-3): `encodeURIComponent` lässt Punkte stehen, und der URL-Parser würde
 * `…/events/..` zu `…/calendars/<id>/` auflösen – ein anderer Endpunkt als gemeint.
 */
export function apiPath(...segments: string[]): string {
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error("Ungültiger API-Pfad.");
    }
  }
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export interface ApiRequest {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** etag für If-Match (Änderung nur, wenn der Termin unverändert ist) */
  ifMatch?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const reasonOf = (body: unknown): string | null => {
  const errors = (body as { error?: { errors?: Array<{ reason?: unknown }> } } | null)?.error
    ?.errors;
  const reason = errors?.[0]?.reason;
  return typeof reason === "string" ? reason : null;
};

/** Ein Aufruf der Calendar API; Fehler als GoogleApiError bzw. GoogleAuthError (401). */
export async function googleApiRequest(
  endpoints: GoogleEndpoints,
  accessToken: string,
  path: string,
  request: ApiRequest = {},
  deps: FetchDeps = {},
): Promise<ApiResponse> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Ungültiger API-Pfad.");
  const base = new URL(endpoints.api);
  const url = new URL(`${endpoints.api}${path}`);
  if (url.origin !== base.origin) throw new Error("Ungültiger API-Pfad.");
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  if (request.ifMatch) headers["if-match"] = request.ifMatch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? GOOGLE_TIMEOUT_MS);
  let response: Response;
  let text = "";
  try {
    response = await (deps.fetchImpl ?? fetch)(url, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    text = await response.text();
  } catch {
    throw new GoogleAuthError(
      "Google ist gerade nicht erreichbar – bitte später noch einmal.",
      "unavailable",
    );
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (response.status === 401) {
    throw new GoogleAuthError(
      "Google nimmt die Verbindung nicht mehr an – bitte neu verbinden.",
      "reconnect",
    );
  }
  if (response.status >= 400) {
    const reason = reasonOf(body);
    const message =
      response.status === 412
        ? "Der Termin wurde in Google inzwischen geändert."
        : response.status === 403
          ? "Google erlaubt das für diesen Kalender nicht."
          : response.status === 404 || response.status === 410
            ? "Google kennt diesen Kalender oder Termin nicht (mehr)."
            : `Google antwortet mit Status ${response.status}.`;
    throw new GoogleApiError(message, response.status, reason);
  }
  return { status: response.status, body };
}

const ROLES: readonly GoogleAccessRole[] = ["owner", "writer", "reader", "freeBusyReader"];

const ListEntrySchema = z.object({
  id: z.string().min(1).max(1024),
  summary: z.string().optional(),
  summaryOverride: z.string().optional(),
  backgroundColor: z.string().optional(),
  colorId: z.string().optional(),
  accessRole: z.string(),
  primary: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

const ListSchema = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
});

const MAX_PAGES = 10;

/** Kalenderliste (nur lesbare und beschreibbare, ohne ausgeblendete): primär, beschreibbar, Name. */
export async function listGoogleCalendars(
  endpoints: GoogleEndpoints,
  accessToken: string,
  deps: FetchDeps = {},
): Promise<GoogleCalendarEntry[]> {
  const entries: GoogleCalendarEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { body } = await googleApiRequest(
      endpoints,
      accessToken,
      apiPath("users", "me", "calendarList"),
      { query: { maxResults: "250", minAccessRole: "reader", pageToken } },
      deps,
    );
    const list = ListSchema.safeParse(body);
    if (!list.success) throw new GoogleApiError("Unerwartete Antwort von Google.", 502, null);
    for (const raw of list.data.items ?? []) {
      const item = ListEntrySchema.safeParse(raw);
      if (!item.success || item.data.deleted) continue;
      const role = (ROLES as readonly string[]).includes(item.data.accessRole)
        ? (item.data.accessRole as GoogleAccessRole)
        : "reader";
      const name = (item.data.summaryOverride || item.data.summary || item.data.id).trim();
      entries.push({
        id: item.data.id,
        name: name.slice(0, 200),
        color: googleCalendarColor(item.data),
        accessRole: role,
        primary: item.data.primary === true,
        writable: role === "owner" || role === "writer",
      });
    }
    pageToken = list.data.nextPageToken;
    if (!pageToken) break;
  }
  return entries.sort(
    (a, b) =>
      Number(b.primary) - Number(a.primary) ||
      Number(b.writable) - Number(a.writable) ||
      a.name.localeCompare(b.name, "de") ||
      a.id.localeCompare(b.id),
  );
}
