import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHARED_NOTE_LOCKED } from "@/features/ai/server/shares";
import { REPO_ROOT } from "../support/env-file";
import {
  AI_BUCKETS,
  AI_TABLES,
  AI_WRITE_OPENED_TABLES,
  auditMigrations,
  PUBLIC_RPC_ALLOWLIST,
  readMigrations,
  statements,
} from "./sql-audit";

const files = readMigrations(path.join(REPO_ROOT, "supabase", "migrations"));

describe("Migrations-Audit (statisch)", () => {
  it("Migrationen 01–50 sind vorhanden", () => {
    expect(files.map((f) => f.name.slice(15, 17))).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
      "24",
      "25",
      "26",
      "27",
      "28",
      "29",
      "30",
      "31",
      "32",
      "33",
      "34",
      "35",
      "36",
      "37",
      "38",
      "39",
      "40",
      "41",
      "42",
      "43",
      "44",
      "45",
      "46",
      "47",
      "48",
      "49",
      "50",
    ]);
  });

  it("jede Tabelle hat RLS, 4 Policies, MFA-Pflicht (aal2), Grants nur an authenticated; anon kommt nie vor", () => {
    expect(auditMigrations(files)).toEqual([]);
  });

  it("die MFA-Pflicht ist Migration 13 (B16, E17) und deckt jede Tabelle ab; spätere Tabellen bringen sie selbst mit", () => {
    const mfa = files.find((f) => /_13_mfa_enforce\.sql$/.test(f.name));
    expect(mfa).toBeDefined();
    const number = (f: { name: string }) => Number(f.name.slice(15, 17));
    const aal2In = (sql: string) =>
      statements(sql)
        .map((stmt) => /^create policy (\w+)_aal2 on public\.(\w+) as restrictive /.exec(stmt))
        .filter((m): m is RegExpExecArray => Boolean(m))
        .map((m) => m[2]);
    const created = (sql: string) =>
      statements(sql)
        .map((stmt) => /^create table public\.(\w+)/.exec(stmt)?.[1])
        .filter((t): t is string => Boolean(t));
    const before = files.filter((f) => number(f) < 13).flatMap((f) => created(f.sql));
    expect(aal2In(mfa?.sql ?? "").sort()).toEqual(before.sort());
    for (const file of files.filter((f) => number(f) > 13)) {
      expect(aal2In(file.sql).sort(), file.name).toEqual(created(file.sql).sort());
    }
  });
});

