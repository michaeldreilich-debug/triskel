/**
 * Supabase-Clients für Integrationstests (Node) – ausschließlich gegen das Testprojekt.
 * Jeder Zugriff läuft über assertTestBackend() (Schutzschalter). Zugangsdaten werden nie
 * ausgegeben; Sitzungen leben nur im Speicher (persistSession: false).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { assertTestBackend } from "../guard";
import { totpCode } from "./totp";

export type Db = SupabaseClient<Database>;

export interface TestSession {
  userId: string;
  /** Token nach bestätigtem zweitem Faktor (aal2) – damit laufen alle Datentests */
  accessToken: string;
  /** Token derselben Anmeldung vor dem zweiten Faktor (nur Passwort, aal1) – Gegentest E17 */
  aal1AccessToken: string;
}

const NO_PERSIST = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** Client ohne Anmeldung (Rolle anon, nur publishable key). */
export function anonClient(): Db {
  const env = assertTestBackend();
  return createClient<Database>(env.url, env.publishableKey, { auth: NO_PERSIST });
}

/**
 * Client als angemeldeter Testnutzer (aal2-Zugriffstoken aus signIn). `fetch`: z. B.
 * `retryingFetch()` für E2E-Testdaten (wiederholt nur einen gescheiterten Verbindungsaufbau).
 */
export function userClient(
  session: Pick<TestSession, "accessToken">,
  options: { fetch?: typeof fetch } = {},
): Db {
  const env = assertTestBackend();
  return createClient<Database>(env.url, env.publishableKey, {
    accessToken: async () => session.accessToken,
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  });
}

/** Client als Testnutzer nur mit Passwort (aal1) – darf nach Migration 13 nichts sehen. */
export function aal1Client(session: TestSession): Db {
  return userClient({ accessToken: session.aal1AccessToken });
}

/**
 * Testnutzer A oder B anmelden: Passwort, dann TOTP-Code (B16) – eine Anmeldung je Aufruf.
 * Zugangsdaten und Geheimnis aus .env.test.local; nichts davon erscheint in Meldungen.
 */
export async function signIn(which: "A" | "B"): Promise<TestSession> {
  const env = assertTestBackend();
  const user = which === "A" ? env.userA : env.userB;
  if (!user.email || !user.password) {
    throw new Error(`Testnutzer ${which}: E-Mail/Passwort fehlen in .env.test.local.`);
  }
  const client = createClient<Database>(env.url, env.publishableKey, { auth: NO_PERSIST });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) {
    // keine Zugangsdaten in der Meldung
    throw new Error(
      `Testnutzer ${which} kann sich nicht anmelden (${error?.code ?? "ohne Sitzung"}). ` +
        "Pausiert das Testprojekt (7 Tage ohne Nutzung)? Dann im Supabase-Dashboard fortsetzen.",
    );
  }
  const aal1AccessToken = data.session.access_token;
  const { data: factors, error: factorError } = await client.auth.mfa.listFactors();
  const factorId = factors?.totp[0]?.id;
  if (factorError || !factorId) {
    throw new Error(
      `Testnutzer ${which} hat keinen TOTP-Faktor (${factorError?.code ?? "keiner"}) – ` +
        "`node scripts/test-totp.mjs` ausführen.",
    );
  }
  const { data: verified, error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId,
    code: totpCode(user.totpSecret),
  });
  if (verifyError || !verified) {
    throw new Error(
      `Testnutzer ${which}: zweiter Faktor abgelehnt (${verifyError?.code ?? "?"}). ` +
        "Stimmt das Geheimnis in .env.test.local? Prüfen mit `node scripts/test-totp.mjs`.",
    );
  }
  return {
    userId: data.session.user.id,
    accessToken: verified.access_token,
    aal1AccessToken,
  };
}

/** Kurzer, eindeutiger Marker für Testdaten eines Laufs. */
export function runMarker(): string {
  return `it-${crypto.randomUUID().slice(0, 8)}`;
}
