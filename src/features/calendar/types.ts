/**
 * Kalender (Stufe 2, S2a): Google-Kalender lesend über die geheime iCal-Adresse (Migration 30).
 * Gemeinsame Typen für Server (Laden, Parsen), Client (Hook, Einstellungen) und die späteren
 * Ansichten (S2b/S2c). Kein "use client": auch Server-Code importiert von hier.
 */
import type { IsoDate } from "@/lib/dates";

/** Farben als Token-Schlüssel (`--ink-*` aus tokens.css), nie als Wert gespeichert. */
export const CALENDAR_COLORS = ["blau", "gruen", "orange", "gelb", "lila", "rot", "grau"] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];
export const DEFAULT_CALENDAR_COLOR: CalendarColor = "blau";

export const CALENDAR_COLOR_LABELS: Record<CalendarColor, string> = {
  blau: "Blau",
  gruen: "Grün",
  orange: "Orange",
  gelb: "Gelb",
  lila: "Lila",
  rot: "Rot",
  grau: "Grau",
};

export function parseCalendarColor(value: unknown): CalendarColor {
  return (CALENDAR_COLORS as readonly unknown[]).includes(value)
    ? (value as CalendarColor)
    : DEFAULT_CALENDAR_COLOR;
}

/** Art einer Kalenderquelle (Migration 36): geheime iCal-Adresse oder Kalender des Google-Kontos. */
export type CalendarSourceKind = "ical" | "google";

/** Zeile aus calendar_sources – die Adresse nur in den Einstellungen laden. */
export interface CalendarSourceRow {
  id: string;
  kind: CalendarSourceKind;
  name: string;
  /** geheime iCal-Adresse (Geheimnis: nie loggen, nie exportieren); bei Google leer */
  url: string;
  /** Kalender-ID in Google (nur bei kind = google) */
  google_calendar_id: string | null;
  color: CalendarColor;
  enabled: boolean;
  sort: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Kalendertage (inklusive) in Europe/Berlin. */
export interface CalendarRange {
  start: IsoDate;
  end: IsoDate;
}

/**
 * Ein Termin (bzw. eine Instanz einer Wiederholung), normalisiert auf Europe/Berlin – die Form,
 * mit der Woche, Monat, Tag, Liste und der Tagesablauf auf Heute arbeiten (S2b/S2c).
 */
export interface CalendarEvent {
  /** eindeutig je Instanz: `<quelle>:<uid>:<beginn>` */
  id: string;
  sourceId: string;
  sourceName: string;
  color: CalendarColor;
  uid: string;
  title: string;
  location: string | null;
  description: string | null;
  allDay: boolean;
  /** Beginn und Ende als Zeitpunkt (ISO, UTC). Ganztägig: Mitternacht Europe/Berlin, Ende exklusiv. */
  start: string;
  end: string;
  /** erster und letzter Kalendertag in Europe/Berlin (inklusive) */
  date: IsoDate;
  endDate: IsoDate;
  /** Minuten seit Mitternacht am ersten bzw. letzten Tag; ganztägig null. Ende um Mitternacht = 1440. */
  startMinutes: number | null;
  endMinutes: number | null;
  /** belegt (für die Tageslast); „frei“ markierte Termine (TRANSP:TRANSPARENT) zählen nicht */
  busy: boolean;
  recurring: boolean;
  /** Termin in Google Kalender öffnen (wenn ableitbar) */
  link: string | null;
  /** Nur bei Terminen, die über das Google-Konto gelesen wurden (N1b); iCal-Termine: null/fehlt */
  google?: GoogleEventRef | null;
}

/**
 * Verweis auf den Termin in Google (#64, N1b): was die App zum Verschieben braucht. Nie ein Token.
 * Bei Instanzen einer Serie ist `eventId` die ID der Instanz – gepatcht wird nur diese eine.
 */
export interface GoogleEventRef {
  calendarId: string;
  eventId: string;
  etag: string;
  /** ziehbar/änderbar: Kalender mit Schreibrecht, bei Einladungen nur als Organisator bzw. bei guestsCanModify */
  editable: boolean;
  /** Instanz einer Serie: ID der Serie */
  recurringEventId: string | null;
  /** Zone des Termins in Google (z. B. Europe/Berlin), wenn Google sie nennt; ganztägig null */
  timeZone: string | null;
}

/** Stand einer Quelle beim Laden – Fehler nennen nie die Adresse. */
export interface CalendarSourceStatus {
  id: string;
  name: string;
  color: CalendarColor;
  /** Termine im Zeitraum */
  count: number;
  error: string | null;
  /** Google nimmt den Zugang nicht mehr an: „Neu verbinden“ anbieten (N1b) */
  reconnect?: boolean;
  /** Google-Kalender mit Schreibrecht (owner/writer): hier lassen sich Termine anlegen (N1c) */
  writable?: boolean;
  /** der primäre Kalender des Kontos (Standard für neue Termine, N1c) */
  primary?: boolean;
}

/** Antwort von GET /api/kalender?von=…&bis=… */
export interface CalendarResponse {
  range: CalendarRange;
  events: CalendarEvent[];
  sources: CalendarSourceStatus[];
  fetchedAt: string;
}

/** Antwort des Probe-Abrufs (POST /api/kalender/probe) */
export interface CalendarProbe {
  ok: boolean;
  /** Name laut Kalender (X-WR-CALNAME), wenn vorhanden */
  calendarName: string | null;
  /** Termine in den nächsten 30 Tagen */
  count: number;
  /** die nächsten drei */
  next: Array<{ title: string; date: IsoDate; time: string | null }>;
  error: string | null;
}

/** Abschnitt eines Termins an einem Kalendertag (für Tagesspalten, Tageslast, freie Fenster). */
export interface CalendarDaySegment {
  event: CalendarEvent;
  date: IsoDate;
  /** Minuten seit Mitternacht; ganztägig 0–1440 */
  from: number;
  to: number;
  /** läuft vom Vortag herein bzw. in den Folgetag hinaus */
  continuesBefore: boolean;
  continuesAfter: boolean;
}
