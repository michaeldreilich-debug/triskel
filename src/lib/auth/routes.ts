/**
 * Routenschutz als reine Logik (unit-getestet); proxy.ts wendet sie an.
 * Öffentlich: /login und /dev/* (Entwicklerseiten liefern in Produktion selbst 404), dazu die
 * KI-Schnittstelle /api/mcp und /.well-known/* – sie prüfen ihr OAuth-Token selbst (#33) – und
 * die Datenschutzerklärung /datenschutz (#64) und öffentlich freigegebene Notizen /freigabe/<token>
 * samt ihren Dateien /api/freigabe/<token>/datei (#94; Prüfung per Token in der Datenbank).
 * B16: In die App kommt nur, wer den zweiten Faktor bestätigt hat (aal2). Mit Passwort allein
 * (aal1) geht es zur Abfrage (/mfa) bzw. ohne eingerichteten Faktor zur Einrichtung.
 */
export const LOGIN_PATH = "/login";
export const HOME_PATH = "/heute";
export const MFA_PATH = "/mfa";
export const MFA_SETUP_PATH = "/mfa/einrichten";

/** Öffentlich freigegebene Notizen (#94, E42): Seite und ihre Dateien, ohne Anmeldung. */
export const SHARE_PREFIXES = ["/freigabe", "/api/freigabe"] as const;

// /datenschutz: öffentliche Datenschutzerklärung (Google-Anmeldeseite, #64)
const PUBLIC_PREFIXES = [
  LOGIN_PATH,
  "/dev",
  "/api/mcp",
  "/.well-known",
  "/datenschutz",
  ...SHARE_PREFIXES,
];

/**
 * Symbol und App-Icons (Triskel, O7) – auch ohne Anmeldung: Die Anmelde- und MFA-Seiten zeigen
 * das Symbol, der Browser lädt das Icon für den Reiter (sonst Umleitung auf /login statt Bild).
 * Nur genau diese Dateien, nie nach Endung (S-6).
 */
const PUBLIC_FILES = new Set([
  "/triskel.png",
  "/icon.png",
  "/apple-icon.png",
  // Web-App-Manifest (E44): Safari lädt es für „Zum Home-Bildschirm“ ohne Anmeldung
  "/manifest.webmanifest",
]);

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_FILES.has(pathname) || PUBLIC_PREFIXES.some((prefix) => matches(pathname, prefix));
}

/** Seite oder Datei einer öffentlichen Freigabe (eigene CSP für Bilder, #94)? */
export function isSharePath(pathname: string): boolean {
  return SHARE_PREFIXES.some((prefix) => matches(pathname, prefix));
}

export function isMfaPath(pathname: string): boolean {
  return matches(pathname, MFA_PATH);
}

/** Platzhalter-Ursprung zum Auflösen: Was danach woanders hinzeigt, ist kein App-Pfad. */
const PROBE_ORIGIN = "http://app.invalid";

/**
 * Rücksprungziel als App-Pfad oder null. Nicht über Präfixe prüfen, sondern auflösen und den
 * Ursprung vergleichen: Der URL-Parser entfernt Tab/LF/CR, aus „/\t/evil.example“ würde sonst
 * „//evil.example“ (offener Redirect, Security-Review 15.10.2026). Steuerzeichen, Leerraum und
 * Backslashes sind deshalb ganz verboten; Login- und MFA-Seiten sind kein Ziel (Schleife).
 */
function parseNextPath(value: string | null | undefined): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen gezielt abweisen (s. o.)
  if (!value?.startsWith("/") || /[\u0000-\u001f\u007f\\\s]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  if ([LOGIN_PATH, MFA_PATH].some((path) => matches(url.pathname, path))) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Nur relative Pfade innerhalb der App zulassen (kein offener Redirect, kein Login/MFA). */
export function safeNextPath(value: string | null | undefined): string {
  return parseNextPath(value) ?? HOME_PATH;
}

/** Ziel mit Rücksprung: `/mfa?next=%2Fheute`; leere oder unsichere Ziele fallen weg. */
function withNext(path: string, next: string | null): string {
  const target = parseNextPath(next);
  return target ? `${path}?next=${encodeURIComponent(target)}` : path;
}

export type RouteDecision = { type: "next" } | { type: "redirect"; to: string };

export type AssuranceLevel = "aal1" | "aal2";

export interface RouteInput {
  pathname: string;
  search: string;
  authenticated: boolean;
  /** Stufe aus dem geprüften JWT; alles außer „aal2“ gilt als nur Passwort. */
  aal?: AssuranceLevel | null;
  /**
   * Hat der Nutzer einen bestätigten Faktor? Wird nur bei aal1 gebraucht (der Proxy fragt es
   * dann beim Auth-Server ab). Unbekannt (undefined) zählt als „hat einen“: Einrichten geht nur
   * ohne Faktor, die Abfrage schickt sonst selbst zur Einrichtung.
   */
  hasVerifiedFactor?: boolean;
}

/** Braucht die Entscheidung den Faktor-Status? (nur angemeldet mit aal1 auf Nicht-Dev-Seiten) */
export function needsFactorStatus(input: Omit<RouteInput, "hasVerifiedFactor">): boolean {
  return (
    input.authenticated &&
    input.aal !== "aal2" &&
    !(isPublicPath(input.pathname) && input.pathname !== LOGIN_PATH)
  );
}

export function decideRoute(input: RouteInput): RouteDecision {
  const { pathname, search, authenticated } = input;
  const aal2 = authenticated && input.aal === "aal2";
  const mfaTarget = input.hasVerifiedFactor === false ? MFA_SETUP_PATH : MFA_PATH;

  if (pathname === LOGIN_PATH) {
    if (!authenticated) return { type: "next" };
    const next = new URLSearchParams(search).get("next");
    return { type: "redirect", to: aal2 ? safeNextPath(next) : withNext(mfaTarget, next) };
  }

  if (isPublicPath(pathname)) return { type: "next" };

  if (isMfaPath(pathname)) {
    const next = new URLSearchParams(search).get("next");
    // Sitzung weg (z. B. auf einem anderen Gerät bestätigt): neu anmelden, Rücksprung behalten
    if (!authenticated) return { type: "redirect", to: withNext(LOGIN_PATH, next) };
    if (aal2) return { type: "redirect", to: safeNextPath(next) };
    // genau die passende MFA-Seite zeigen (Abfrage bzw. Einrichtung), Rücksprung behalten
    if (pathname === mfaTarget) return { type: "next" };
    return { type: "redirect", to: withNext(mfaTarget, next) };
  }

  if (!authenticated) {
    const target = `${pathname}${search}`;
    return {
      type: "redirect",
      to: target === "/" ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(target)}`,
    };
  }

  if (!aal2) return { type: "redirect", to: withNext(mfaTarget, `${pathname}${search}`) };

  return { type: "next" };
}
