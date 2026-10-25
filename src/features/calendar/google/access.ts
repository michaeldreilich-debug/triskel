/**
 * Google-Konto in der Datenbank (#64, N1a) – nur im Server, immer mit dem Supabase-Client des
 * Nutzers (Sitzung der App oder später das KI-Token, N1d), nie service_role. Der Refresh-Token
 * liegt verschlüsselt in `google_accounts` (Migration 36); entschlüsselt wird er nur hier, und der
 * Zugriffs-Token, den Google dafür gibt, lebt nur im Speicher dieser Anfrage.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { type GoogleEndpoints, googleEndpoints, readGoogleConfig } from "./config";
import { openSecret, refreshTokenContext, sealSecret } from "./crypto";
import { type FetchDeps, GoogleAuthError, refreshAccessToken, revokeToken } from "./oauth";
import type { GoogleStatus } from "./types";

type Db = SupabaseClient<Database>;
type Env = Record<string, string | undefined>;

export interface AccessDeps extends FetchDeps {
  env?: Env;
}

export interface StoredAccount {
  email: string;
  refreshTokenEnc: string | null;
  scope: string;
  connectedAt: string;
}

/** Die lebende Zeile (ohne Papierkorb) – oder null. */
export async function readGoogleAccount(db: Db): Promise<StoredAccount | null> {
  const { data, error } = await db
    .from("google_accounts")
    .select("email, refresh_token_enc, scope, connected_at")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("Das Google-Konto ließ sich nicht laden.");
  if (!data) return null;
  return {
    email: data.email,
    refreshTokenEnc: data.refresh_token_enc,
    scope: data.scope,
    connectedAt: data.connected_at,
  };
}

/** Stand für Einstellungen › Kalender – fragt Google nicht, nennt nie den Token. */
export async function readGoogleStatus(db: Db, env?: Env): Promise<GoogleStatus> {
  const config = readGoogleConfig(env);
  const account = await readGoogleAccount(db);
  const connected = Boolean(account?.refreshTokenEnc);
  return {
    configured: config.ok,
    configError: config.ok ? null : config.error,
    connected,
    email: connected ? (account?.email ?? null) : null,
    connectedAt: connected ? (account?.connectedAt ?? null) : null,
  };
}

export type GoogleAccess =
  | { state: "not-configured"; error: string }
  | { state: "disconnected" }
  | { state: "reconnect"; email: string; error: string }
  | { state: "unavailable"; email: string; error: string }
  | {
      state: "connected";
      email: string;
      scope: string;
      /** nur für diese Anfrage – nie speichern, nie ausgeben */
      accessToken: string;
      endpoints: GoogleEndpoints;
    };

const KEY_CHANGED =
  "Der gespeicherte Google-Zugang passt nicht zum Schlüssel in Vercel – bitte neu verbinden.";

/**
 * Zugriff auf Google für diese Anfrage: Zugang lesen, entschlüsseln, frischen Zugriffs-Token
 * holen. Lehnt Google ab (widerrufen, abgelaufen; 400/401), heißt es „neu verbinden“.
 */
export async function getGoogleAccess(
  db: Db,
  userId: string,
  deps: AccessDeps = {},
): Promise<GoogleAccess> {
  const config = readGoogleConfig(deps.env);
  if (!config.ok) return { state: "not-configured", error: config.error };
  const account = await readGoogleAccount(db);
  if (!account?.refreshTokenEnc) return { state: "disconnected" };
  let refreshToken: string;
  try {
    refreshToken = openSecret(
      account.refreshTokenEnc,
      config.config.tokenKey,
      refreshTokenContext(userId),
    );
  } catch {
    return { state: "reconnect", email: account.email, error: KEY_CHANGED };
  }
  const endpoints = googleEndpoints(deps.env);
  try {
    const token = await refreshAccessToken(
      endpoints,
      { clientId: config.config.clientId, clientSecret: config.config.clientSecret, refreshToken },
      deps,
    );
    return {
      state: "connected",
      email: account.email,
      scope: account.scope,
      accessToken: token.accessToken,
      endpoints,
    };
  } catch (error) {
    if (!(error instanceof GoogleAuthError)) throw error;
    if (error.kind === "reconnect") {
      return { state: "reconnect", email: account.email, error: error.message };
    }
    if (error.kind === "config") return { state: "not-configured", error: error.message };
    return { state: "unavailable", email: account.email, error: error.message };
  }
}

/** Nach dem Verbinden: Zugang verschlüsselt ablegen (eine Zeile je Nutzer, Upsert). */
export async function saveGoogleAccount(
  db: Db,
  userId: string,
  account: { email: string; refreshToken: string; scope: string },
  tokenKey: Buffer,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await db.from("google_accounts").upsert(
    {
      user_id: userId,
      email: account.email.slice(0, 320),
      refresh_token_enc: sealSecret(account.refreshToken, tokenKey, refreshTokenContext(userId)),
      scope: account.scope.slice(0, 2000),
      connected_at: now.toISOString(),
      deleted_at: null,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("Der Google-Zugang ließ sich nicht speichern.");
}

/**
 * Trennen: bei Google widerrufen (wenn der Zugang lesbar ist), dann Token leeren und deleted_at
 * setzen – auch, wenn Google nicht antwortet. `revoked` sagt, ob Google den Widerruf bestätigt hat.
 */
export async function disconnectGoogleAccount(
  db: Db,
  userId: string,
  deps: AccessDeps = {},
  now: Date = new Date(),
): Promise<{ wasConnected: boolean; revoked: boolean }> {
  const account = await readGoogleAccount(db);
  if (!account) return { wasConnected: false, revoked: false };
  let revoked = false;
  const config = readGoogleConfig(deps.env);
  if (config.ok && account.refreshTokenEnc) {
    try {
      const refreshToken = openSecret(
        account.refreshTokenEnc,
        config.config.tokenKey,
        refreshTokenContext(userId),
      );
      revoked = await revokeToken(googleEndpoints(deps.env), refreshToken, deps);
    } catch {
      revoked = false;
    }
  }
  const { error } = await db
    .from("google_accounts")
    .update({ refresh_token_enc: null, deleted_at: now.toISOString() })
    .is("deleted_at", null);
  if (error) throw new Error("Das Google-Konto ließ sich nicht trennen.");
  return { wasConnected: Boolean(account.refreshTokenEnc), revoked };
}
