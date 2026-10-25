#!/usr/bin/env node
// ---------------------------------------------------------------
// TOTP für die Testnutzer A und B im TESTPROJEKT einrichten bzw. prüfen (B16, E17).
//   node scripts/test-totp.mjs
// - Hat ein Testnutzer noch keinen Faktor: neuen TOTP-Faktor anlegen, das Geheimnis SOFORT in
//   .env.test.local schreiben (E2E_USER_<A|B>_TOTP_SECRET), dann mit einem Code bestätigen.
// - Hat er schon einen: prüfen, dass das Geheimnis aus .env.test.local einen gültigen Code ergibt.
// Gibt nie Geheimnisse, Passwörter oder E-Mail-Adressen aus. Läuft nie gegen Prod
// (testProject in scripts/lib/env.mjs, dieselben Fälle wie tests/guard.ts).
// ---------------------------------------------------------------
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import * as OTPAuth from "otpauth";
import { ENV_FILES, log, readEnv, testProject } from "./lib/env.mjs";

const TEST_FILE = ENV_FILES.test;
const { env: test, url, key } = testProject();

/** Schreibt KEY=VALUE in .env.test.local (ersetzt oder hängt an), ohne etwas auszugeben. */
function writeSecret(name, value) {
  const lines = readFileSync(TEST_FILE, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index >= 0) lines[index] = `${name}=${value}`;
  else {
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (!lines.some((line) => line.startsWith("E2E_USER_") && line.includes("_TOTP_SECRET="))) {
      lines.push("", "# TOTP-Geheimnisse der Testnutzer (scripts/test-totp.mjs)");
    }
    lines.push(`${name}=${value}`, "");
  }
  const tmp = `${TEST_FILE}.tmp`;
  writeFileSync(tmp, lines.join("\n"), { mode: 0o600 });
  renameSync(tmp, TEST_FILE);
  chmodSync(TEST_FILE, 0o600);
}

const code = (secret) =>
  new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate();

async function setup(which) {
  const email = test[`E2E_USER_${which}_EMAIL`];
  const password = test[`E2E_USER_${which}_PASSWORD`];
  const secretName = `E2E_USER_${which}_TOTP_SECRET`;
  if (!email || !password) throw new Error(`E-Mail/Passwort fehlen in ${TEST_FILE}`);

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Anmeldung fehlgeschlagen (${signInError.code ?? "?"})`);

  const { data: factors, error: listError } = await client.auth.mfa.listFactors();
  if (listError) throw new Error(`Faktoren lesen fehlgeschlagen (${listError.code ?? "?"})`);
  const verified = factors.totp[0];

  if (verified) {
    const secret = readEnv(TEST_FILE)[secretName];
    if (!secret) {
      throw new Error(
        `hat schon einen TOTP-Faktor, aber ${secretName} fehlt. Faktor im Dashboard des ` +
          "TESTPROJEKTS entfernen (Authentication → Users → Nutzer → MFA) und neu starten.",
      );
    }
    const { error } = await client.auth.mfa.challengeAndVerify({
      factorId: verified.id,
      code: code(secret),
    });
    if (error) throw new Error(`Code aus ${secretName} wird abgelehnt (${error.code ?? "?"})`);
    log(`  ✓ Testnutzer ${which}: TOTP eingerichtet, Geheimnis gültig`);
    return;
  }

  // Abgebrochene Einrichtungen (unbestätigte Faktoren) entfernen, sonst Namenskonflikt
  for (const factor of factors.all.filter((f) => f.status !== "verified")) {
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw new Error(`Unbestätigten Faktor entfernen fehlgeschlagen (${error.code})`);
  }
  const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "E2E",
    issuer: "Schaltzentrale Test",
  });
  if (enrollError) throw new Error(`Einrichten fehlgeschlagen (${enrollError.code ?? "?"})`);
  // Erst speichern, dann bestätigen: Ein bestätigter Faktor ohne bekanntes Geheimnis sperrt aus
  writeSecret(secretName, enrolled.totp.secret);
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: enrolled.id,
    code: code(enrolled.totp.secret),
  });
  if (verifyError) throw new Error(`Bestätigen fehlgeschlagen (${verifyError.code ?? "?"})`);
  log(`  ✓ Testnutzer ${which}: TOTP neu eingerichtet, Geheimnis in ${TEST_FILE}`);
}

log("== TOTP der Testnutzer (TEST)");
let failed = false;
for (const which of ["A", "B"]) {
  try {
    await setup(which);
  } catch (error) {
    failed = true;
    console.error(`  ✗ Testnutzer ${which}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
