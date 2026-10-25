/**
 * Google-Zugang der App (#64, N1a) – nur im Server. Drei Werte aus Vercel (Production):
 * `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY`. Der Nutzer hat sie per Kopieren
 * eingetragen – Leerraum und Zeilenumbrüche am Rand werden deshalb entfernt. Fehlt etwas oder ist
 * der Schlüssel unbrauchbar, ist Google „nicht eingerichtet“; die Meldung nennt nur die Namen der
 * Variablen, nie Werte.
 *
 * Die Google-Adressen stehen fest im Code. Nur in Tests (`NODE_ENV=test`, Playwright) lassen sie
 * sich über `GOOGLE_OAUTH_BASE`/`GOOGLE_API_BASE` auf den Google-Ersatz `/dev/google` umbiegen –
 * in Entwicklung und Produktion wirkungslos (wie `CALENDAR_ALLOWED_ORIGINS`). `env.NODE_ENV` wird
 * über das Objekt gelesen: Next setzt das wörtliche `process.env.NODE_ENV` beim Bauen fest ein.
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/**
 * Adresse der App in Produktion – genau so ist der Rücksprung bei Google eingetragen
 * (README › Schritt 13: `…/api/google/callback`). Ändert sich die Adresse (eigene Domain), hier und
 * bei Google gemeinsam ändern.
 */
export const APP_PRODUCTION_ORIGIN = "https://deine-app.vercel.app";

export const GOOGLE_ENV_NAMES = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_TOKEN_KEY",
] as const;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** 32 Byte für AES-256-GCM */
  tokenKey: Buffer;
}

export type GoogleConfigResult = { ok: true; config: GoogleConfig } | { ok: false; error: string };

type Env = Record<string, string | undefined>;

const read = (env: Env, name: string) => (env[name] ?? "").trim();

/** Base64 (auch base64url) streng lesen; null, wenn es keins ist. */
function decodeBase64(value: string): Buffer | null {
  const compact = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;
  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

/** Zugang aus der Umgebung – getrimmt, geprüft, ohne je einen Wert zu nennen. */
export function readGoogleConfig(env: Env = process.env): GoogleConfigResult {
  const missing = GOOGLE_ENV_NAMES.filter((name) => read(env, name) === "");
  if (missing.length > 0) {
    return { ok: false, error: `Google-Zugang in Vercel fehlt (${missing.join(", ")}).` };
  }
  const clientId = read(env, "GOOGLE_CLIENT_ID");
  if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    return {
      ok: false,
      error:
        "GOOGLE_CLIENT_ID in Vercel sieht nicht wie eine Client-ID aus (endet auf .apps.googleusercontent.com).",
    };
  }
  const tokenKey = decodeBase64(read(env, "GOOGLE_TOKEN_KEY"));
  if (tokenKey?.length !== 32) {
    return {
      ok: false,
      error:
        "GOOGLE_TOKEN_KEY in Vercel ist kein gültiger Schlüssel (base64, 32 Byte – neu mit „openssl rand -base64 32“).",
    };
  }
  return {
    ok: true,
    config: { clientId, clientSecret: read(env, "GOOGLE_CLIENT_SECRET"), tokenKey },
  };
}

export interface GoogleEndpoints {
  auth: string;
  token: string;
  revoke: string;
  /** Basis der Calendar API (ohne Schrägstrich am Ende) */
  api: string;
}

/** http(s)-Basis ohne Schrägstrich am Ende, sonst null. */
function testBase(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Feste Google-Adressen; nur in Tests auf den Google-Ersatz umbiegbar. */
export function googleEndpoints(env: Env = process.env): GoogleEndpoints {
  const fixed: GoogleEndpoints = {
    auth: GOOGLE_AUTH_URL,
    token: GOOGLE_TOKEN_URL,
    revoke: GOOGLE_REVOKE_URL,
    api: GOOGLE_CALENDAR_API,
  };
  if (env.NODE_ENV !== "test") return fixed;
  const oauth = testBase(env.GOOGLE_OAUTH_BASE);
  const api = testBase(env.GOOGLE_API_BASE);
  return {
    auth: oauth ? `${oauth}/auth` : fixed.auth,
    token: oauth ? `${oauth}/token` : fixed.token,
    revoke: oauth ? `${oauth}/revoke` : fixed.revoke,
    api: api ?? fixed.api,
  };
}

/**
 * Ursprung für den Rücksprung der Google-Anmeldung (`redirect_uri`, G-2). In Produktion fest –
 * nie aus Host bzw. `x-forwarded-host` der Anfrage, auch nicht, wenn die App über eine andere
 * Vercel-Adresse geöffnet ist. In Entwicklung und Tests der Ursprung der Anfrage (localhost,
 * Google-Ersatz unter `/dev/google`).
 */
export function googleRedirectOrigin(requestUrl: string, env: Env = process.env): string {
  if (env.NODE_ENV === "production") return APP_PRODUCTION_ORIGIN;
  return new URL(requestUrl).origin;
}
