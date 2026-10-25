/**
 * Integrationstests: Schutzschalter zuerst, dann Testnutzer A und B einmal je Lauf anmelden
 * (schont das Auth-Rate-Limit). Die Tokens gehen nur im Speicher an die Tests (provide/inject).
 */
import type { TestProject } from "vitest/node";
import { assertR2TestBucket, assertTestBackend } from "../guard";
import { signIn, type TestSession } from "../support/supabase-node";

declare module "vitest" {
  export interface ProvidedContext {
    sessionA: TestSession;
    sessionB: TestSession;
  }
}

export default async function setup(project: TestProject) {
  assertTestBackend();
  assertR2TestBucket();
  const [a, b] = await Promise.all([signIn("A"), signIn("B")]);
  if (a.userId === b.userId) throw new Error("Testnutzer A und B sind derselbe Nutzer.");
  project.provide("sessionA", a);
  project.provide("sessionB", b);
}
