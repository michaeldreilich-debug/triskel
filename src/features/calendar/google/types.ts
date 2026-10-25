/**
 * Google-Kalender (#64, N1a): gemeinsame Typen für Server (Routen unter /api/google) und Client
 * (Einstellungen › Kalender). Kein "use client", keine Server-Abhängigkeiten – nie ein Token.
 */
import type { CalendarColor } from "../types";

/** Stand der Verbindung aus GET /api/google/status (ohne Google zu fragen). */
export interface GoogleStatus {
  /** alle drei Werte in Vercel gesetzt und gültig */
  configured: boolean;
  /** warum nicht eingerichtet – nennt nur Namen der Variablen, nie Werte */
  configError: string | null;
  connected: boolean;
  /** ID des primären Kalenders (Gmail-Adresse) */
  email: string | null;
  connectedAt: string | null;
}

/** Ein Kalender aus der Google-Kalenderliste (GET /api/google/calendars). */
export interface GoogleCalendarEntry {
  /** Kalender-ID (beim primären die Gmail-Adresse) */
  id: string;
  /** eigener Name (summaryOverride) oder der Name in Google */
  name: string;
  /** Google-Farbe, auf die Token-Schlüssel der App abgebildet */
  color: CalendarColor;
  accessRole: GoogleAccessRole;
  primary: boolean;
  /** Termine anlegen/ändern erlaubt (owner, writer) */
  writable: boolean;
}

export type GoogleAccessRole = "owner" | "writer" | "reader" | "freeBusyReader";

/** Antwort von GET /api/google/calendars */
export interface GoogleCalendarsResponse {
  calendars: GoogleCalendarEntry[];
}

/**
 * Zustände, wenn Google nicht antwortet wie erwartet (Antwort-Feld `state` bei Fehlern):
 * - `not-configured`: Werte in Vercel fehlen oder sind ungültig
 * - `disconnected`: nicht verbunden
 * - `reconnect`: Google nimmt den Zugang nicht mehr an (widerrufen, abgelaufen, Schlüssel neu)
 * - `unavailable`: Google gerade nicht erreichbar
 */
export type GoogleProblem = "not-configured" | "disconnected" | "reconnect" | "unavailable";

export interface GoogleErrorBody {
  error: string;
  state: GoogleProblem;
}

/**
 * Rückmeldung nach der Rückkehr von Google (`/einstellungen?google=<code>#kalender`). Nur feste
 * Codes – die Meldungstexte stehen in der App, nichts davon kommt von Google.
 */
export const GOOGLE_RETURN_CODES = [
  "verbunden",
  "abgebrochen",
  "berechtigung",
  "abgelaufen",
  "nicht-eingerichtet",
  "anmeldung",
  "fehler",
] as const;
export type GoogleReturnCode = (typeof GOOGLE_RETURN_CODES)[number];

export const GOOGLE_RETURN_MESSAGES: Record<GoogleReturnCode, string> = {
  verbunden: "Mit Google verbunden.",
  abgebrochen: "Anmeldung bei Google abgebrochen – nichts geändert.",
  berechtigung:
    "Google hat nicht alle Berechtigungen erteilt. Bitte noch einmal verbinden und beide Häkchen (Termine, Kalenderliste) setzen.",
  abgelaufen: "Die Anmeldung bei Google ist abgelaufen oder passte nicht – bitte noch einmal.",
  "nicht-eingerichtet": "Google-Zugang in Vercel fehlt – siehe unten.",
  anmeldung: "Zum Verbinden mit Google bitte mit zweitem Faktor anmelden.",
  fehler: "Verbinden mit Google hat nicht geklappt – bitte noch einmal versuchen.",
};

export function parseGoogleReturnCode(value: string | null): GoogleReturnCode | null {
  return (GOOGLE_RETURN_CODES as readonly string[]).includes(value ?? "")
    ? (value as GoogleReturnCode)
    : null;
}
