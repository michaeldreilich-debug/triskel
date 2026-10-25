/**
 * Test-Schutzschalter: Tests dürfen NIE gegen das Prod-Projekt laufen.
 *
 * - `checkTestTarget` ist die reine Prüflogik (scripts/lib/guard.mjs, gemeinsam mit den Skripten;
 *   Unit-getestet in tests/unit/guard.test.ts).
 * - `assertTestBackend` wird von jedem Test aufgerufen, der Supabase braucht
 *   (Integrationstests, E2E mit Backend). Er bricht ab, wenn die Test-URL leer ist oder
 *   auf das Prod-Projekt zeigt.
 * - `assertNotProduction` läuft beim Laden der Playwright-Konfiguration: Der Testserver
 *   startet nie mit Prod-Zugangsdaten. (Eine leere Test-URL ist dort erlaubt, damit Tests
 *   ohne Backend – /login, /dev/* – laufen können.)
 */

import { checkTestTarget } from "../scripts/lib/guard.mjs";
import { PROD_BUCKET } from "../src/features/storage/config";
import { readEnvFile } from "./support/env-file";

// Prüflogik gemeinsam mit den Skripten (scripts/lib/guard.mjs, T-1)
export {
  checkSameProject,
  checkTestTarget,
  type GuardResult,
  projectRefFromDbUrl,
  projectRefFromUrl,
  type SupabaseTarget,
} from "../scripts/lib/guard.mjs";

export interface TestBackendEnv {
  url: string;
  publishableKey: string;
  dbUrl: string;
  userA: TestUser;
  userB: TestUser;
}

export interface TestUser {
  email: string;
  password: string;
  /** TOTP-Geheimnis (Base32) des zweiten Faktors, B16 */
  totpSecret: string;
}

function readTargets() {
  const test = readEnvFile(".env.test.local");
  const prod = readEnvFile(".env.local");
  return {
    test,
    testTarget: { url: test.NEXT_PUBLIC_SUPABASE_URL, dbUrl: test.SUPABASE_DB_URL },
    prodTarget: { url: prod.NEXT_PUBLIC_SUPABASE_URL, dbUrl: prod.SUPABASE_DB_URL },
  };
}

/** Für Tests mit Backend: bricht bei leerer oder Prod-URL ab. */
export function assertTestBackend(): TestBackendEnv {
  const { test, testTarget, prodTarget } = readTargets();
  const result = checkTestTarget(testTarget, prodTarget);
  if (!result.ok) throw new Error(result.reason);
  if (!test.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Test-Schutzschalter: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Test) ist leer.");
  }
  return {
    url: test.NEXT_PUBLIC_SUPABASE_URL as string,
    publishableKey: test.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    dbUrl: test.SUPABASE_DB_URL ?? "",
    userA: {
      email: test.E2E_USER_A_EMAIL ?? "",
      password: test.E2E_USER_A_PASSWORD ?? "",
      totpSecret: test.E2E_USER_A_TOTP_SECRET ?? "",
    },
    userB: {
      email: test.E2E_USER_B_EMAIL ?? "",
      password: test.E2E_USER_B_PASSWORD ?? "",
      totpSecret: test.E2E_USER_B_TOTP_SECRET ?? "",
    },
  };
}

/**
 * Für den Playwright-Testserver: liefert die Supabase-Variablen des Testprojekts
 * (leer, wenn nicht konfiguriert) und bricht ab, sobald sie auf Prod zeigen.
 */
export function assertNotProduction(): Record<string, string> {
  const { test, testTarget, prodTarget } = readTargets();
  if (testTarget.url?.trim()) {
    const result = checkTestTarget(testTarget, prodTarget);
    if (!result.ok) throw new Error(result.reason);
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: test.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: test.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  };
}

const R2_NAMES = [
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

/**
 * R2-Werte des Test-Buckets aus `.env.test.local` (E41). Bricht ab, wenn `R2_BUCKET` der
 * Prod-Bucket ist. Leer, wenn R2 im Test nicht eingerichtet ist (Routen antworten dann 503).
 */
export function assertR2TestBucket(): Record<string, string> {
  const { test } = readTargets();
  if ((test.R2_BUCKET ?? "").trim() === PROD_BUCKET) {
    throw new Error(
      "Test-Schutzschalter: R2_BUCKET in .env.test.local ist der Prod-Bucket (triskel-dateien).",
    );
  }
  const values: Record<string, string> = {};
  for (const name of R2_NAMES) values[name] = (test[name] ?? "").trim();
  return values;
}
