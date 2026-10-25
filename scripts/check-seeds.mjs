#!/usr/bin/env node
// ---------------------------------------------------------------
// Prüft nach einem db push per SQL, dass JEDER vorhandene Nutzer seine Seeds hat:
// 2 Bereiche, 3 Vorlagen, 1 Einstellungszeile – und dass der Seed-Trigger existiert.
// Gibt nur Zahlen aus: keine Inhalte, keine IDs, keine E-Mail-Adressen, keine Zugangsdaten.
//   node scripts/check-seeds.mjs test   → .env.test.local
//   node scripts/check-seeds.mjs prod   → .env.local
// ---------------------------------------------------------------
import postgres from "postgres";
import { dbTarget, log, redact } from "./lib/env.mjs";

const { target, dbUrl } = dbTarget("check-seeds.mjs");

const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 20 });
try {
  const [counts] = await sql`
    select
      count(*)::int as users,
      count(*) filter (where a.n = 2 and t.n = 3 and s.n = 1 and w.n = 1)::int as complete
    from auth.users u
    cross join lateral (
      select count(*) as n from public.areas x where x.user_id = u.id and x.deleted_at is null
    ) a
    cross join lateral (
      select count(*) as n from public.templates x where x.user_id = u.id and x.deleted_at is null
    ) t
    cross join lateral (
      select count(*) as n from public.user_settings x where x.user_id = u.id
    ) s
    cross join lateral (
      -- Notiz-Typen (Migration 25/26): der Standardtyp „idee“ muss da sein
      select count(*) as n from public.note_types x
       where x.user_id = u.id and x.key = 'idee' and x.deleted_at is null
    ) w`;
  const [trigger] = await sql`
    select count(*)::int as n
      from pg_trigger
     where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass`;
  const [migrations] = await sql`
    select count(*)::int as n from supabase_migrations.schema_migrations`;

  log(`== ${target.toUpperCase()}`);
  log(`  Migrationen angewendet: ${migrations.n}`);
  log(`  Seed-Trigger auf auth.users: ${trigger.n === 1 ? "vorhanden" : "FEHLT"}`);
  log(
    `  Nutzer: ${counts.users}, davon mit 2 Bereichen + 3 Vorlagen + Einstellungen + Notiz-Typ Idee: ${counts.complete}`,
  );
  const ok = counts.users > 0 && counts.complete === counts.users && trigger.n === 1;
  log(ok ? "SEEDS OK" : "SEEDS UNVOLLSTÄNDIG");
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  // Fehlermeldung ohne Verbindungs-URL
  console.error(`✗ Abfrage fehlgeschlagen: ${redact(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
