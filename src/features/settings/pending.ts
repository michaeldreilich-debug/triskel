/**
 * Theme/Bereich, gewählt, bevor user_settings geladen war (N4): Ohne die Zeilen-ID kann die
 * Speicher-Warteschlange noch nichts speichern. Bisher lag die Wahl nur im Speicher der Seite –
 * wurde sie neu geladen, bevor die Einstellungen da waren, kam sie nie in user_settings (ein
 * neues Gerät sah den alten Stand). Jetzt wartet sie zusätzlich in localStorage und geht beim
 * nächsten Laden mit. Reines Modell ohne „use client“ (Tests).
 */
import { parseTheme, type Theme } from "@/lib/theme";

export const PENDING_SETTINGS_KEY = "sz:einstellungen-offen";

export interface PendingSettings {
  theme?: Theme;
  active_area_id?: string | null;
}

/** Gespeicherten Rest lesen: nur bekannte Felder mit gültigen Werten, sonst nichts. */
export function parsePendingSettings(raw: string | null): PendingSettings {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const result: PendingSettings = {};
  if (record.theme === "dark" || record.theme === "paper") result.theme = parseTheme(record.theme);
  if (
    record.active_area_id === null ||
    (typeof record.active_area_id === "string" && /^[a-z0-9-]{1,64}$/i.test(record.active_area_id))
  ) {
    result.active_area_id = record.active_area_id;
  }
  return result;
}

export function readPendingSettings(): PendingSettings {
  try {
    return parsePendingSettings(window.localStorage.getItem(PENDING_SETTINGS_KEY));
  } catch {
    return {};
  }
}

export function writePendingSettings(values: PendingSettings): void {
  try {
    if (Object.keys(values).length > 0) {
      window.localStorage.setItem(PENDING_SETTINGS_KEY, JSON.stringify(values));
    } else window.localStorage.removeItem(PENDING_SETTINGS_KEY);
  } catch {
    // privates Fenster o. Ä.: dann wie bisher nur im Speicher der Seite
  }
}
