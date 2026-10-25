/**
 * Alte Supabase-Buckets (note-images, attachments) seit Migration 44 (R2, E41): nur noch lesen.
 * Zum Prüfen des Lesens legt der Test eine Metadaten-Zeile als DB-Eigentümer an (ohne Datei) und
 * entfernt sie danach wieder – die Nutzer selbst können dort nichts mehr schreiben.
 */
import postgres from "postgres";
import { readEnvFile } from "./env-file";

export type LegacyBucket = "note-images" | "attachments";

export async function withLegacySql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(readEnvFile(".env.test.local").SUPABASE_DB_URL ?? "", {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Zeile in storage.objects für einen Testpfad anlegen (nur Metadaten). */
export function addLegacyRow(bucket: LegacyBucket, name: string, ownerUserId: string) {
  return withLegacySql(
    (sql) =>
      sql`insert into storage.objects (bucket_id, name, owner_id) values (${bucket}, ${name}, ${ownerUserId})`,
  );
}

/**
 * Die selbst angelegte Testzeile (nur Metadaten, keine Datei) wieder entfernen. Supabase sperrt
 * direktes Löschen aus storage.objects; für genau diese Zeile gilt die dokumentierte Ausnahme
 * `storage.allow_delete_query` innerhalb einer Transaktion.
 */
export function dropLegacyRow(bucket: LegacyBucket, name: string) {
  return withLegacySql((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('storage.allow_delete_query', 'true', true)`;
      await tx`delete from storage.objects where bucket_id = ${bucket} and name = ${name}`;
    }),
  );
}

/** Policies auf storage.objects, die für den Bucket schreiben (insert/update/delete/all) erlauben. */
export function writePolicies(bucket: LegacyBucket) {
  return withLegacySql(
    (sql) => sql<{ policyname: string; cmd: string }[]>`
      select policyname, cmd from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         and (coalesce(qual, '') || coalesce(with_check, '')) like ${`%${bucket}%`}`,
  );
}
