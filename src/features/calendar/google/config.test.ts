import { describe, expect, it } from "vitest";
import {
  APP_PRODUCTION_ORIGIN,
  GOOGLE_AUTH_URL,
  GOOGLE_CALENDAR_API,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  googleEndpoints,
  googleRedirectOrigin,
  readGoogleConfig,
} from "./config";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ID = "123-abc.apps.googleusercontent.com";
const env = (over: Record<string, string | undefined> = {}) => ({
  GOOGLE_CLIENT_ID: ID,
  GOOGLE_CLIENT_SECRET: "geheim",
  GOOGLE_TOKEN_KEY: KEY,
  ...over,
});

describe("Google-Zugang aus der Umgebung (Vercel)", () => {
  it("liest alle drei Werte und trimmt Leerraum und Zeilenumbrüche vom Kopieren", () => {
    const result = readGoogleConfig(
      env({
        GOOGLE_CLIENT_ID: `  ${ID}\n`,
        GOOGLE_CLIENT_SECRET: "\tgeheim \r\n",
        GOOGLE_TOKEN_KEY: `${KEY}\n`,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.clientId).toBe(ID);
    expect(result.config.clientSecret).toBe("geheim");
    expect(result.config.tokenKey).toEqual(Buffer.alloc(32, 7));
  });

  it("nimmt den Schlüssel auch als base64url und mit Umbruch in der Mitte", () => {
    const urlSafe = Buffer.alloc(32, 251).toString("base64url");
    const result = readGoogleConfig(
      env({ GOOGLE_TOKEN_KEY: `${urlSafe.slice(0, 20)}\n${urlSafe.slice(20)}` }),
    );
    expect(result.ok && result.config.tokenKey).toEqual(Buffer.alloc(32, 251));
  });

  it("fehlende oder leere Werte: „Google-Zugang in Vercel fehlt“ mit Namen, ohne Werte", () => {
    expect(readGoogleConfig({})).toEqual({
      ok: false,
      error:
        "Google-Zugang in Vercel fehlt (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY).",
    });
    const result = readGoogleConfig(env({ GOOGLE_CLIENT_SECRET: " \n" }));
    expect(result).toEqual({
      ok: false,
      error: "Google-Zugang in Vercel fehlt (GOOGLE_CLIENT_SECRET).",
    });
  });

  it("Schlüssel muss base64 sein und genau 32 Byte ergeben – die Meldung nennt den Wert nie", () => {
    for (const bad of [
      Buffer.alloc(16, 1).toString("base64"),
      Buffer.alloc(33, 1).toString("base64"),
      "kein base64!",
      "geheimer-text-mit-32-zeichen-xx",
    ]) {
      const result = readGoogleConfig(env({ GOOGLE_TOKEN_KEY: bad }));
      expect(result.ok, bad).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("GOOGLE_TOKEN_KEY");
        expect(result.error).toContain("32 Byte");
        expect(result.error).not.toContain(bad);
      }
    }
  });

  it("Client-ID muss wie eine Google-Client-ID aussehen (z. B. nicht der Schlüssel vertauscht)", () => {
    const result = readGoogleConfig(env({ GOOGLE_CLIENT_ID: "GOCSPX-vertauscht" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("GOOGLE_CLIENT_ID");
      expect(result.error).not.toContain("GOCSPX");
    }
  });
});

describe("Google-Adressen", () => {
  const fixed = {
    auth: GOOGLE_AUTH_URL,
    token: GOOGLE_TOKEN_URL,
    revoke: GOOGLE_REVOKE_URL,
    api: GOOGLE_CALENDAR_API,
  };
  const override = {
    GOOGLE_OAUTH_BASE: "http://localhost:3100/dev/google/oauth/",
    GOOGLE_API_BASE: "http://localhost:3100/dev/google/calendar/v3",
  };

  it("fest im Code: accounts.google.com, oauth2.googleapis.com, www.googleapis.com/calendar/v3", () => {
    expect(googleEndpoints({})).toEqual({
      auth: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      revoke: "https://oauth2.googleapis.com/revoke",
      api: "https://www.googleapis.com/calendar/v3",
    });
  });

  it("in Tests auf den Google-Ersatz umbiegbar", () => {
    expect(googleEndpoints({ NODE_ENV: "test", ...override })).toEqual({
      auth: "http://localhost:3100/dev/google/oauth/auth",
      token: "http://localhost:3100/dev/google/oauth/token",
      revoke: "http://localhost:3100/dev/google/oauth/revoke",
      api: "http://localhost:3100/dev/google/calendar/v3",
    });
  });

  it("in Entwicklung und Produktion wirkungslos; Unsinn wird ignoriert", () => {
    expect(googleEndpoints({ NODE_ENV: "production", ...override })).toEqual(fixed);
    expect(googleEndpoints({ NODE_ENV: "development", ...override })).toEqual(fixed);
    expect(
      googleEndpoints({
        NODE_ENV: "test",
        GOOGLE_OAUTH_BASE: "javascript:alert(1)",
        GOOGLE_API_BASE: "http://user:pw@evil.example/",
      }),
    ).toEqual(fixed);
  });
});

describe("Rücksprung der Anmeldung (G-2)", () => {
  it("in Produktion immer die feste Adresse – egal, welchen Host die Anfrage nennt", () => {
    expect(APP_PRODUCTION_ORIGIN).toBe("https://deine-app.vercel.app");
    for (const requestUrl of [
      "https://deine-app.vercel.app/api/google/start",
      "https://evil.example/api/google/start",
      "https://second-brain-app-git-main-alex.vercel.app/api/google/callback?code=x",
      "http://localhost:3000/api/google/start",
    ]) {
      expect(googleRedirectOrigin(requestUrl, { NODE_ENV: "production" })).toBe(
        APP_PRODUCTION_ORIGIN,
      );
    }
  });

  it("in Entwicklung und Tests der Ursprung der Anfrage (localhost, Google-Ersatz)", () => {
    expect(
      googleRedirectOrigin("http://localhost:3100/api/google/start", { NODE_ENV: "test" }),
    ).toBe("http://localhost:3100");
    expect(
      googleRedirectOrigin("http://localhost:3000/api/google/start", { NODE_ENV: "development" }),
    ).toBe("http://localhost:3000");
  });
});
