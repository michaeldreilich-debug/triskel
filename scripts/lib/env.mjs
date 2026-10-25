// ---------------------------------------------------------------
// Gemeinsame Helfer der Node-Skripte (check-seeds, check-mfa, test-totp): .env-Dateien lesen
// (ohne sie auszuführen), DB-URL je Ziel, Prod-Schutz fürs Testprojekt, Fehlermeldungen ohne
// Zugangsdaten. Gibt selbst nie Werte aus.
// ---------------------------------------------------------------
import { existsSync, readFileSync } from "node:fs";
import { checkTestTarget } from "./guard.mjs";

export const ENV_FILES = { test: ".env.test.local", prod: ".env.local" };

export const log = (message) => process.stdout.write(`${message}\n`);

/** KEY=VALUE je Zeile, Kommentare und Anführungszeichen wie tests/support/env-file.ts. */
export function readEnv(file) {
  if (!existsSync(file)) return {};
  const env = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    env[m[1]] = value;
  }
  return env;
}

/** Ziel aus argv („test“ | „prod“) samt Datei und DB-URL; bricht mit Hinweis ab. */
export function dbTarget(script) {
  const target = process.argv[2];
  const file = ENV_FILES[target];
  if (!file) {
    console.error(`Aufruf: node scripts/${script} test|prod`);
    process.exit(2);
  }
  const dbUrl = readEnv(file).SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error(`✗ SUPABASE_DB_URL in ${file} ist leer.`);
    process.exit(1);
  }
  return { target, file, dbUrl };
}

/** Fehlertext ohne Verbindungs-URL (enthält das DB-Passwort). */
export function redact(error) {
  return String(error?.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, "<db-url>");
}

/**
 * Supabase-Zugang des TESTPROJEKTS; bricht ab, wenn er fehlt oder auf Prod zeigt – dieselbe
 * Prüfung wie tests/guard.ts (scripts/lib/guard.mjs: URL, Projekt-Ref aus URL und DB-URL in
 * Pooler- und Direktform, DB-URL gehört zum Testprojekt).
 */
export function testProject() {
  const test = readEnv(ENV_FILES.test);
  const prod = readEnv(ENV_FILES.prod);
  const url = (test.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const key = test.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !key) {
    console.error(`✗ URL oder Publishable Key fehlt in ${ENV_FILES.test}.`);
    process.exit(1);
  }
  const result = checkTestTarget(
    { url, dbUrl: test.SUPABASE_DB_URL },
    { url: prod.NEXT_PUBLIC_SUPABASE_URL, dbUrl: prod.SUPABASE_DB_URL },
  );
  if (!result.ok) {
    console.error(`✗ Der Test-Zugang zeigt auf Prod oder ein fremdes Projekt. Abbruch.`);
    process.exit(1);
  }
  return { env: test, url, key };
}