describe("KI-Zugang (Migration 21, E27 Fall B)", () => {
  const all = files.flatMap((f) => statements(f.sql));

  it("nur die Inhalte der KI-Werkzeuge lassen freigegebene KI-Zugänge zu – genau einmal je Policy", () => {
    const opened = all
      .map(
        (stmt) =>
          /^alter policy (\w+) on (?:public|storage)\.\w+ using .*ai_client_allowed/.exec(
            stmt,
          )?.[1],
      )
      .filter((p): p is string => Boolean(p));
    // dazu die geöffneten Update-Sperren der Tabellen, die die KI anlegt und ändert (Migration 34)
    expect(opened.sort()).toEqual(
      [
        ...AI_TABLES.map((t) => `${t}_aal2`),
        ...Object.keys(AI_BUCKETS),
        ...AI_WRITE_OPENED_TABLES.map((t) => `${t}_update_mfa`),
      ].sort(),
    );
    for (const strict of ["user_settings", "templates", "saved_views", "ai_clients"]) {
      expect(AI_TABLES).not.toContain(strict);
    }
  });

  it("endgültig löschen und was die KI nur liest, verlangen aal2 (Migration 28, S-1)", () => {
    const without28 = files.filter((f) => !/_28_/.test(f.name));
    const found = auditMigrations(without28);
    // google_accounts und event_links bringen ihre Sperren selbst mit (Migrationen 36 und 43)
    for (const t of AI_TABLES.filter(
      (t) =>
        !["links", "task_note_links", "ai_activity", "google_accounts", "event_links"].includes(t),
    )) {
      expect(
        found.some((v) => v.includes(`${t}_delete_mfa`)),
        t,
      ).toBe(true);
    }
    for (const t of ["recaps", "note_types", "task_dependencies"]) {
      expect(
        found.some((v) => v.includes(`${t}_insert_mfa`)),
        t,
      ).toBe(true);
      expect(
        found.some((v) => v.includes(`${t}_update_mfa`)),
        t,
      ).toBe(true);
    }
    expect(found.some((v) => v.includes("attachments_delete_mfa"))).toBe(true);
    expect(found.some((v) => v.includes("note_images_delete_mfa"))).toBe(true);
    expect(found.some((v) => v.includes("links_delete_mfa"))).toBe(false);
    const dropped = auditMigrations([
      ...files,
      { name: "20261017000029_29_bad.sql", sql: "drop policy tasks_delete_mfa on public.tasks;" },
    ]);
    expect(dropped.some((v) => v.includes("KI-Sperre wird entfernt"))).toBe(true);
  });

  it("Rückblicke darf die KI anlegen (Migration 32) und ändern (34), nie endgültig löschen – nur genau so", () => {
    const opening = all.filter((stmt) => /^alter policy \w+_(?:insert|update)_mfa\b/.test(stmt));
    expect(opening).toEqual([
      "alter policy recaps_insert_mfa on public.recaps with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))",
      "alter policy recaps_update_mfa on public.recaps using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed()))) with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))",
    ]);
    const bad = (sql: string) =>
      auditMigrations([...files, { name: "20261018000035_35_bad.sql", sql }]).filter((v) =>
        v.includes("KI-Sperre wird entfernt"),
      );
    // weiter geöffnet als „aal2 ODER freigegebener KI-Zugang“
    expect(bad("alter policy recaps_insert_mfa on public.recaps with check (true);")).toHaveLength(
      1,
    );
    expect(
      bad(
        "alter policy recaps_update_mfa on public.recaps using (true) with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));",
      ),
    ).toHaveLength(1);
    // endgültig löschen bleibt gesperrt, auch mit derselben Öffnung
    expect(
      bad(
        "alter policy recaps_delete_mfa on public.recaps using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));",
      ),
    ).toHaveLength(1);
    // Notiz-Typen liest die KI weiterhin nur
    expect(
      bad(
        "alter policy note_types_insert_mfa on public.note_types with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));",
      ),
    ).toHaveLength(1);
    expect(
      bad(
        "alter policy note_types_update_mfa on public.note_types using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed()))) with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));",
      ),
    ).toHaveLength(1);
  });

  it("Google-Konto (Migration 36): KI-Zugänge lesen nur – verbinden, trennen, löschen verlangen aal2", () => {
    const m36 = files.find((f) => /_36_google_accounts\.sql$/.test(f.name));
    expect(m36).toBeDefined();
    expect(AI_TABLES).toContain("google_accounts");
    // ohne die drei Sperren meldet der Audit genau sie
    const stripped = (m36?.sql ?? "").replace(
      /create policy google_accounts_(?:insert|update|delete)_mfa[^;]*;/g,
      "",
    );
    const found = auditMigrations(files.map((f) => (f === m36 ? { ...f, sql: stripped } : f)));
    expect(found.filter((v) => v.includes("google_accounts_")).sort()).toEqual([
      "google_accounts: restriktive Policy google_accounts_delete_mfa (KI löscht nie endgültig) fehlt",
      "google_accounts: restriktive Policy google_accounts_insert_mfa (KI liest nur) fehlt",
      "google_accounts: restriktive Policy google_accounts_update_mfa (KI liest nur) fehlt",
    ]);
    // Schreiben für die KI öffnen geht nicht – auch nicht genau wie bei den Rückblicken
    const opened = auditMigrations([
      ...files,
      {
        name: "20261018000037_37_bad.sql",
        sql: "alter policy google_accounts_update_mfa on public.google_accounts using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed()))) with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));",
      },
    ]);
    expect(opened.some((v) => v.includes("KI-Sperre wird entfernt"))).toBe(true);
  });

  it("das KI-Protokoll kann die KI nur ergänzen: ändern und löschen verlangen aal2", () => {
    for (const op of ["update", "delete"]) {
      expect(
        all.some((stmt) =>
          new RegExp(
            `^create policy ai_activity_${op}_mfa on public\\.ai_activity as restrictive for ${op} to authenticated using \\(\\(select auth\\.jwt\\(\\) ->> 'aal'\\) = 'aal2'\\)`,
          ).test(stmt),
        ),
        op,
      ).toBe(true);
    }
  });
});

