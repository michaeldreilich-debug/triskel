/**
 * MCP-Schnittstelle (#33, E27) für Claude und ChatGPT: Streamable HTTP, zustandslos (je Anfrage
 * ein Server). Nur mit OAuth-Token aus dem Supabase-OAuth-Server; ohne Token 401 mit Verweis auf
 * die Schutz-Metadaten, damit der Client die Anmeldung findet.
 */
import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { MCP_PATH, supabaseVerifier, userDb } from "@/features/ai/server/auth";
import { createAiServer } from "@/features/ai/server/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler(
  ({ authInfo, requestInfo }) => {
    const config = getSupabaseConfig();
    const userId = authInfo?.extra?.userId;
    if (!config || !authInfo || typeof userId !== "string" || !requestInfo) {
      throw new Error("MCP ohne geprüfte Anmeldung aufgerufen");
    }
    return createAiServer({
      db: userDb(config, authInfo.token),
      userId,
      clientId: authInfo.clientId,
      origin: new URL(requestInfo.url).origin,
      now: () => new Date(),
    });
  },
  { legacy: "stateless" },
);

async function serve(request: Request): Promise<Response> {
  const config = getSupabaseConfig();
  if (!config) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  const gate = requireBearerAuth({
    verifier: supabaseVerifier(config),
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      new URL(MCP_PATH, new URL(request.url).origin),
    ),
  });
  const auth = await gate(request);
  if (auth instanceof Response) return auth;
  return handler.fetch(request, { authInfo: auth });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
