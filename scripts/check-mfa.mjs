#!/usr/bin/env node
// ---------------------------------------------------------------
// Haben alle Nutzer einen bestätigten TOTP-Faktor? Vor Migration 13 (MFA-Pflicht per RLS) in Prod:
// Wer dann keinen Faktor hat, sieht keine Daten mehr, bis er ihn eingerichtet hat (B16).
//   node scripts/check-mfa.mjs test|prod
// Gibt nur Zahlen aus (keine E-Mails, IDs, Geheimnisse). Exit 0 = alle haben einen Faktor.
// ---------------------------------------------------------------
import postgres from "postgres";
import { dbTarget, log, redact } from "./lib/env.mjs";

const { target, dbUrl } = dbTarget("check-mfa.mjs");

const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 20 });
try {
  const [counts] = await sql`
    select
      count(*)::int as users,
      count(*) filter (where exists (
        select 1 from auth.mfa_factors f
         where f.user_id = u.id and f.factor_type = 'totp' and f.status = 'verified'
      ))::int as with_totp
    from auth.users u`;
  log(`== ${target.toUpperCase()}`);
  log(`  Nutzer: ${counts.users}, davon mit bestätigtem TOTP-Faktor: ${counts.with_totp}`);
  const ok = counts.users > 0 && counts.with_totp === counts.users;
  log(ok ? "MFA BEREIT" : "MFA NICHT BEREIT (Nutzer ohne Faktor sähen nach Migration 13 nichts)");
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(`✗ Abfrage fehlgeschlagen: ${redact(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
