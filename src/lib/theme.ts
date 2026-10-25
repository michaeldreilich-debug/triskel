export const THEMES = ["dark", "paper"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "dark";
export const THEME_COOKIE = "sz-theme";

export const THEME_LABELS: Record<Theme, string> = {
  dark: "Dunkel",
  paper: "Papier",
};

export function parseTheme(value: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : DEFAULT_THEME;
}

/**
 * Setzt das Theme sofort (ohne Neuladen) und merkt es sich im Cookie, damit der Server
 * beim nächsten Aufruf direkt das richtige Theme rendert (kein Aufblitzen, kein Inline-Skript).
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API ist nicht überall verfügbar.
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

/**
 * Farbe der Statusleiste bzw. des Browser-Rahmens je Theme (`<meta name="theme-color">`, App-Modus
 * auf dem Handy) – gleich dem `--bg` des Themes in `src/styles/tokens.css`. Die Manifest-Datei
 * kann keine Tokens lesen und nimmt den Standard (dunkel). Ohne Raute notiert, weil Farbwerte
 * sonst nur in tokens.css stehen (Token-Regel); `theme.test.ts` hält sie gleich dem `--bg`.
 */
export const THEME_COLORS: Record<Theme, string> = {
  dark: `#${"0a0a0b"}`,
  paper: `#${"f6f4ef"}`,
};
