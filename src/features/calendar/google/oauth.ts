/**
 * Anmeldung bei Google (#64, N1a) – OAuth 2.0 für Webanwendungen mit PKCE (S256) und `state`,
 * nur im Server. Ablauf: `/api/google/start` legt state + PKCE verschlüsselt in ein kurzlebiges
 * httpOnly-Cookie und leitet zu Google; `/api/google/callback` prüft beides und tauscht den Code.
 * Zugriffs-Tokens leben nur im Speicher der Anfrage; gespeichert wird nur der Refresh-Token
 * (verschlüsselt, `crypto.ts`). Fehlermeldungen sind fest – nie Antworttexte von Google, nie Tokens.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { appPath } from "@/lib/app-links";
import type { GoogleEndpoints } from "./config";
import { OAUTH_STATE_CONTEXT, openSecret, SecretCryptoError, sealSecret } from "./crypto";

/** Termine lesen/anlegen/ändern/löschen und die Liste der Kalender (nur lesen) – sonst nichts. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export const GOOGLE_TIMEOUT_MS = 10_000;
/** Cookie mit state + PKCE (verschlüsselt), nur für /api/google, 10 Minuten. */
export const OAUTH_COOKIE = "sz-google-oauth";
export const OAUTH_COOKIE_PATH = "/api/google";
export const OAUTH_MAX_AGE_S = 600;
export const CALLBACK_PATH = "/api/google/callback";
export const START_PATH = "/api/google/start";

/**
 * - `reconnect`: Google nimmt den Zugang nicht mehr an (widerrufen, abgelaufen) → neu verbinden
 * - `config`: Google lehnt den Zugang der App ab (Client-ID/-Schlüssel in Vercel)
 * - `unavailable`: Netz, Zeitlimit, unerwartete Antwort
 */
export type GoogleErrorKind = "reconnect" | "config" | "unavailable";

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly kind: GoogleErrorKind,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const UNAVAILABLE = "Google ist gerade nicht erreichbar – bitte später noch einmal.";
const CLIENT_REJECTED =
  "Google lehnt den Zugang der App ab – GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET in Vercel prüfen.";
const RECONNECT = "Google nimmt die Verbindung nicht mehr an – bitte neu verbinden.";

/* ------------------------------------------------------------------ */
/* PKCE und state                                                      */
/* ------------------------------------------------------------------ */

/** Zufallswert für state bzw. PKCE-Verifier (32 Byte, base64url, 43 Zeichen). */
export const randomToken = () => randomBytes(32).toString("base64url");

export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

/** Zeitkonstanter Vergleich zweier Zeichenketten. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface OAuthState {
  state: string;
  verifier: string;
  userId: string;
  /** Ablauf (ms seit 1970) */
  expires: number;
}

const OAuthStateSchema = z.object({
  state: z.string().min(16).max(200),
  verifier: z.string().min(43).max(128),
  userId: z.string().min(1).max(100),
  expires: z.number(),
});

export const sealOAuthState = (value: OAuthState, key: Buffer) =>
  sealSecret(JSON.stringify(value), key, OAUTH_STATE_CONTEXT);

