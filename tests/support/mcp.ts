/**
 * MCP-Server der Schaltzentrale im Test ohne HTTP: Client und Server über eine In-Memory-
 * Verbindung (#33). Für Werkzeug-Tests mit einem echten Supabase-Client (Integration) oder
 * einem Platzhalter (Werkzeugliste).
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { AiContext } from "@/features/ai/server/context";
import { createAiServer } from "@/features/ai/server/server";

export async function connectAi(ctx: AiContext) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createAiServer(ctx);
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  /** Werkzeug aufrufen; Text und Fehlerflag */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    return {
      text: content.map((c) => c.text ?? "").join("\n"),
      isError: result.isError === true,
      structured: result.structuredContent as Record<string, unknown> | undefined,
    };
  };
  return { client, server, call, close: () => client.close() };
}

/**
 * Supabase-Client einer aal2-Sitzung, der sich für `ai_client_allowed()` wie ein freigegebenes
 * KI-Token meldet. Die Sitzung hat keinen OAuth-Claim, die Datenbank sagt dort „nein“ – echte
 * Tokens prüft `oauth.test.ts`. Alles andere (RLS, Tabellen) bleibt unverändert.
 */
export function asAllowedAi<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === "rpc") {
        return (name: string, ...rest: unknown[]) =>
          name === "ai_client_allowed"
            ? Promise.resolve({ data: true, error: null })
            : (target as never as { rpc: (...a: unknown[]) => unknown }).rpc(name, ...rest);
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