describe("Öffentliche Freigabe (Migration 45, #94, E42): nur zwei Funktionen für anon", () => {
  const all = files.flatMap((f) => statements(f.sql));
  const extra = (sql: string) =>
    auditMigrations([...files, { name: "20261023000046_46_bad.sql", sql }]);

  it("anon kommt außerhalb von revoke nur in den Grants der beiden Freigabe-Funktionen vor", () => {
    const withAnon = all.filter((stmt) => /\banon\b/.test(stmt) && !stmt.startsWith("revoke "));
    expect([...new Set(withAnon)]).toEqual([
      "grant execute on function public.shared_note(text) to anon, authenticated",
      "grant execute on function public.shared_note_file(text, text) to anon, authenticated",
    ]);
    expect(PUBLIC_RPC_ALLOWLIST).toEqual(["shared_note", "shared_note_file"]);
  });

  it("note_shares ist eine normale Tabelle (RLS, aal2) und für die KI nicht geöffnet", () => {
    expect(AI_TABLES).not.toContain("note_shares");
    expect(
      all.some((stmt) => /^alter policy note_shares_aal2\b/.test(stmt)),
      "KI-Öffnung der Freigaben",
    ).toBe(false);
  });

  it("andere Funktionen dürfen anon weiterhin nichts geben – auch nicht genau so", () => {
    const grant = extra(
      "grant execute on function public.search_all(text, uuid) to anon, authenticated;",
    );
    expect(grant.some((v) => v.includes("„anon“ außerhalb von revoke"))).toBe(true);
    const only = extra("grant execute on function public.shared_note(text) to anon;");
    expect(only.some((v) => v.includes("„anon“ außerhalb von revoke"))).toBe(true);
    const table = extra("grant select on table public.note_shares to anon;");
    expect(table.some((v) => v.includes("„anon“ außerhalb von revoke"))).toBe(true);
    const policy = extra(
      "create policy note_shares_public on public.note_shares for select to anon using (true);",
    );
    expect(policy.some((v) => v.includes("Policy ohne „to authenticated“"))).toBe(true);
    expect(policy.some((v) => v.includes("„anon“ außerhalb von revoke"))).toBe(true);
  });

  it("Funktionen nie per ALTER ändern – sonst ginge security definer oder search_path am Audit vorbei", () => {
    for (const sql of [
      "alter function public.search_all(text, uuid) security definer;",
      "alter function public.shared_note(text) volatile;",
      "alter function public.shared_note(text) reset search_path;",
      "alter function public.note_share_active(uuid) owner to postgres;",
      "alter routine public.empty_trash(text, uuid[]) security definer;",
      "alter procedure public.x() set search_path = public;",
    ]) {
      expect(
        extra(sql).some((v) => v.includes("Funktion per ALTER geändert")),
        sql,
      ).toBe(true);
    }
    expect(all.some((stmt) => /^alter (?:function|procedure|routine) /.test(stmt))).toBe(false);
  });

  it("Migration 46: die Sperre für KI-Tokens meldet genau den Text der KI-Werkzeuge", () => {
    const m46 = files.find((f) => /_46_note_shares_haerten\.sql$/.test(f.name));
    expect(m46?.sql.split(SHARED_NOTE_LOCKED).length).toBe(3);
  });

  it("security definer bleibt für andere Funktionen verboten; die Freigabe-Funktionen müssen stable sein", () => {
    const definer = extra(`
      create function public.shared_everything() returns jsonb language sql stable security definer
        set search_path = '' as $$ select '{}'::jsonb $$;
      revoke execute on function public.shared_everything() from public, anon;
    `);
    expect(definer.some((v) => v.includes("shared_everything ist security definer"))).toBe(true);
    const volatile = extra(`
      create or replace function public.shared_note(p_token text) returns jsonb language sql
        security definer set search_path = '' as $$ select null::jsonb $$;
      revoke execute on function public.shared_note(text) from public, anon;
    `);
    expect(volatile.some((v) => v.includes("shared_note (öffentlich) ist nicht stable"))).toBe(
      true,
    );
  });
});

