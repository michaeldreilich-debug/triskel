/**
 * Erkennungs-Dokumente für MCP-Clients (#33): Schutz-Metadaten (RFC 9728) unter
 * /.well-known/oauth-protected-resource[/api/mcp] und – für ältere Clients, die am Ursprung der
 * Schnittstelle suchen – die Metadaten des Supabase-Auth-Servers (RFC 8414) unverändert.
 */
import { getSupabaseConfig } from "@/lib/supabase/config";
import { protectedResourceMetadata } from "./auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};

const unavailable = () =>
  Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: CORS });

export const wellKnownOptions = () => new Response(null, { status: 204, headers: CORS });

export function protectedResourceResponse(request: Request): Response {
  const config = getSupabaseConfig();
  if (!config) return unavailable();
  return Response.json(protectedResourceMetadata(config, new URL(request.url).origin), {
    headers: { ...CORS, "Cache-Control": "public, max-age=3600" },
  });
}

export async function authorizationServerResponse(): Promise<Response> {
  const config = getSupabaseConfig();
  if (!config) return unavailable();
  const origin = new URL(config.url).origin;
  const upstream = await fetch(`${origin}/.well-known/oauth-authorization-server/auth/v1`, {
    next: { revalidate: 3600 },
  });
  if (!upstream.ok) return unavailable();
  return Response.json(await upstream.json(), {
    headers: { ...CORS, "Cache-Control": "public, max-age=3600" },
  });
}
