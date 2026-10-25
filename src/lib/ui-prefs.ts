import { parseTheme, THEME_COOKIE, type Theme } from "./theme";

/**
 * Oberflächen-Einstellungen, die der Server schon beim ersten Rendern kennen muss
 * (kein Aufblitzen, keine Hydration-Abweichung). Gespeichert in Cookies.
 */
export const AREA_COOKIE = "sz-area";
export const SIDEBAR_COOKIE = "sz-sidebar";
export const NOTE_SORT_COOKIE = "sz-note-sort";
export const FONT_COOKIE = "sz-font";

/** Schriftgröße je Gerät (F5, #57): skaliert die Wurzel, alles in rem wächst mit */
export const FONT_SIZES = ["klein", "normal", "gross", "sehr-gross"] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  klein: "Klein",
  normal: "Normal",
  gross: "Groß",
  "sehr-gross": "Sehr groß",
};
export const parseFontSize = (value: string | null | undefined): FontSize =>
  (FONT_SIZES as readonly string[]).includes(value ?? "") ? (value as FontSize) : "normal";

/** Sortierung der Notizliste: zuletzt bearbeitet zuerst (Standard) oder alphabetisch */
export type NoteSort = "neueste" | "az";

export interface UiPrefs {
  theme: Theme;
  /** ID des gewählten Bereichs, null = „Alles“ */
  area: string | null;
  sidebarCollapsed: boolean;
  noteSort: NoteSort;
  fontSize: FontSize;
  /**
   * Wurden Theme bzw. Bereich auf diesem Gerät schon gewählt (Cookie vorhanden)? Wenn nicht,
   * übernimmt die App den zuletzt gespeicherten Wert aus user_settings (neues Gerät).
   */
  stored: { theme: boolean; area: boolean };
}

export function parseUiPrefs(get: (name: string) => string | undefined): UiPrefs {
  const area = get(AREA_COOKIE);
  const theme = get(THEME_COOKIE);
  return {
    theme: parseTheme(theme),
    area: area && /^[a-z0-9-]{1,64}$/i.test(area) ? area : null,
    sidebarCollapsed: get(SIDEBAR_COOKIE) === "1",
    noteSort: get(NOTE_SORT_COOKIE) === "az" ? "az" : "neueste",
    fontSize: parseFontSize(get(FONT_COOKIE)),
    stored: { theme: theme !== undefined, area: area !== undefined },
  };
}

export function writePrefCookie(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API ist nicht überall verfügbar.
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
