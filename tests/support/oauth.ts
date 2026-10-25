/**
 * OAuth-Ablauf des Supabase-OAuth-Servers im Test (#33): Client registrieren (im Testprojekt per
 * Dynamic Client Registration, standardmäßig vertraulich mit Geheimnis wie die Zugänge, die
 * der Nutzer in Prod von Hand anlegt), Anfrage starten (PKCE), freigeben und erlauben wie
 * /ki-zugang, Code gegen Tokens tauschen, erneuern, Zugang trennen. Direkt über die
 * REST-Endpunkte, damit Integrations- und E2E-Tests dieselben Schritte gehen wie Claude bzw.
 * ChatGPT.
 */
import { createHash, randomBytes } from "node:crypto";

export interface AsMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  [key: string]: unknown;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface OAuthEnv {
  url: string;
  publishableKey: string;
}

/** Metadaten des Auth-Servers; null, wenn der OAuth-Server im Projekt aus ist. */
export async function oauthMetadata(env: OAuthEnv): Promise<AsMetadata | null> {
  const origin = new URL(env.url).origin;
  const response = await fetch(`${origin}/.well-known/oauth-authorization-server/auth/v1`);
  if (!response.ok) return null;
  return (await response.json()) as AsMetadata;
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Client registrieren; vertraulich (mit Geheimnis) wie in Prod, öffentlich nur für Gegenproben. */
export async function registerClient(
  meta: AsMetadata,
  name: string,
  redirectUri: string,
  { confidential = true }: { confidential?: boolean } = {},
) {
  if (!meta.registration_endpoint) throw new Error("Dynamic Client Registration ist aus.");
  const response = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: confidential ? "client_secret_post" : "none",
    }),
  });
  const body = (await response.json()) as {
    client_id?: string;
    client_secret?: string;
    [key: string]: unknown;
  };
  if (!response.ok || !body.client_id) {
    throw new Error(`Registrierung fehlgeschlagen: ${response.status} ${JSON.stringify(body)}`);
  }
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

/** Anfrage starten wie ein MCP-Client; liefert die authorization_id aus der Weiterleitung. */
export async function startAuthorization(
  meta: AsMetadata,
  options: {
    clientId: string;
    redirectUri: string;
    challenge: string;
    state: string;
    resource?: string;
  },
): Promise<{ authorizationId: string; location: string }> {
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    state: options.state,
    ...(options.resource ? { resource: options.resource } : {}),
  }).toString();
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  const authorizationId = location
    ? new URL(location, url).searchParams.get("authorization_id")
    : null;
  if (!authorizationId) {
    throw new Error(
      `Keine authorization_id (${response.status}): ${location || (await response.text())}`,
    );
  }
  return { authorizationId, location };
}

