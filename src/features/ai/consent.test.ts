import { describe, expect, it, vi } from "vitest";
import { createConsentApi, hostOf, safeRedirect } from "./consent";

describe("Freigabe: sichere Weiterleitung (#33)", () => {
  it("nur https, lokal http://localhost", () => {
    expect(safeRedirect("https://claude.ai/api/mcp/auth_callback?code=x")).toContain("claude.ai");
    expect(safeRedirect("http://localhost:3100/cb")).toBe("http://localhost:3100/cb");
    expect(safeRedirect("javascript:alert(1)")).toBeNull();
    expect(safeRedirect("http://evil.example/cb")).toBeNull();
    expect(safeRedirect("data:text/html,x")).toBeNull();
    expect(safeRedirect("")).toBeNull();
    expect(hostOf("https://chatgpt.com/connector_platform_oauth_redirect")).toBe("chatgpt.com");
  });

  it("Details, „schon erlaubt“ und Entscheidung über supabase-js; Erlauben gibt vorher frei", async () => {
    const calls: string[] = [];
    let existing: { id: string } | null = null;
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: (column: string, value: string) => ({
            maybeSingle: async () => {
              calls.push(`${table}:select:${column}=${value}`);
              return { data: existing, error: null };
            },
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          calls.push(`${table}:insert:${JSON.stringify(row)}`);
          return { error: null };
        },
        update: (row: Record<string, unknown>) => ({
          eq: async (column: string, value: string) => {
            calls.push(`${table}:update:${JSON.stringify(row)}:${column}=${value}`);
            return { error: null };
          },
        }),
      }),
      auth: {
        oauth: {
          getAuthorizationDetails: async (id: string) =>
            id === "neu"
              ? {
                  data: {
                    authorization_id: "neu",
                    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
                    client: { id: "c", name: " Claude ", uri: "https://claude.ai", logo_uri: "" },
                    user: { id: "u", email: "m@example.com" },
                    scope: "email profile",
                  },
                  error: null,
                }
              : { data: { redirect_url: "https://claude.ai/cb?code=1" }, error: null },
          approveAuthorization: async (id: string) => {
            calls.push(`approve:${id}`);
            return { data: { redirect_url: "https://claude.ai/cb?code=2" }, error: null };
          },
          denyAuthorization: async (id: string) => {
            calls.push(`deny:${id}`);
            return { data: { redirect_url: "javascript:alert(1)" }, error: null };
          },
        },
      },
    };
    const api = createConsentApi(client as never);
    const details = {
      authorizationId: "neu",
      clientId: "c",
      clientName: "Claude",
      clientUri: "https://claude.ai/",
      redirectHost: "claude.ai",
      scopes: ["email", "profile"],
    };
    expect(await api.load("neu")).toEqual({ kind: "details", details });
    expect(await api.load("alt")).toEqual({ kind: "redirect", url: "https://claude.ai/cb?code=1" });
    expect(await api.decide(details, true)).toBe("https://claude.ai/cb?code=2");
    await expect(api.decide(details, false)).rejects.toThrow(/Unerwartetes Ziel/);
    // nach „Trennen“ erneut erlaubt: dieselbe Zeile wieder öffnen
    existing = { id: "row-1" };
    await api.decide(details, true);
    expect(calls).toEqual([
      "ai_clients:select:client_id=c",
      'ai_clients:insert:{"client_id":"c","name":"Claude"}',
      "approve:neu",
      "deny:neu",
      "ai_clients:select:client_id=c",
      'ai_clients:update:{"name":"Claude","revoked_at":null,"deleted_at":null}:id=row-1',
      "approve:neu",
    ]);
  });

  it("schlägt die Freigabe fehl, wird nicht erlaubt", async () => {
    const approve = vi.fn();
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
        insert: async () => ({ error: { message: "new row violates row-level security policy" } }),
      }),
      auth: { oauth: { approveAuthorization: approve } },
    };
    const api = createConsentApi(client as never);
    await expect(
      api.decide(
        {
          authorizationId: "a",
          clientId: "c",
          clientName: "Claude",
          clientUri: null,
          redirectHost: null,
          scopes: [],
        },
        true,
      ),
    ).rejects.toThrow(/row-level security/);
    expect(approve).not.toHaveBeenCalled();
  });
});
