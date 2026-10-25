import { OAuthError } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { type AuthDeps, createVerifier, protectedResourceMetadata } from "./auth";

const claims = {
  sub: "user-1",
  client_id: "client-1",
  exp: 2_000_000_000,
  aal: "aal1",
  scope: "email",
};
const deps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
  getClaims: async () => ({ data: { claims }, error: null }),
  getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
  isAllowed: async () => true,
  ...over,
});

describe("Token-Prüfung der KI-Schnittstelle (#33)", () => {
  it("nimmt ein gültiges OAuth-Token an", async () => {
    const info = await createVerifier(deps()).verifyAccessToken("t");
    expect(info).toMatchObject({
      token: "t",
      clientId: "client-1",
      scopes: ["email"],
      expiresAt: 2_000_000_000,
      extra: { userId: "user-1", aal: "aal1" },
    });
  });

  it("lehnt Sitzungs-Tokens der App ab (ohne client_id)", async () => {
    const verifier = createVerifier(
      deps({
        getClaims: async () => ({
          data: { claims: { ...claims, client_id: undefined } },
          error: null,
        }),
      }),
    );
    await expect(verifier.verifyAccessToken("t")).rejects.toBeInstanceOf(OAuthError);
  });

  it("lehnt getrennte Zugänge sofort ab (Auth-Server kennt die Sitzung nicht mehr)", async () => {
    const verifier = createVerifier(
      deps({
        getUser: async () => ({ data: { user: null }, error: new Error("session_not_found") }),
      }),
    );
    await expect(verifier.verifyAccessToken("t")).rejects.toThrow(/getrennt/);
  });

  it("lehnt Zugänge ohne Freigabe ab (nicht erlaubt, getrennt, öffentlicher Client)", async () => {
    const verifier = createVerifier(deps({ isAllowed: async () => false }));
    await expect(verifier.verifyAccessToken("t")).rejects.toThrow(/nicht freigegeben/);
    const failing = createVerifier(
      deps({
        isAllowed: async () => {
          throw new Error("network");
        },
      }),
    );
    await expect(failing.verifyAccessToken("t")).rejects.toBeInstanceOf(OAuthError);
  });

  it("lehnt ungültige Signaturen ab", async () => {
    const verifier = createVerifier(
      deps({ getClaims: async () => ({ data: null, error: new Error("invalid") }) }),
    );
    await expect(verifier.verifyAccessToken("t")).rejects.toThrow(/ungültig/);
  });

  it("kaputte Tokens (Ausnahme in supabase-js) → 401, nicht 500", async () => {
    const verifier = createVerifier(
      deps({
        getClaims: async () => {
          throw new Error("Invalid JWT structure");
        },
      }),
    );
    await expect(verifier.verifyAccessToken("abc")).rejects.toBeInstanceOf(OAuthError);
  });

  it("Schutz-Metadaten zeigen auf den Supabase-Auth-Server", () => {
    const meta = protectedResourceMetadata(
      { url: "https://abc.supabase.co", publishableKey: "pk" },
      "https://app.example",
    );
    expect(meta).toEqual({
      resource: "https://app.example/api/mcp",
      authorization_servers: ["https://abc.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
      resource_name: "Triskel",
    });
  });
});
