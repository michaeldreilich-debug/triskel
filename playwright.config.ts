import { defineConfig, devices } from "@playwright/test";
import { assertNotProduction, assertR2TestBucket } from "./tests/guard";

/**
 * E2E-Tests: Desktop 1440 px + Mobil 390 px.
 *
 * Der Testserver läuft mit NODE_ENV=test: Next.js lädt dann `.env.test.local`, aber nie
 * `.env.local` (Prod). Zusätzlich setzt die Konfiguration die Supabase-Variablen explizit aus
 * `.env.test.local` und bricht ab, falls sie auf Prod zeigen (tests/guard.ts).
 * Tests mit Anmeldung nutzen die Sitzung aus `auth.setup.ts` (Testnutzer A, Testprojekt).
 * Eigenes distDir, damit ein parallel laufendes `npm run dev` nicht stört.
 */
const PORT = 3100;
const supabaseEnv = assertNotProduction();
// R2-Test-Bucket (E41): vier Werte aus .env.test.local, Abbruch beim Prod-Bucket
const r2Env = assertR2TestBucket();

export default defineConfig({
  testDir: "tests/e2e",
  // lokale Hilfs-Specs (Bildschirmfotos u. Ä., nicht im Repo) laufen nie mit (T-6)
  testIgnore: /zz-.*\.spec\.ts$/,
  fullyParallel: true,
  // 4 statt „halbe Kernzahl“ (7 auf dem Mac, N4): Unter Dauerlast lehnte das kostenlose
  // Supabase-Testprojekt (Cloudflare davor) alle Verbindungen dieses Rechners für 5–30 s ab
  // (ECONNREFUSED in Browser, Testserver und Seeds zugleich) und PostgREST stockte 2–12 s –
  // gemessen mit einer Sonde neben dem Lauf. Weniger gleichzeitige Seiten = weniger Spitzenlast;
  // zwei Gesamtläufe direkt hintereinander besser mit ~3 min Pause.
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  // 12 s statt 7 s (N4): Die Daten kommen direkt vom entfernten Testprojekt. Neben dem Lauf
  // gemessen: PostgREST-Stockungen bis 12 s und Netz-Aussetzer (Verbindungsaufbau 5 s, laufende
  // Verbindungen hängen in TCP-Wiederholungen), danach geht es weiter. Grüne Läufe werden nicht
  // langsamer; nur ein echter Fehler meldet sich später. Hängende Klicks brechen nach 20 s mit
  // dem Element ab statt erst am Test-Zeitlimit.
  expect: { timeout: 12_000 },
  use: {
    actionTimeout: 20_000,
    baseURL: `http://localhost:${PORT}`,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    // Keine Traces: Sie enthielten Netzwerkverkehr mit Sitzung und E-Mail des Testnutzers.
    // Zur Fehlersuche gibt es Screenshots und den Fehlerkontext.
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    // Anmeldung von Testnutzer A einmal je Lauf (per API), danach Aufräumen im Testprojekt
    { name: "setup", testMatch: /auth\.setup\.ts$/, teardown: "teardown" },
    { name: "teardown", testMatch: /auth\.teardown\.ts$/ },
    // Tests mit @desktop bzw. @mobile im Titel laufen nur im passenden Viewport
    {
      name: "desktop",
      dependencies: ["setup"],
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    // 390 px mit Touch, aber ohne Android-User-Agent: Damit schaltet ProseMirror auf seinen
    // Android-Eingabepfad (Enter über Composition-Events), den synthetische Tasten nicht
    // nachbilden. Echte iPhone-Prüfung: siehe docs/session-log.md.
    {
      name: "mobile",
      dependencies: ["setup"],
      grepInvert: /@desktop/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...supabaseEnv,
      ...r2Env,
      NODE_ENV: "test",
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_TELEMETRY_DISABLED: "1",
      // keine Next-Entwickler-Anzeige über Knöpfen unten rechts (next.config.ts)
      E2E_NO_DEV_INDICATOR: "1",
      // Kalender-Tests lesen die eigene Test-ICS unter /dev/ics statt eines echten Google-Kalenders
      CALENDAR_ALLOWED_ORIGINS: `http://localhost:${PORT}`,
      // Google-Termine (#64): feste Test-Werte, keine echten Zugangsdaten. Mit NODE_ENV=test biegen
      // GOOGLE_OAUTH_BASE/GOOGLE_API_BASE alle Google-Aufrufe auf den Ersatz unter /dev/google um
      GOOGLE_CLIENT_ID: "e2e-schaltzentrale.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "e2e-test-clientschluessel",
      GOOGLE_TOKEN_KEY: Buffer.alloc(32, 0x5a).toString("base64"),
      GOOGLE_OAUTH_BASE: `http://localhost:${PORT}/dev/google/oauth`,
      GOOGLE_API_BASE: `http://localhost:${PORT}/dev/google/calendar/v3`,
    },
  },
});
