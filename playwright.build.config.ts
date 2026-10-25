import { defineConfig, devices } from "@playwright/test";
import { BUILD_DIST_DIR, BUILD_PORT } from "./tests/build/constants";
import { assertTestBackend } from "./tests/guard";

/**
 * Smoke-Test gegen den Produktions-Build (T-15): `next build && next start`, Desktop 1440 px.
 * Prüft, was `next dev` nie zeigt – die strenge Prod-CSP ohne 'unsafe-eval' (pdf.js, Mermaid,
 * heic-to) und den React-Produktions-Build. Aufruf: `npm run test:e2e:build`.
 *
 * Achtung: `next build`/`next start` laufen mit NODE_ENV=production und laden dann `.env.local`
 * (Prod) – der Build würde die Prod-Adresse fest einbauen. Next.js überschreibt aber keine
 * Variable, die schon in der Umgebung steht. Deshalb setzt diese Konfiguration die
 * Supabase-Variablen des Testprojekts ausdrücklich (tests/guard.ts bricht bei leerer oder
 * Prod-URL ab), und tests/build/build-smoke.spec.ts prüft, dass kein Chunk die Prod-Projekt-ID
 * enthält. Eigenes distDir und eigener Port: stört weder `npm run dev` (`.next`) noch
 * `npm run test:e2e` (Port 3100); nicht gleichzeitig mit `test:e2e` laufen lassen (gleiche
 * Sitzungsdatei, gemeinsamer Teardown).
 */
const backend = assertTestBackend();

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/build",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://localhost:${BUILD_PORT}`,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    // dieselbe Anmeldung und dasselbe Aufräumen wie in playwright.config.ts
    { name: "setup", testMatch: /e2e\/auth\.setup\.ts$/, teardown: "teardown" },
    { name: "teardown", testMatch: /e2e\/auth\.teardown\.ts$/ },
    {
      name: "build",
      dependencies: ["setup"],
      // eigener Smoke-Test + die Medien-Specs (Bilder, HEIC, Mermaid, PDF) unverändert im Build
      testMatch: [/build\/.*\.spec\.ts$/, /e2e\/(media|files)\.spec\.ts$/],
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npx next build && npx next start --port ${BUILD_PORT}`,
    url: `http://localhost:${BUILD_PORT}/login`,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: backend.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: backend.publishableKey,
      NEXT_DIST_DIR: BUILD_DIST_DIR,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
