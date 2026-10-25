/**
 * Supabase-Nachbildung in PGlite (Postgres als WASM, im Speicher) für den Migrationstest.
 * Bildet nur das Nötige nach: Rollen anon/authenticated, Schema auth mit users, uid()/jwt() und
 * den OAuth-Tabellen (Clients, Sitzungen), Schema extensions mit pg_trgm, Storage (Buckets,
 * Objekte mit RLS, foldername). Keine Verbindung nach außen.
 *
 * Ersetzt NICHT die Integrationstests gegen das Supabase-Testprojekt (Session A2), fängt aber
 * Syntax-, Rechte- und Logikfehler der Migrationen früh ab.
 */
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type { MigrationFile } from "./sql-audit";

const SUPABASE_STUB = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create schema auth;
  create schema extensions;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema extensions to anon, authenticated;

  create table auth.users (
    id uuid primary key,
    email text,
    created_at timestamptz not null default now()
  );

  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant execute on function auth.uid() to anon, authenticated;
  grant execute on function auth.jwt() to anon, authenticated;

  -- OAuth-Server (KI-Zugang, Migration 21): Clients und Sitzungen, nur die gelesenen Spalten;
  -- wie bei Supabase für anon/authenticated nicht lesbar
  create type auth.oauth_client_type as enum ('public', 'confidential');
  create table auth.oauth_clients (
    id uuid primary key,
    client_name text,
    client_type auth.oauth_client_type not null default 'confidential',
    deleted_at timestamptz
  );
  create table auth.sessions (
    id uuid primary key,
    user_id uuid not null references auth.users (id),
    oauth_client_id uuid references auth.oauth_clients (id),
    aal text
  );

  -- Storage (Bilder, Migration 18): nur Buckets, Objekte mit RLS und foldername()
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid default auth.uid(),
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  grant execute on function storage.foldername(text) to anon, authenticated;
`;

export async function createSupabaseLikeDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STUB);
  return db;
}

export async function createUser(db: PGlite, id: string, email: string) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}

export async function applyMigrations(db: PGlite, files: MigrationFile[]) {
  for (const file of files) {
    try {
      await db.exec(file.sql);
    } catch (error) {
      throw new Error(`Migration ${file.name} schlägt fehl: ${(error as Error).message}`);
    }
  }
}

type Role =
  | { role: "anon" }
  /**
   * aal: Stufe im JWT – Standard aal2 (Passwort + TOTP, B16); null = Claim fehlt.
   * clientId/sessionId: OAuth-Token eines KI-Zugangs (Claims client_id, session_id).
   */
  | {
      role: "authenticated";
      userId: string;
      aal?: "aal1" | "aal2" | null;
      clientId?: string;
      sessionId?: string;
    };

/** Führt fn in einer Transaktion als anon bzw. angemeldeter Nutzer aus (wie PostgREST). */
export async function as<T>(
  db: PGlite,
  who: Role,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims =
      who.role === "anon"
        ? { role: "anon" }
        : {
            role: "authenticated",
            sub: who.userId,
            ...(who.aal === null ? {} : { aal: who.aal ?? "aal2" }),
            ...(who.clientId ? { client_id: who.clientId } : {}),
            ...(who.sessionId ? { session_id: who.sessionId } : {}),
          };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${who.role}`);
    return fn(tx);
  });
}
