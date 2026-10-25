/**
 * Zugang der KI-Werkzeuge zu Google Kalender (#64, N1d). Der Server liest den verschlüsselten
 * Token aus `google_accounts` mit dem Supabase-Client der KI (`aal1` + `ai_client_allowed()`,
 * Migration 36 – nur lesend), holt einen Zugriffs-Token für diesen Aufruf und die Kalenderliste
 * von Google. `calendar_sources` (geheime iCal-Adressen) bleibt für die KI unsichtbar: Kalender
 * kommen immer aus Googles Kalenderliste. Kein Token in Antworten oder im Protokoll.
 */
import { getGoogleAccess } from "@/features/calendar/google/access";
import { GoogleApiError, listGoogleCalendars } from "@/features/calendar/google/calendar-api";
import { GoogleAuthError } from "@/features/calendar/google/oauth";
import type { GoogleCalendarEntry } from "@/features/calendar/google/types";
import type { ConnectedAccess } from "@/features/calendar/server/event-service";
import type { AiContext } from "./context";
import { ToolInputError } from "./resolve";

export const NOT_CONNECTED =
  "Google ist nicht verbunden – in der App unter Einstellungen › Kalender verbinden.";

/** Weder verbunden noch erreichbar: der Grund als Text für die KI (nie ein Token). */
export class GoogleUnavailable extends Error {
  constructor(
    message: string,
    readonly state: "not-configured" | "disconnected" | "reconnect" | "unavailable",
  ) {
    super(message);
    this.name = "GoogleUnavailable";
  }
}

export interface OpenGoogle {
  access: ConnectedAccess;
  calendars: GoogleCalendarEntry[];
}

/** Zugang + Kalenderliste – oder `GoogleUnavailable` mit verständlichem Text. */
export async function openGoogle(ctx: AiContext): Promise<OpenGoogle> {
  let access: Awaited<ReturnType<typeof getGoogleAccess>>;
  try {
    access = await getGoogleAccess(ctx.db, ctx.userId);
  } catch {
    throw new GoogleUnavailable("Das Google-Konto ließ sich nicht laden.", "unavailable");
  }
  switch (access.state) {
    case "disconnected":
      throw new GoogleUnavailable(NOT_CONNECTED, "disconnected");
    case "not-configured":
      throw new GoogleUnavailable(
        `Google ist in der App nicht eingerichtet (${access.error}) – siehe README, Abschnitt Google-Zugang.`,
        "not-configured",
      );
    case "reconnect":
      throw new GoogleUnavailable(
        `${access.error} In der App unter Einstellungen › Kalender neu verbinden.`,
        "reconnect",
      );
    case "unavailable":
      throw new GoogleUnavailable(access.error, "unavailable");
  }
  const connected: ConnectedAccess = {
    endpoints: access.endpoints,
    accessToken: access.accessToken,
  };
  try {
    const calendars = await listGoogleCalendars(connected.endpoints, connected.accessToken);
    return { access: connected, calendars };
  } catch (caught) {
    throw asToolError(caught);
  }
}

const RECONNECT =
  "Google nimmt die Verbindung nicht mehr an – in der App unter Einstellungen › Kalender neu verbinden.";

/** Fehler von Google als Text für die KI (Eingabefehler-Form, damit `defineTool` ihn zurückgibt). */
export function asToolError(caught: unknown, fallback = "Google hat das nicht angenommen."): Error {
  if (caught instanceof ToolInputError || caught instanceof GoogleUnavailable) {
    return new ToolInputError(caught.message);
  }
  if (caught instanceof GoogleAuthError) {
    return new ToolInputError(caught.kind === "reconnect" ? RECONNECT : caught.message);
  }
  if (caught instanceof GoogleApiError) {
    switch (caught.status) {
      case 412:
        return new ToolInputError(
          "Der Termin wurde in Google inzwischen geändert – bitte mit list_events neu lesen und dann noch einmal versuchen.",
        );
      case 403:
        return new ToolInputError(
          "Google erlaubt das für diesen Termin oder Kalender nicht (kein Schreibrecht, Einladung eines anderen, gesperrt).",
        );
      case 404:
      case 410:
        return new ToolInputError(
          "Der Termin oder Kalender existiert in Google nicht (mehr) – IDs mit list_events neu lesen.",
        );
      case 400:
        return new ToolInputError("Google hat die Angaben abgelehnt.");
      default:
        return new ToolInputError(fallback);
    }
  }
  return caught instanceof Error ? caught : new Error(fallback);
}

/**
 * Kalender aus der Google-Liste wählen: ID, Name (ohne Rücksicht auf Groß-/Kleinschreibung, auch
 * Teil eines eindeutigen Namens) oder „primär“. Unklar oder unbekannt → Rückfrage mit der Liste.
 */
export function pickCalendar(
  calendars: GoogleCalendarEntry[],
  value: string,
  options: { writable?: boolean } = {},
): GoogleCalendarEntry {
  const wanted = value.trim();
  const lower = wanted.toLowerCase();
  const list = () =>
    calendars
      .map(
        (c) =>
          `„${c.name}“ (${c.id}${c.primary ? ", primär" : ""}${c.writable ? "" : ", nur lesbar"})`,
      )
      .join("; ");
  let found: GoogleCalendarEntry[] = [];
  if (lower === "primär" || lower === "primaer" || lower === "primary") {
    found = calendars.filter((c) => c.primary);
  } else {
    found = calendars.filter((c) => c.id === wanted);
    if (found.length === 0) found = calendars.filter((c) => c.name.toLowerCase() === lower);
    if (found.length === 0) {
      found = calendars.filter((c) => c.name.toLowerCase().includes(lower));
    }
  }
  if (found.length === 0) {
    throw new ToolInputError(`Kalender „${wanted}“ nicht gefunden. Vorhanden: ${list()}.`);
  }
  if (found.length > 1) {
    throw new ToolInputError(
      `Kalender „${wanted}“ ist nicht eindeutig: ${found.map((c) => `„${c.name}“ (${c.id})`).join("; ")}. Bitte die ID nennen.`,
    );
  }
  const calendar = found[0] as GoogleCalendarEntry;
  if (options.writable && !calendar.writable) {
    throw new ToolInputError(
      `Der Kalender „${calendar.name}“ ist nur lesbar – dort lässt sich nichts anlegen oder ändern.`,
    );
  }
  return calendar;
}
