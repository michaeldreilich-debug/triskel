/**
 * Google-Konto in der Datenbank: Zugang lesen, entschlüsseln, auffrischen, speichern, trennen –
 * mit einer Datenbank-Attrappe und dem Google-Ersatz statt Google.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import {
  disconnectGoogleAccount,
  getGoogleAccess,
  readGoogleStatus,
  saveGoogleAccount,
} from "./access";
import { listGoogleCalendars } from "./calendar-api";
import { googleEndpoints } from "./config";
import { openSecret, refreshTokenContext, sealSecret } from "./crypto";
import { handleFakeGoogle, resetFakeGoogle } from "./fake";
import { buildAuthUrl, exchangeCode, pkceChallenge, randomToken } from "./oauth";

const USER = "00000000-0000-4000-8000-00000000000a";
const ORIGIN = "http://fake.test";
const KEY = Buffer.alloc(32, 5);
const env = {
  NODE_ENV: "test",
  GOOGLE_CLIENT_ID: "e2e.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "e2e-geheim",
  GOOGLE_TOKEN_KEY: KEY.toString("base64"),
  GOOGLE_OAUTH_BASE: `${ORIGIN}/dev/google/oauth`,
  GOOGLE_API_BASE: `${ORIGIN}/dev/google/calendar/v3`,
};
const fetchImpl: typeof fetch = async (input, init) =>
  handleFakeGoogle(new Request(input instanceof URL ? input.href : String(input), init), env);
const deps = { env, fetchImpl };

interface Row {
  email: string;
  refresh_token_enc: string | null;
  scope: string;
  connected_at: string;
}

/** Datenbank-Attrappe für google_accounts (nur, was access.ts aufruft). */
function fakeDb(row: Row | null) {
  const writes: Array<{ op: string; values: Record<string, unknown>; options?: unknown }> = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe("google_accounts");
      return {
        select: (columns: string) => {
          expect(columns).toBe("email, refresh_token_enc, scope, connected_at");
          return { is: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) };
        },
        update: (values: Record<string, unknown>) => ({
          is: async () => {
            writes.push({ op: "update", values });
            return { error: null };
          },
        }),
        upsert: async (values: Record<string, unknown>, options: unknown) => {
          writes.push({ op: "upsert", values, options });
          return { error: null };
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, writes };
}

/** Echte Anmeldung beim Google-Ersatz → Refresh-Token. */
async function refreshTokenFromFake(): Promise<string> {
  const endpoints = googleEndpoints(env);
  const verifier = randomToken();
  const redirectUri = `${ORIGIN}/api/google/callback`;
  const auth = await fetchImpl(
    buildAuthUrl(endpoints, {
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri,
      state: randomToken(),
      challenge: pkceChallenge(verifier),
    }),
  );
  const code = new URL(auth.headers.get("location") as string).searchParams.get("code") as string;
  const tokens = await exchangeCode(
    endpoints,
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      code,
      verifier,
      redirectUri,
    },
    { fetchImpl },
  );
  return tokens.refreshToken as string;
}

const stored = (refreshToken: string, userId = USER): Row => ({
  email: "e2e-alex@example.com",
  refresh_token_enc: sealSecret(refreshToken, KEY, refreshTokenContext(userId)),
  scope: "s",
  connected_at: "2026-10-18T20:00:00.000Z",
});

beforeEach(() => resetFakeGoogle());

describe("Zugang für eine Anfrage (getGoogleAccess)", () => {
  it("verbunden: entschlüsselt, frischer Zugriffs-Token taugt für die Kalenderliste", async () => {
    const { db } = fakeDb(stored(await refreshTokenFromFake()));
    const access = await getGoogleAccess(db, USER, deps);
    expect(access.state).toBe("connected");
    if (access.state !== "connected") return;
    expect(access.email).toBe("e2e-alex@example.com");
    const calendars = await listGoogleCalendars(access.endpoints, access.accessToken, {
      fetchImpl,
    });
    expect(calendars.map((c) => c.id)).toContain("e2e-alex@example.com");
  });

  it("nicht eingerichtet, nicht verbunden, getrennt", async () => {
    expect(await getGoogleAccess(fakeDb(null).db, USER, { ...deps, env: {} })).toEqual({
      state: "not-configured",
      error:
        "Google-Zugang in Vercel fehlt (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY).",
    });
    expect(await getGoogleAccess(fakeDb(null).db, USER, deps)).toEqual({ state: "disconnected" });
    const disconnected = { ...stored("x"), refresh_token_enc: null };
    expect(await getGoogleAccess(fakeDb(disconnected).db, USER, deps)).toEqual({
      state: "disconnected",
    });
  });

  it("in Google widerrufen → neu verbinden", async () => {
    const { db } = fakeDb(stored(await refreshTokenFromFake()));
    await fetchImpl(`${ORIGIN}/dev/google/_test/revoke-all`, { method: "POST" });
    const access = await getGoogleAccess(db, USER, deps);
    expect(access).toMatchObject({ state: "reconnect", email: "e2e-alex@example.com" });
  });

  it("Schlüssel in Vercel neu oder Token einer anderen Zeile → neu verbinden, nie eine Ausnahme", async () => {
    const token = await refreshTokenFromFake();
    const otherUser = fakeDb(stored(token, "00000000-0000-4000-8000-00000000000b"));
    expect((await getGoogleAccess(otherUser.db, USER, deps)).state).toBe("reconnect");
    const otherKey = fakeDb(stored(token));
    const access = await getGoogleAccess(otherKey.db, USER, {
      ...deps,
      env: { ...env, GOOGLE_TOKEN_KEY: Buffer.alloc(32, 6).toString("base64") },
    });
    expect(access.state).toBe("reconnect");
  });
});

