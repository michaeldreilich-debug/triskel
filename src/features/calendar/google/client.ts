"use client";

/**
 * Google-Konto im Client (#64, N1a) – nur für Einstellungen › Kalender. Spricht ausschließlich
 * mit den eigenen Routen unter /api/google; ein Token kommt hier nie an.
 * - `useGoogleStatus`: eingerichtet, verbunden, E-Mail (GET /api/google/status)
 * - `useGoogleCalendars`: Kalenderliste (GET /api/google/calendars), Fehler mit `state`
 *   („neu verbinden“, „nicht erreichbar“ …)
 * - `disconnectGoogle`: Trennen (POST /api/google/disconnect)
 */
import { useQuery } from "@tanstack/react-query";
import type {
  GoogleCalendarEntry,
  GoogleCalendarsResponse,
  GoogleProblem,
  GoogleStatus,
} from "./types";

export const googleKey = ["google"] as const;
export const googleStatusKey = ["google", "status"] as const;
export const googleCalendarsKey = ["google", "calendars"] as const;

/** Start der Anmeldung – ein Link (volle Seite), kein fetch. */
export const GOOGLE_START_PATH = "/api/google/start";

export class GoogleRequestError extends Error {
  constructor(
    message: string,
    readonly state: GoogleProblem | null,
  ) {
    super(message);
    this.name = "GoogleRequestError";
  }
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("application/json") ? ((await response.json()) as unknown) : null;
  if (!response.ok || body === null) {
    const error = (body as { error?: unknown } | null)?.error;
    const state = (body as { state?: unknown } | null)?.state;
    throw new GoogleRequestError(
      typeof error === "string" ? error : fallback,
      typeof state === "string" ? (state as GoogleProblem) : null,
    );
  }
  return body as T;
}

export async function fetchGoogleStatus(signal?: AbortSignal): Promise<GoogleStatus> {
  const response = await fetch("/api/google/status", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  return readJson<GoogleStatus>(response, "Der Stand der Google-Verbindung ließ sich nicht laden.");
}

export async function fetchGoogleCalendars(signal?: AbortSignal): Promise<GoogleCalendarEntry[]> {
  const response = await fetch("/api/google/calendars", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  return (
    await readJson<GoogleCalendarsResponse>(
      response,
      "Die Google-Kalenderliste ließ sich nicht laden.",
    )
  ).calendars;
}

export function useGoogleStatus() {
  return useQuery({
    queryKey: googleStatusKey,
    staleTime: 60_000,
    retry: 1,
    queryFn: ({ signal }) => fetchGoogleStatus(signal),
  });
}

/** Kalenderliste – nur, wenn verbunden; „neu verbinden“ wird nicht wiederholt. */
export function useGoogleCalendars(enabled: boolean) {
  return useQuery({
    queryKey: googleCalendarsKey,
    enabled,
    staleTime: 5 * 60_000,
    retry: (count, error) =>
      count < 1 && error instanceof GoogleRequestError && error.state === "unavailable",
    queryFn: ({ signal }) => fetchGoogleCalendars(signal),
  });
}

/** Trennen; `revoked` = Google hat den Widerruf bestätigt. */
export async function disconnectGoogle(): Promise<{ revoked: boolean }> {
  const response = await fetch("/api/google/disconnect", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  return readJson<{ ok: boolean; revoked: boolean }>(
    response,
    "Das Google-Konto ließ sich nicht trennen.",
  );
}