describe("Audit erkennt Verstöße (Selbsttest)", () => {
  const bad = `
    create table public.leak (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create policy leak_select on public.leak for select using (true);
    grant select on table public.leak to anon;
    create function public.f() returns int language sql security definer as $$ select 1; $$;
    create view public.v as select 1;
  `;
  const violations = auditMigrations([{ name: "20261011000001_01_bad.sql", sql: bad }]);

  it.each([
    "RLS nicht aktiviert",
    "Policy für insert (to authenticated) fehlt",
    "Policy ohne „to authenticated“",
    "„anon“ außerhalb von revoke",
    "grant select, insert, update, delete … to authenticated fehlt",
    "ohne set search_path",
    "ist security definer",
    "revoke execute … from public, anon fehlt",
    "ohne security_invoker",
    "restriktive Policy leak_aal2 (MFA-Pflicht, E17) fehlt",
  ])("meldet: %s", (fragment) => {
    expect(violations.some((v) => v.includes(fragment))).toBe(true);
  });

  it.each([
    ["Drop", "drop policy areas_aal2 on public.areas;"],
    [
      "Einstellungen für die KI öffnen",
      "alter policy user_settings_aal2 on public.user_settings using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed()))) with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));",
    ],
    [
      "schwächer als vorgesehen",
      "alter policy areas_aal2 on public.areas using (true) with check (true);",
    ],
    [
      "Bucket ohne Bucket-Bezug",
      "alter policy attachments_aal2 on storage.objects using ((select public.ai_client_allowed())) with check ((select public.ai_client_allowed()));",
    ],
  ])("meldet MFA-Policy geändert: %s", (_, sql) => {
    const found = auditMigrations([{ name: "20261011000001_01_bad.sql", sql }]);
    expect(found.some((v) => v.includes("MFA-Policy wird entfernt oder geändert"))).toBe(true);
  });

  it("ignoriert Semikolons in Funktionsrümpfen", () => {
    expect(
      statements("create function public.x() returns void as $$ begin; end; $$; select 1;"),
    ).toEqual(["create function public.x() returns void as $$body$$", "select 1"]);
  });
});

describe("Audit-Lücken (Review Teil B, M-7): die Regeln melden, was vorher durchging", () => {
  const probe = (sql: string) =>
    auditMigrations([...files, { name: "20261024000051_51_probe.sql", sql }]);
  const hit = (sql: string, text: string) =>
    expect(
      probe(sql).some((v) => v.includes(text)),
      `${text} ← ${probe(sql).join(" | ")}`,
    ).toBe(true);

  it("zweite permissive Policy und (true) fallen auf", () => {
    const sql =
      "create policy tasks_offen on public.tasks for select to authenticated using (true);";
    hit(sql, "Policy mit (true)");
    hit(sql, "tasks: 2 permissive Policies für select");
    hit(
      "create policy tasks_alle on public.tasks for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);",
      "tasks: 2 permissive Policies für insert",
    );
  });

  it("Grund-Policy per ALTER, Storage ohne Ordnerbindung, DO-Block, fremdes Schema", () => {
    hit(
      "alter policy tasks_select on public.tasks using ((select auth.uid()) = user_id or true);",
      "Grund-Policy wird geändert",
    );
    hit(
      "create policy bilder_alle on storage.objects for select to authenticated using (bucket_id = 'note-images');",
      "Storage-Policy ohne Ordnerbindung",
    );
    hit("do $$ begin perform 1; end $$;", "DO-Block");
    hit(
      "create function auth.heimlich() returns void language sql security invoker set search_path = '' as $$ select 1 $$; revoke execute on function auth.heimlich() from public, anon;",
      "Funktion außerhalb public",
    );
  });

  it("Schutz-Trigger und nicht wieder eingeschaltete Trigger", () => {
    hit("drop trigger notes_guard_shared on public.notes;", "Schutz-Trigger notes_guard_shared");
    hit(
      "alter table public.recaps disable trigger recaps_guard_ai; alter table public.recaps enable trigger recaps_guard_ai;",
      "Schutz-Trigger recaps_guard_ai",
    );
    hit(
      "alter table public.tasks disable trigger tasks_updated_at;",
      "tasks_updated_at wird abgeschaltet, aber nicht wieder eingeschaltet",
    );
    expect(
      probe(
        "alter table public.tasks disable trigger tasks_updated_at; alter table public.tasks enable trigger tasks_updated_at;",
      ),
    ).toEqual([]);
  });

  it("neue Tabelle ohne revoke … from anon", () => {
    const table = `
      create table public.probe (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      );
      alter table public.probe enable row level security;
      create policy probe_select on public.probe for select to authenticated using ((select auth.uid()) = user_id);
      create policy probe_insert on public.probe for insert to authenticated with check ((select auth.uid()) = user_id);
      create policy probe_update on public.probe for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
      create policy probe_delete on public.probe for delete to authenticated using ((select auth.uid()) = user_id);
      create policy probe_aal2 on public.probe as restrictive for all to authenticated using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
      grant select, insert, update, delete on table public.probe to authenticated;
      create trigger probe_updated_at before update on public.probe for each row execute function public.set_updated_at();`;
    hit(table, "probe: revoke all on table … from anon fehlt");
    expect(probe(`${table} revoke all on table public.probe from anon;`)).toEqual([]);
  });
});
