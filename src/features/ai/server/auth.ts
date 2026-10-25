/**
 * Anmeldung der KI-Schnittstelle (#33, E27): Supabase ist der OAuth-2.1-Server, der Nutzer erlaubt
 * den Zugang einmal auf /ki-zugang (mit TOTP). Die MCP-Route nimmt nur OAuth-Tokens an (Claim
 * `client_id`) und fragt bei jeder Anfrage den Auth-Server, ob die Sitzung noch gilt, und die
 * Datenbank, ob der Zugang freigegeben ist (`ai_client_allowed`, Migration 21) – so greift
 * „Trennen“ in den Einstellungen sofort. Gearbeitet wird mit dem Token selbst: RLS gilt wie in
 * der App (aal2 oder freigegebener KI-Zugang), es gibt keinen service_role-Schlüssel.
 */
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthProtectedResourceMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import type { Db } from "./context";

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** Pfad der MCP-Schnittstelle in der App. */
export const MCP_PATH = "/api/mcp";

/** Supabase-Client, der mit dem Token des Nutzers spricht. */
export function userDb(config: SupabaseConfig, token: string): Db {
  return createClient<Database>(config.url, config.publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: NO_SESSION,
  });
}

/** Aussteller der Tokens: der Auth-Server des Supabase-Projekts. */
export const issuerOf = (config: SupabaseConfig) => `${new URL(config.url).origin}/auth/v1`;

/** Schutz-Metadaten (RFC 9728): wo Claude und ChatGPT sich anmelden. */
export function protectedResourceMetadata(
  config: SupabaseConfig,
  origin: string,
): OAuthProtectedResourceMetadata {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [issuerOf(config)],
    bearer_methods_supported: ["header"],
    resource_name: "Triskel",
  };
}

export interface AuthDeps {
  getClaims: (
    token: string,
  ) => Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }>;
  getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  /** Freigabe in der Datenbank: vertraulicher Client, freigegeben, nicht getrennt. */
  isAllowed: (token: string) => Promise<boolean>;
}

/** Prüfung eines Tokens: Signatur, Ablauf, OAuth-Client, Sitzung noch aktiv, freigegeben. */
export function createVerifier(deps: AuthDeps): OAuthTokenVerifier {
  const invalid = (message: string) => new OAuthError(OAuthErrorCode.InvalidToken, message);
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      // kaputte Tokens wirft supabase-js als Ausnahme statt als error → immer 401, nie 500
      const result = await deps.getClaims(token).catch((error: unknown) => ({ data: null, error }));
      const { data, error } = result;
      const claims = data?.claims;
      const sub = typeof claims?.sub === "string" ? claims.sub : "";
      if (error || !claims || !sub) throw invalid("Token ungültig oder abgelaufen");
      const clientId = typeof claims.client_id === "string" ? claims.client_id : "";
      if (!clientId) throw invalid("Nur Zugänge, die unter „KI-Zugang“ erlaubt wurden");
      const user = await deps
        .getUser(token)
        .catch((error: unknown) => ({ data: { user: null }, error }));
      if (user.error || user.data.user?.id !== sub)
        throw invalid("Zugang getrennt oder abgelaufen");
      const allowed = await deps.isAllowed(token).catch(() => false);
      if (!allowed) throw invalid("Zugang nicht freigegeben – bitte neu verbinden und erlauben");
      return {
        token,
        clientId,
        scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
        expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
        extra: { userId: sub, aal: claims.aal },
      };
    },
  };
}

/** Prüfung gegen den echten Auth-Server des Projekts. */
export function supabaseVerifier(config: SupabaseConfig): OAuthTokenVerifier {
  const auth = createClient(config.url, config.publishableKey, { auth: NO_SESSION }).auth;
  return createVerifier({
    getClaims: async (token) => {
      const result = await auth.getClaims(token);
      return {
        data: result.data ? { claims: result.data.claims as Record<string, unknown> } : null,
        error: result.error,
      };
    },
    getUser: (token) => auth.getUser(token),
    isAllowed: async (token) => {
      const { data, error } = await userDb(config, token).rpc("ai_client_allowed");
      return !error && data === true;
    },
  });
}