describe("Speichern, Stand, Trennen", () => {
  it("speichert den Refresh-Token nur verschlüsselt (Upsert je Nutzer)", async () => {
    const { db, writes } = fakeDb(null);
    await saveGoogleAccount(
      db,
      USER,
      { email: "e2e-alex@example.com", refreshToken: "1//klartext", scope: "a b" },
      KEY,
      new Date("2026-10-18T20:00:00Z"),
    );
    expect(writes).toHaveLength(1);
    const [write] = writes;
    expect(write?.op).toBe("upsert");
    expect(write?.options).toEqual({ onConflict: "user_id" });
    expect(JSON.stringify(write?.values)).not.toContain("klartext");
    const values = write?.values as Record<string, string | null>;
    expect(values).toMatchObject({
      user_id: USER,
      email: "e2e-alex@example.com",
      scope: "a b",
      connected_at: "2026-10-18T20:00:00.000Z",
      deleted_at: null,
    });
    expect(openSecret(values.refresh_token_enc as string, KEY, refreshTokenContext(USER))).toBe(
      "1//klartext",
    );
  });

  it("Stand nennt E-Mail und Einrichtung, nie den Token", async () => {
    const row = stored("1//geheim");
    const status = await readGoogleStatus(fakeDb(row).db, env);
    expect(status).toEqual({
      configured: true,
      configError: null,
      connected: true,
      email: "e2e-alex@example.com",
      connectedAt: "2026-10-18T20:00:00.000Z",
    });
    expect(JSON.stringify(status)).not.toContain(row.refresh_token_enc as string);
    expect(await readGoogleStatus(fakeDb(null).db, { GOOGLE_CLIENT_ID: "x" })).toMatchObject({
      configured: false,
      connected: false,
      email: null,
    });
  });

  it("Trennen widerruft bei Google und leert Token + setzt deleted_at", async () => {
    const { db, writes } = fakeDb(stored(await refreshTokenFromFake()));
    const result = await disconnectGoogleAccount(db, USER, deps, new Date("2026-10-18T21:00:00Z"));
    expect(result).toEqual({ wasConnected: true, revoked: true });
    expect(writes).toEqual([
      {
        op: "update",
        values: { refresh_token_enc: null, deleted_at: "2026-10-18T21:00:00.000Z" },
      },
    ]);
    const state = await (await fetchImpl(`${ORIGIN}/dev/google/_test/state`)).json();
    expect(state).toMatchObject({ refreshTokens: { live: 0, revoked: 1 } });
  });

  it("Trennen leert auch, wenn Google nicht antwortet oder der Schlüssel fehlt", async () => {
    const offline = fakeDb(stored("1//egal"));
    const result = await disconnectGoogleAccount(offline.db, USER, {
      env,
      fetchImpl: async () => {
        throw new TypeError("offline");
      },
    });
    expect(result).toEqual({ wasConnected: true, revoked: false });
    expect(offline.writes[0]?.values.refresh_token_enc).toBeNull();
    const noKey = fakeDb(stored("1//egal"));
    expect(await disconnectGoogleAccount(noKey.db, USER, { env: {} })).toEqual({
      wasConnected: true,
      revoked: false,
    });
    expect(noKey.writes).toHaveLength(1);
    expect(await disconnectGoogleAccount(fakeDb(null).db, USER, deps)).toEqual({
      wasConnected: false,
      revoked: false,
    });
  });
});