/** Cookie öffnen: fehlt, verändert, falscher Schlüssel, abgelaufen → null. */
export function openOAuthState(
  raw: string | undefined,
  key: Buffer,
  now: number = Date.now(),
): OAuthState | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const parsed = OAuthStateSchema.safeParse(
      JSON.parse(openSecret(raw, key, OAUTH_STATE_CONTEXT)),
    );
    if (!parsed.success || parsed.data.expires < now) return null;
    return parsed.data;
  } catch (error) {
    if (error instanceof SecretCryptoError || error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Rücksprung-Adresse – genau so bei Google eingetragen (README › Schritt 13). `origin` kommt aus
 * `googleRedirectOrigin` (in Produktion fest, G-2).
 */
export const callbackUrl = (origin: string) => new URL(CALLBACK_PATH, origin).href;

/** Adresse der Google-Anmeldung. Der Clientschlüssel steht nie darin. */
export function buildAuthUrl(
  endpoints: GoogleEndpoints,
  params: { clientId: string; redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(endpoints.auth);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // Refresh-Token (Dauer-Zugang) und jedes Mal die Zustimmung – sonst fehlt er beim Neu-Verbinden
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.href;
}

/** Fehlt eine der beiden Berechtigungen? (Google lässt Häkchen einzeln abwählen.) */
export function missingScopes(granted: string): string[] {
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return GOOGLE_SCOPES.filter((scope) => !have.has(scope));
}

/* ------------------------------------------------------------------ */
/* Token-Endpunkte                                                     */
/* ------------------------------------------------------------------ */

const TokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

async function postForm(
  url: string,
  form: Record<string, string>,
  deps: FetchDeps,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? GOOGLE_TIMEOUT_MS);
  try {
    const response = await (deps.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    throw new GoogleAuthError(UNAVAILABLE, "unavailable");
  } finally {
    clearTimeout(timer);
  }
}

const errorCode = (body: unknown) =>
  typeof (body as { error?: unknown } | null)?.error === "string"
    ? ((body as { error: string }).error as string)
    : "";

/** Fehlerantwort des Token-Endpunkts einordnen. */
function tokenError(status: number, body: unknown): GoogleAuthError {
  const code = errorCode(body);
  if (code === "invalid_client" || code === "unauthorized_client") {
    return new GoogleAuthError(CLIENT_REJECTED, "config");
  }
  if (status === 400 || status === 401) return new GoogleAuthError(RECONNECT, "reconnect");
  return new GoogleAuthError(UNAVAILABLE, "unavailable");
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string | null;
  scope: string;
}

function parseToken(body: unknown): TokenResult {
  const parsed = TokenSchema.safeParse(body);
  if (!parsed.success) throw new GoogleAuthError(UNAVAILABLE, "unavailable");
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    scope: parsed.data.scope ?? "",
  };
}

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** Code nach der Rückkehr gegen Tokens tauschen (mit PKCE-Verifier). */
export async function exchangeCode(
  endpoints: GoogleEndpoints,
  params: ClientCredentials & { code: string; verifier: string; redirectUri: string },
  deps: FetchDeps = {},
): Promise<TokenResult> {
  const { status, body } = await postForm(
    endpoints.token,
    {
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.verifier,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    },
    deps,
  );
  if (status !== 200) throw tokenError(status, body);
  return parseToken(body);
}

/** Neuen Zugriffs-Token holen – nur für diese Anfrage, nie gespeichert. */
export async function refreshAccessToken(
  endpoints: GoogleEndpoints,
  params: ClientCredentials & { refreshToken: string },
  deps: FetchDeps = {},
): Promise<TokenResult> {
  const { status, body } = await postForm(
    endpoints.token,
    {
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    },
    deps,
  );
  if (status !== 200) throw tokenError(status, body);
  return parseToken(body);
}

/**
 * Zugang bei Google widerrufen. true, wenn er danach sicher weg ist (auch: war schon ungültig);
 * false bei Netz-/Serverfehlern.
 */
export async function revokeToken(
  endpoints: GoogleEndpoints,
  token: string,
  deps: FetchDeps = {},
): Promise<boolean> {
  try {
    const { status, body } = await postForm(endpoints.revoke, { token }, deps);
    return status === 200 || (status === 400 && errorCode(body) === "invalid_token");
  } catch {
    return false;
  }
}

/** Zurück nach Einstellungen › Kalender mit festem Rückmelde-Code (`?google=…#kalender`). */
export function settingsReturnUrl(requestUrl: string, code: string): URL {
  const url = new URL(appPath.settings(), requestUrl);
  url.searchParams.set("google", code);
  url.hash = "kalender";
  return url;
}