const authHeaders = (env: OAuthEnv, accessToken: string) => ({
  apikey: env.publishableKey,
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

/** Details der Anfrage (was /ki-zugang anzeigt) mit der Sitzung des Nutzers. */
export async function authorizationDetails(env: OAuthEnv, accessToken: string, id: string) {
  const response = await fetch(`${env.url}/auth/v1/oauth/authorizations/${id}`, {
    headers: authHeaders(env, accessToken),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Freigabe in ai_clients wie „Erlauben“ auf /ki-zugang (geht nur mit aal2); liefert den Status. */
export async function allowClient(
  env: OAuthEnv,
  accessToken: string,
  clientId: string,
  name: string,
) {
  const response = await fetch(`${env.url}/rest/v1/ai_clients`, {
    method: "POST",
    headers: { ...authHeaders(env, accessToken), Prefer: "return=minimal" },
    body: JSON.stringify({ client_id: clientId, name }),
  });
  return response.status;
}

/** Freigabe zurücknehmen wie „Trennen“ in den Einstellungen (vor revokeGrant). */
export async function blockClient(env: OAuthEnv, accessToken: string, clientId: string) {
  const response = await fetch(
    `${env.url}/rest/v1/ai_clients?client_id=eq.${encodeURIComponent(clientId)}`,
    {
      method: "PATCH",
      headers: { ...authHeaders(env, accessToken), Prefer: "return=minimal" },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    },
  );
  return response.status;
}

/**
 * Erlauben bzw. ablehnen wie „Erlauben“ auf /ki-zugang; liefert die Weiterleitung mit Code.
 * Wie die Seite erst die Details laden – das ordnet die Anfrage der Sitzung zu, sonst kennt
 * Supabase sie beim Erlauben nicht („authorization not found“).
 */
export async function consent(
  env: OAuthEnv,
  accessToken: string,
  id: string,
  action: "approve" | "deny" = "approve",
) {
  const details = await authorizationDetails(env, accessToken, id);
  // Schon erlaubt: Supabase gibt beim Laden direkt die Weiterleitung mit Code zurück
  if (details.status === 200 && !details.body.authorization_id && details.body.redirect_url) {
    return { status: 200, body: details.body as { redirect_url?: string } };
  }
  const response = await fetch(`${env.url}/auth/v1/oauth/authorizations/${id}/consent`, {
    method: "POST",
    headers: authHeaders(env, accessToken),
    body: JSON.stringify({ action }),
  });
  const body = (await response.json()) as { redirect_url?: string; [key: string]: unknown };
  return { status: response.status, body };
}

async function tokenRequest(meta: AsMetadata, params: Record<string, string>) {
  const response = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await response.json()) as OAuthTokens & { error?: string };
  return { status: response.status, body };
}

export const exchangeCode = (
  meta: AsMetadata,
  options: {
    clientId: string;
    clientSecret?: string;
    code: string;
    verifier: string;
    redirectUri: string;
    resource?: string;
  },
) =>
  tokenRequest(meta, {
    grant_type: "authorization_code",
    client_id: options.clientId,
    ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
    code: options.code,
    code_verifier: options.verifier,
    redirect_uri: options.redirectUri,
    ...(options.resource ? { resource: options.resource } : {}),
  });

export const refreshTokens = (
  meta: AsMetadata,
  clientId: string,
  refreshToken: string,
  clientSecret?: string,
) =>
  tokenRequest(meta, {
    grant_type: "refresh_token",
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    refresh_token: refreshToken,
  });

/** Zugänge des Nutzers (Einstellungen › KI-Zugänge) und Trennen. */
export async function listGrants(env: OAuthEnv, accessToken: string) {
  const response = await fetch(`${env.url}/auth/v1/user/oauth/grants`, {
    headers: authHeaders(env, accessToken),
  });
  return (await response.json()) as Array<{ client: { id: string; name: string } }>;
}

export async function revokeGrant(env: OAuthEnv, accessToken: string, clientId: string) {
  const response = await fetch(
    `${env.url}/auth/v1/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`,
    { method: "DELETE", headers: authHeaders(env, accessToken) },
  );
  return response.status;
}

/** Claims eines JWT (ohne Prüfung – nur zum Ansehen im Test). */
export function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
}

export function headerOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString());
}

/**
 * Ganzer Ablauf bis zu den Tokens: registrieren, starten, freigeben (allow, wie /ki-zugang),
 * erlauben, tauschen (mit Geheimnis bei vertraulichen Clients).
 */
export async function connectClient(
  env: OAuthEnv,
  meta: AsMetadata,
  userAccessToken: string,
  options: {
    name: string;
    redirectUri: string;
    resource?: string;
    allow?: boolean;
    confidential?: boolean;
  },
) {
  const { allow = true, confidential = true } = options;
  const { clientId, clientSecret } = await registerClient(meta, options.name, options.redirectUri, {
    confidential,
  });
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString("hex");
  const { authorizationId } = await startAuthorization(meta, {
    clientId,
    redirectUri: options.redirectUri,
    challenge,
    state,
    resource: options.resource,
  });
  const allowed = allow ? await allowClient(env, userAccessToken, clientId, options.name) : null;
  const approved = await consent(env, userAccessToken, authorizationId);
  const redirect = approved.body.redirect_url ? new URL(approved.body.redirect_url) : null;
  const code = redirect?.searchParams.get("code");
  if (!code) {
    return {
      clientId,
      clientSecret,
      allowed,
      approved,
      tokens: null as OAuthTokens | null,
      state,
      redirect,
    };
  }
  const exchanged = await exchangeCode(meta, {
    clientId,
    clientSecret,
    code,
    verifier,
    redirectUri: options.redirectUri,
    resource: options.resource,
  });
  return {
    clientId,
    clientSecret,
    allowed,
    approved,
    tokens: exchanged.status === 200 ? exchanged.body : null,
    state,
    redirect,
    exchanged,
  };
}
