/**
 * Sitzungen für E2E-Tests von Testnutzer A – ohne zusätzliche Anmeldungen (Auth-Rate-Limit):
 * Alles baut auf der einen Sitzung aus `auth.setup.ts` auf (Datei AUTH_FILE).
 *
 * `validUntil`: Ablauf der Sitzung, wie ihn der Browser sieht (Sekunden). Für Tests mit
 * `page.clock` in der Zukunft: Sonst erneuert supabase-js bei jedem Laden das Token und läuft
 * unter Last ins Rate-Limit (429). Der Server prüft weiterhin den echten Ablauf im Token.
 */
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { assertTestBackend } from "../../guard";
import { totpCode } from "../../support/totp";
import { AUTH_FILE } from "./auth";

type Jar = Map<string, string>;

function serverClient(jar: Jar) {
  const env = assertTestBackend();
  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
}

const toCookies = (jar: Jar, baseURL: string) => [
  ...[...jar].map(([name, value]) => ({ name, value, url: baseURL, sameSite: "Lax" as const })),
  // Gerätewerte gesetzt: nie Theme/Bereich anderer Tests übernehmen
  { name: "sz-theme", value: "dark", url: baseURL, sameSite: "Lax" as const },
  { name: "sz-area", value: "", url: baseURL, sameSite: "Lax" as const },
];

/**
 * Neue Anmeldung per API (nur auth.setup: einmal je Lauf): Passwort, dann TOTP-Code (B16).
 * `aal: "aal1"` hört nach dem Passwort auf – für Tests der MFA-Abfrage.
 */
export async function sessionCookies(
  baseURL: string,
  { aal = "aal2" }: { aal?: "aal1" | "aal2" } = {},
) {
  const env = assertTestBackend();
  const jar: Jar = new Map();
  const client = serverClient(jar);
  const { error } = await client.auth.signInWithPassword({
    email: env.userA.email,
    password: env.userA.password,
  });
  if (error) throw new Error(`Testnutzer A: Anmeldung fehlgeschlagen (${error.code ?? "?"}).`);
  if (aal === "aal2") {
    const { data: factors } = await client.auth.mfa.listFactors();
    const factorId = factors?.totp[0]?.id;
    if (!factorId) throw new Error("Testnutzer A hat keinen TOTP-Faktor (scripts/test-totp.mjs).");
    const { error: mfaError } = await client.auth.mfa.challengeAndVerify({
      factorId,
      code: totpCode(env.userA.totpSecret),
    });
    if (mfaError)
      throw new Error(`Testnutzer A: zweiter Faktor abgelehnt (${mfaError.code ?? "?"}).`);
  }
  await expect.poll(() => jar.size, { message: "Sitzungs-Cookies fehlen" }).toBeGreaterThan(0);
  return toCookies(jar, baseURL);
}

/** Sitzungs-Cookies aus AUTH_FILE (ohne Netz), auf Wunsch mit späterem Ablauf. */
function storedJar(): Jar {
  const state = JSON.parse(readFileSync(AUTH_FILE, "utf8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return new Map(
    state.cookies.filter((c) => c.name.startsWith("sb-")).map((c) => [c.name, c.value]),
  );
}

/** Zugriffstoken der gespeicherten Sitzung (für Testdaten per API). */
export async function storedAccessToken(): Promise<{ accessToken: string; userId: string }> {
  const { data, error } = await serverClient(storedJar()).auth.getSession();
  if (error || !data.session) throw new Error("Gespeicherte Sitzung von Testnutzer A fehlt.");
  return { accessToken: data.session.access_token, userId: data.session.user.id };
}

/** Sitzungs-Cookie von @supabase/ssr lesen bzw. schreiben („base64-“ + JSON, ggf. in Stücken). */
const CHUNK = 3180;

function readSession(jar: Jar): { key: string; session: Record<string, unknown> } {
  const names = [...jar.keys()].filter((n) => /^sb-.+-auth-token(\.\d+)?$/.test(n));
  const key = (names[0] ?? "").replace(/\.\d+$/, "");
  const raw = jar.has(key)
    ? (jar.get(key) as string)
    : names
        .filter((n) => n.startsWith(`${key}.`))
        .sort((a, b) => Number(a.split(".").pop()) - Number(b.split(".").pop()))
        .map((n) => jar.get(n))
        .join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString() : raw;
  return { key, session: JSON.parse(json) as Record<string, unknown> };
}

function writeSession(jar: Jar, key: string, session: Record<string, unknown>) {
  for (const name of [...jar.keys()])
    if (name === key || name.startsWith(`${key}.`)) jar.delete(name);
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  if (value.length <= CHUNK) jar.set(key, value);
  else
    for (let i = 0; i * CHUNK < value.length; i++)
      jar.set(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
}

/** Neuer Kontext mit der gespeicherten Sitzung; `clockUntil` = späteste simulierte Uhrzeit. */
export async function freshContext(
  browser: Browser,
  baseURL: string,
  options: Parameters<Browser["newContext"]>[0] & { clockUntil?: Date } = {},
): Promise<BrowserContext> {
  const { clockUntil, ...contextOptions } = options;
  const jar = storedJar();
  if (clockUntil) {
    const { key, session } = readSession(jar);
    writeSession(jar, key, {
      ...session,
      expires_at: Math.floor(clockUntil.getTime() / 1000) + 86_400,
    });
  }
  const context = await browser.newContext({ baseURL, ...contextOptions });
  await context.addCookies(toCookies(jar, baseURL));
  return context;
}
