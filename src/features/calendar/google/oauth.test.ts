import { describe, expect, it } from "vitest";
import { googleEndpoints } from "./config";
import {
  buildAuthUrl,
  callbackUrl,
  exchangeCode,
  GOOGLE_SCOPES,
  GoogleAuthError,
  missingScopes,
  openOAuthState,
  pkceChallenge,
  randomToken,
  refreshAccessToken,
  revokeToken,
  safeEqual,
  sealOAuthState,
  settingsReturnUrl,
} from "./oauth";

const KEY = Buffer.alloc(32, 9);
const endpoints = googleEndpoints({});

const respond =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(body === undefined ? "" : JSON.stringify(body), { status });

describe("PKCE und state", () => {
  it("S256 nach RFC 7636 (Beispiel aus Anhang B)", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("Zufallswerte: 43 Zeichen base64url, jedes Mal neu", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, randomToken())).toBe(false);
    expect(safeEqual(a, a.slice(1))).toBe(false);
  });

  it("Anmelde-Cookie: verschlüsselt, nur mit dem Schlüssel lesbar, läuft ab, Manipulation → null", () => {
    const value = {
      state: randomToken(),
      verifier: randomToken(),
      userId: "00000000-0000-4000-8000-00000000000a",
      expires: 2_000,
    };
    const sealed = sealOAuthState(value, KEY);
    expect(sealed).not.toContain(value.state);
    expect(sealed).not.toContain(value.verifier);
    expect(openOAuthState(sealed, KEY, 1_000)).toEqual(value);
    expect(openOAuthState(sealed, KEY, 3_000)).toBeNull();
    expect(openOAuthState(sealed, Buffer.alloc(32, 1), 1_000)).toBeNull();
    expect(openOAuthState(`${sealed.slice(0, -2)}AA`, KEY, 1_000)).toBeNull();
    expect(openOAuthState(undefined, KEY)).toBeNull();
    expect(openOAuthState("x".repeat(3000), KEY)).toBeNull();
  });
});

describe("Anmelde-Adresse", () => {
  const url = new URL(
    buildAuthUrl(endpoints, {
      clientId: "id.apps.googleusercontent.com",
      redirectUri: callbackUrl("https://deine-app.vercel.app"),
      state: "s".repeat(43),
      challenge: "c".repeat(43),
    }),
  );

  it("geht an accounts.google.com mit Dauer-Zugang, Zustimmung, PKCE S256 – ohne Clientschlüssel", () => {
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "id.apps.googleusercontent.com",
      redirect_uri: "https://deine-app.vercel.app/api/google/callback",
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state: "s".repeat(43),
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
    });
  });

  it("nur die zwei Berechtigungen; fehlende werden erkannt", () => {
    expect(GOOGLE_SCOPES).toHaveLength(2);
    expect(missingScopes(GOOGLE_SCOPES.join(" "))).toEqual([]);
    expect(missingScopes(`openid ${GOOGLE_SCOPES[0]}`)).toEqual([GOOGLE_SCOPES[1]]);
    expect(missingScopes("")).toEqual([...GOOGLE_SCOPES]);
  });

  it("zurück nach Einstellungen › Kalender mit festem Code", () => {
    expect(
      settingsReturnUrl("https://app.example/api/google/callback?code=x", "verbunden").href,
    ).toBe("https://app.example/einstellungen?google=verbunden#kalender");
  });
});

describe("Token-Endpunkte: Fehler einordnen, nie Antworttexte weitergeben", () => {
  const params = {
    clientId: "id.apps.googleusercontent.com",
    clientSecret: "geheim",
    refreshToken: "1//alt",
  };

  it("Refresh abgelehnt (400/401, widerrufen/abgelaufen) → neu verbinden", async () => {
    for (const [status, body] of [
      [400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }],
      [401, { error: "unauthorized" }],
    ] as const) {
      const error = await refreshAccessToken(endpoints, params, {
        fetchImpl: respond(status, body),
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GoogleAuthError);
      expect((error as GoogleAuthError).kind).toBe("reconnect");
      expect((error as GoogleAuthError).message).not.toContain("expired or revoked");
    }
  });

  it("Client abgelehnt → Einrichtung prüfen; Serverfehler/Netz → nicht erreichbar", async () => {
    const config = await refreshAccessToken(endpoints, params, {
      fetchImpl: respond(401, { error: "invalid_client" }),
    }).catch((e: unknown) => e);
    expect((config as GoogleAuthError).kind).toBe("config");
    const server = await refreshAccessToken(endpoints, params, {
      fetchImpl: respond(503, null),
    }).catch((e: unknown) => e);
    expect((server as GoogleAuthError).kind).toBe("unavailable");
    const network = await refreshAccessToken(endpoints, params, {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }).catch((e: unknown) => e);
    expect((network as GoogleAuthError).kind).toBe("unavailable");
  });

  it("Code-Tausch schickt Verifier, Rücksprung und Client als Formular an den Token-Endpunkt", async () => {
    let seen: { url: string; body: string; type: string | null } | null = null;
    const result = await exchangeCode(
      endpoints,
      {
        clientId: "id.apps.googleusercontent.com",
        clientSecret: "geheim",
        code: "4/code",
        verifier: "v".repeat(43),
        redirectUri: "https://app.example/api/google/callback",
      },
      {
        fetchImpl: async (input, init) => {
          seen = {
            url: String(input),
            body: String(init?.body),
            type: new Headers(init?.headers).get("content-type"),
          };
          return new Response(
            JSON.stringify({ access_token: "ya29.x", refresh_token: "1//r", scope: "a b" }),
            { status: 200 },
          );
        },
      },
    );
    expect(result).toEqual({ accessToken: "ya29.x", refreshToken: "1//r", scope: "a b" });
    expect(seen).not.toBeNull();
    const s = seen as unknown as { url: string; body: string; type: string | null };
    expect(s.url).toBe("https://oauth2.googleapis.com/token");
    expect(s.type).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(s.body))).toEqual({
      grant_type: "authorization_code",
      code: "4/code",
      code_verifier: "v".repeat(43),
      redirect_uri: "https://app.example/api/google/callback",
      client_id: "id.apps.googleusercontent.com",
      client_secret: "geheim",
    });
  });

  it("Widerruf: bestätigt oder schon ungültig → true; Netz/Serverfehler → false", async () => {
    expect(await revokeToken(endpoints, "t", { fetchImpl: respond(200, {}) })).toBe(true);
    expect(
      await revokeToken(endpoints, "t", { fetchImpl: respond(400, { error: "invalid_token" }) }),
    ).toBe(true);
    expect(await revokeToken(endpoints, "t", { fetchImpl: respond(500, null) })).toBe(false);
    expect(
      await revokeToken(endpoints, "t", {
        fetchImpl: async () => {
          throw new TypeError("offline");
        },
      }),
    ).toBe(false);
  });
});
