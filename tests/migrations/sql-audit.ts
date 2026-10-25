/**
 * Statischer Migrations-Audit (CLAUDE.md Regeln 2, 3, 9; docs/plan-phase-1.md Abschnitt 2).
 * Reine Textanalyse, keine Datenbank nötig. Liefert eine Liste von Verstößen.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface MigrationFile {
  name: string;
  sql: string;
}

/**
 * Erlaubte security-definer-Funktionen (Seed, die Prüfung freigegebener KI-Zugänge und – Migration
 * 46 – ob eine eigene Notiz öffentlich freigegeben ist: die KI sieht note_shares nicht, ihre
 * Werkzeuge und die Sperre für KI-Tokens brauchen trotzdem genau dieses Ja/Nein).
 */
export const SECURITY_DEFINER_ALLOWLIST = [
  "seed_user_defaults",
  "handle_new_user",
  "ai_client_allowed",
  "note_share_active",
];

/**
 * Öffentliche Freigabe einer Notiz per Link (#94, E42, Migration 45): die EINZIGEN Funktionen, die
 * anon ausführen darf. Nur für sie ist `security definer` und genau
 * `grant execute on function public.<f>(…) to anon, authenticated` erlaubt; sie müssen `stable`
 * sein (lesen nur). Alles andere mit anon bleibt verboten (Tabellen, Policies, andere Funktionen).
 */
export const PUBLIC_RPC_ALLOWLIST = ["shared_note", "shared_note_file"];

/**
 * Trigger, die Sicherheitszusagen tragen (M-7): nie entfernen oder abschalten – auch nicht
 * „nur kurz“ in einem Nachtrag.
 */
export const PROTECTED_TRIGGERS = [
  "ai_activity_client",
  "notes_guard_shared",
  "note_blocks_guard_shared",
  "notes_guard_shared_restore",
  "note_shares_own_note",
  "tasks_created_by_insert",
  "tasks_created_by_update",
  "recaps_guard_ai",
  "event_links_restore",
  "calendar_sources_google_restore",
];

/**
 * Tabellen, deren MFA-Policy auch freigegebene KI-Zugänge zulässt (Migration 21, E27 Fall B):
 * nur die Inhalte der KI-Werkzeuge und ihrer Trigger/RPCs. Einstellungen, Vorlagen, Ansichten
 * und die Freigaben selbst (ai_clients) bleiben reines aal2.
 */
export const AI_TABLES = [
  "areas",
  "topics",
  "projects",
  "milestones",
  "tasks",
  "task_dependencies",
  "notes",
  "note_blocks",
  "links",
  "task_note_links",
  "recaps",
  "ai_activity",
  // Notiz-Typen (Migration 25): die Werkzeuge nennen und setzen Typen
  "note_types",
  // Google-Konto (Migration 36): die Termin-Werkzeuge lesen den verschlüsselten Token (N1d)
  "google_accounts",
  // Termin-Verknüpfungen (Migration 43, #68): Werkzeuge mit „termin“, link_event, unlink_event
  "event_links",
];
/** Buckets (storage.objects), deren MFA-Policy ebenso freigegebene KI-Zugänge zulässt. */
export const AI_BUCKETS: Record<string, string> = {
  note_images_aal2: "note-images",
  attachments_aal2: "attachments",
};
/**
 * Abgeleitete Tabellen, die Trigger auch unter dem KI-Token leeren (Migration 05, 10) – nur sie
 * darf ein KI-Token löschen. Alle übrigen AI_TABLES brauchen `<t>_delete_mfa` (Migration 28, S-1).
 */
export const AI_DERIVED_TABLES = ["links", "task_note_links"];
/** Tabellen, die die KI nur liest: anlegen/ändern verlangen aal2 (`<t>_insert_mfa`/`_update_mfa`). */
export const AI_READ_ONLY_TABLES = ["note_types", "task_dependencies", "google_accounts"];
/**
 * Tabellen, die die KI anlegt und ändert, aber nie endgültig löscht (Rückblicke: Migration 32
 * anlegen, 34 ändern): `<t>_insert_mfa` und `<t>_update_mfa` aus Migration 28 dürfen genau auf
 * „aal2 ODER freigegebener KI-Zugang“ geöffnet werden; `<t>_delete_mfa` bleibt aal2.
 */
export const AI_WRITE_OPENED_TABLES = ["recaps"];

export function readMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), "utf8") }));
}

/** Entfernt Kommentare und ersetzt Dollar-Quote-Rümpfe durch einen Platzhalter. */
export function stripBodies(sql: string): string {
  return sql
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, () => "$$BODY$$")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Anweisungen (durch Semikolon getrennt) ohne Funktionsrümpfe, normalisiert. */
export function statements(sql: string): string[] {
  return stripBodies(sql)
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

const OPS = ["select", "insert", "update", "delete"] as const;

/** Rest der aal2-Policy nach „create policy <t>_aal2 on public.<t> “ (normalisiert, als RegExp). */
const AAL2_TERM = String.raw`\(select auth\.jwt\(\) ->> 'aal'\) = 'aal2'`;
const AAL2_CHECK = String.raw`\(${AAL2_TERM}\)`;
const AAL2_POLICY = `as restrictive for all to authenticated using ${AAL2_CHECK} with check ${AAL2_CHECK}`;
/** aal2 ODER freigegebener KI-Zugang (Migration 21) – die einzige erlaubte Änderung. */
const MFA_OR_AI = String.raw`\(\(select auth\.jwt\(\) ->> 'aal'\) = 'aal2' or \(select public\.ai_client_allowed\(\)\)\)`;

/** Ist stmt genau die erlaubte Öffnung einer MFA-Policy für freigegebene KI-Zugänge? */
function isAiOpening(stmt: string): boolean {
  const table = /^alter policy (\w+)_aal2 on public\.(\w+) /.exec(stmt);
  if (table) {
    const [, name, target] = table;
    return (
      name === target &&
      AI_TABLES.includes(target) &&
      new RegExp(
        `^alter policy ${name}_aal2 on public\\.${target} using \\(${MFA_OR_AI}\\) with check \\(${MFA_OR_AI}\\)$`,
      ).test(stmt)
    );
  }
  const policy = /^alter policy (\w+_aal2) on storage\.objects /.exec(stmt)?.[1];
  const bucket = policy ? AI_BUCKETS[policy] : undefined;
  if (!policy || !bucket) return false;
  const check = `bucket_id <> '${bucket}' or ${MFA_OR_AI}`;
  return new RegExp(
    `^alter policy ${policy} on storage\\.objects using \\(${check}\\) with check \\(${check}\\)$`,
  ).test(stmt);
}

/**
 * Ist stmt genau die erlaubte Öffnung von `<t>_insert_mfa` (Migration 32) bzw. `<t>_update_mfa`
 * (Migration 34) für freigegebene KI-Zugänge? Nur für AI_WRITE_OPENED_TABLES, nie `_delete_mfa`.
 */
function isAiWriteOpening(stmt: string): boolean {
  const match = /^alter policy (\w+)_(insert|update)_mfa on public\.(\w+) /.exec(stmt);
  if (!match) return false;
  const [, name, op, target] = match;
  if (name !== target || !AI_WRITE_OPENED_TABLES.includes(target as string)) return false;
  const rest =
    op === "insert"
      ? `with check \\(${MFA_OR_AI}\\)`
      : `using \\(${MFA_OR_AI}\\) with check \\(${MFA_OR_AI}\\)`;
  return new RegExp(`^alter policy ${name}_${op}_mfa on public\\.${target} ${rest}$`).test(stmt);
}

/**
 * Ist stmt genau der erlaubte Grant einer öffentlichen Freigabe-Funktion an anon (Migration 45)?
 * Nur `to anon, authenticated` und nur für PUBLIC_RPC_ALLOWLIST.
 */
function isPublicRpcGrant(stmt: string): boolean {
  const fn = /^grant execute on function public\.(\w+)\([^)]*\) to anon, authenticated$/.exec(
    stmt,
  )?.[1];
  return fn !== undefined && PUBLIC_RPC_ALLOWLIST.includes(fn);
}

export function auditMigrations(files: MigrationFile[]): string[] {
  const violations: string[] = [];
  const all = files.flatMap((f) => statements(f.sql).map((stmt) => ({ file: f.name, stmt })));
  const has = (re: RegExp) => all.some(({ stmt }) => re.test(stmt));

  // Dateinamen: <14 Ziffern>_<NN>_<name>.sql, fortlaufend nummeriert
  files.forEach((f, i) => {
    const m = /^(\d{14})_(\d{2})_[a-z0-9_]+\.sql$/.exec(f.name);
    if (!m) violations.push(`${f.name}: Dateiname entspricht nicht <timestamp>_<NN>_<name>.sql`);
    else if (Number(m[2]) !== i + 1) violations.push(`${f.name}: Nummer ${m[2]} statt ${i + 1}`);
  });

  // Tabellen
  const tables = all
    .map(({ stmt }) => /^create table (?:if not exists )?public\.(\w+)/.exec(stmt)?.[1])
    .filter((t): t is string => Boolean(t));
  if (tables.length === 0) violations.push("Keine Tabellen gefunden");

  for (const t of tables) {
    const create =
      all.find(({ stmt }) =>
        new RegExp(`^create table (?:if not exists )?public\\.${t} `).test(stmt),
      )?.stmt ?? "";
    if (
      !/\buser_id uuid not null (?:unique )?default auth\.uid\(\) references auth\.users ?\(id\) on delete cascade/.test(
        create,
      )
    ) {
      violations.push(`${t}: user_id uuid not null default auth.uid() references auth.users fehlt`);
    }
    for (const col of [
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
      "deleted_at timestamptz",
    ]) {
      if (!create.includes(col)) violations.push(`${t}: Spalte „${col}“ fehlt`);
    }
    if (!has(new RegExp(`^alter table public\\.${t} enable row level security$`))) {
      violations.push(`${t}: RLS nicht aktiviert`);
    }
    for (const op of OPS) {
      const policy = all.find(({ stmt }) =>
        new RegExp(`^create policy \\w+ on public\\.${t} for ${op} to authenticated\\b`).test(stmt),
      )?.stmt;
      if (!policy) {
        violations.push(`${t}: Policy für ${op} (to authenticated) fehlt`);
        continue;
      }
      const usingOk =
        op === "insert" || /using \(\(select auth\.uid\(\)\) = user_id\)/.test(policy);
      const checkOk =
        op === "select" ||
        op === "delete" ||
        /with check \(\(select auth\.uid\(\)\) = user_id\)/.test(policy);
      if (!usingOk || !checkOk)
        violations.push(`${t}: Policy für ${op} prüft nicht (select auth.uid()) = user_id`);
    }
    if (
      !has(
        new RegExp(
          `^grant select, insert, update, delete on table public\\.${t} to authenticated$`,
        ),
      )
    ) {
      violations.push(`${t}: grant select, insert, update, delete … to authenticated fehlt`);
    }
    if (!has(new RegExp(`^create trigger ${t}_updated_at before update on public\\.${t} `))) {
      violations.push(`${t}: Trigger ${t}_updated_at fehlt`);
    }
    // MFA-Pflicht (B16, E17): restriktive Policy, die im JWT aal2 verlangt
    if (!has(new RegExp(`^create policy ${t}_aal2 on public\\.${t} ${AAL2_POLICY}$`))) {
      violations.push(`${t}: restriktive Policy ${t}_aal2 (MFA-Pflicht, E17) fehlt`);
    }
  }

  // Die MFA-Pflicht nie entfernen oder aufweichen. Einzige Ausnahme (Migration 21): für die
  // Inhalte der KI-Werkzeuge „aal2 ODER freigegebener KI-Zugang“ – genau so, nichts anderes.
  for (const { file, stmt } of all) {
    if (/^(?:drop|alter) policy (?:if exists )?\w+_aal2\b/.test(stmt) && !isAiOpening(stmt)) {
      violations.push(`${file}: MFA-Policy wird entfernt oder geändert: ${stmt.slice(0, 80)}`);
    }
  }

  // KI-Token löschen nie endgültig, und was die KI nur liest, ändert sie nicht (Migration 28,
  // S-1). Prüfung nur, sobald es KI-Zugänge gibt (Migration 21); die Policies nie entfernen.
  if (has(/^create function public\.ai_client_allowed\(/)) {
    const restrictive = (
      name: string,
      target: string,
      op: string,
      using: boolean,
      check: boolean,
    ) =>
      new RegExp(
        `^create policy ${name} on ${target} as restrictive for ${op} to authenticated` +
          (using ? ` using ${AAL2_CHECK}` : "") +
          (check ? ` with check ${AAL2_CHECK}` : "") +
          "$",
      );
    for (const t of AI_TABLES.filter((t) => !AI_DERIVED_TABLES.includes(t))) {
      if (!has(restrictive(`${t}_delete_mfa`, `public\\.${t}`, "delete", true, false))) {
        violations.push(`${t}: restriktive Policy ${t}_delete_mfa (KI löscht nie endgültig) fehlt`);
      }
    }
    for (const t of [...AI_READ_ONLY_TABLES, ...AI_WRITE_OPENED_TABLES]) {
      if (!has(restrictive(`${t}_insert_mfa`, `public\\.${t}`, "insert", false, true))) {
        violations.push(`${t}: restriktive Policy ${t}_insert_mfa (KI liest nur) fehlt`);
      }
      if (!has(restrictive(`${t}_update_mfa`, `public\\.${t}`, "update", true, true))) {
        violations.push(`${t}: restriktive Policy ${t}_update_mfa (KI liest nur) fehlt`);
      }
    }
    for (const [policy, bucket] of Object.entries(AI_BUCKETS)) {
      const name = policy.replace(/_aal2$/, "_delete_mfa");
      const re = new RegExp(
        `^create policy ${name} on storage\\.objects as restrictive for delete to authenticated using \\(bucket_id <> '${bucket}' or ${AAL2_TERM}\\)$`,
      );
      if (!has(re)) violations.push(`${bucket}: restriktive Policy ${name} (Dateien) fehlt`);
    }
  }
  for (const { file, stmt } of all) {
    if (
      /^(?:drop|alter) policy (?:if exists )?\w+_(?:delete|insert|update)_mfa\b/.test(stmt) &&
      !isAiWriteOpening(stmt)
    ) {
      violations.push(`${file}: KI-Sperre wird entfernt oder geändert: ${stmt.slice(0, 80)}`);
    }
  }

  // Policies nie ohne Rolle (sonst gelten sie für public) und nie für anon
  for (const { file, stmt } of all) {
    if (stmt.startsWith("create policy") && !/ to authenticated\b/.test(stmt)) {
      violations.push(`${file}: Policy ohne „to authenticated“: ${stmt.slice(0, 80)}`);
    }
  }

  // M-7 (Review Teil B): Löcher, die vorher ohne Meldung durchgingen
  // 1. Policies mit (true) öffnen alles – nie
  for (const { file, stmt } of all) {
    if (/^(?:create|alter) policy /.test(stmt) && /\b(?:using|with check) \(true\)/.test(stmt)) {
      violations.push(`${file}: Policy mit (true): ${stmt.slice(0, 80)}`);
    }
  }
  // 2. je Tabelle und Operation genau eine permissive Policy (permissive Policies gelten mit ODER:
  //    eine zweite mit weiterem using öffnete alle Zeilen)
  for (const t of tables) {
    for (const op of OPS) {
      const permissive = all.filter(
        ({ stmt }) =>
          new RegExp(
            `^create policy \\w+ on public\\.${t} for (?:${op}|all) to authenticated\\b`,
          ).test(stmt) && !stmt.includes(" as restrictive "),
      );
      if (permissive.length > 1) {
        violations.push(
          `${t}: ${permissive.length} permissive Policies für ${op} (nur eine erlaubt)`,
        );
      }
    }
  }
  // 3. Grund-Policies nie per ALTER ändern (nur anlegen; Härtungen kommen als restriktive dazu)
  for (const { file, stmt } of all) {
    if (/^alter policy \w+_(?:select|insert|update|delete) on public\./.test(stmt)) {
      violations.push(`${file}: Grund-Policy wird geändert: ${stmt.slice(0, 80)}`);
    }
  }
  // 4. Storage-Policies binden an den eigenen Ordner (erstes Segment = user_id)
  for (const { file, stmt } of all) {
    if (
      /^create policy \w+ on storage\.objects /.test(stmt) &&
      !stmt.includes(" as restrictive ") &&
      !/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/.test(stmt)
    ) {
      violations.push(`${file}: Storage-Policy ohne Ordnerbindung: ${stmt.slice(0, 80)}`);
    }
  }
  // 5. DO-Blöcke (nicht prüfbar) und Funktionen außerhalb public (pg_temp für Hilfsfunktionen
  //    einer Migration ist in Ordnung – sie verschwinden mit der Sitzung)
  for (const { file, stmt } of all) {
    if (/^do\b/.test(stmt))
      violations.push(`${file}: DO-Block (nicht prüfbar): ${stmt.slice(0, 60)}`);
    const schema = /^create (?:or replace )?function (\w+)\./.exec(stmt)?.[1];
    if (schema && schema !== "public" && schema !== "pg_temp") {
      violations.push(`${file}: Funktion außerhalb public: ${stmt.slice(0, 80)}`);
    }
  }
  // 6. Schutz-Trigger nie entfernen oder abschalten; vorübergehend Abgeschaltetes im selben
  //    File wieder einschalten (Nachtrag Migration 40)
  for (const { file, stmt } of all) {
    const dropped = /^drop trigger (?:if exists )?(\w+) on public\./.exec(stmt)?.[1];
    const disabled = /^alter table public\.(\w+) disable trigger (\w+)$/.exec(stmt);
    const name = dropped ?? disabled?.[2];
    if (name && PROTECTED_TRIGGERS.includes(name)) {
      violations.push(`${file}: Schutz-Trigger ${name} wird entfernt oder abgeschaltet`);
    }
    if (
      disabled &&
      !all.some(
        (s) =>
          s.file === file &&
          s.stmt === `alter table public.${disabled[1]} enable trigger ${disabled[2]}`,
      )
    ) {
      violations.push(
        `${file}: Trigger ${disabled[2]} wird abgeschaltet, aber nicht wieder eingeschaltet`,
      );
    }
  }
  // 7. jede Tabelle entzieht anon alles (pglite kennt Supabases Standardrechte nicht – im echten
  //    Projekt hätte anon sonst Grants, auch wenn RLS nichts liefert)
  for (const t of tables) {
    if (!has(new RegExp(`^revoke all on table public\\.${t} from anon$`))) {
      violations.push(`${t}: revoke all on table … from anon fehlt`);
    }
  }

  // anon nur in revoke-Anweisungen (Ausnahme: die öffentlichen Freigabe-Funktionen, genau so);
  // keine Grants an public; RLS nie abschalten
  for (const { file, stmt } of all) {
    if (/\banon\b/.test(stmt) && !stmt.startsWith("revoke ") && !isPublicRpcGrant(stmt)) {
      violations.push(`${file}: „anon“ außerhalb von revoke: ${stmt.slice(0, 80)}`);
    }
    if (/^grant .* to (?:.*,\s*)?public\b/.test(stmt)) {
      violations.push(`${file}: Grant an public: ${stmt.slice(0, 80)}`);
    }
    if (/disable row level security|no force row level security/.test(stmt)) {
      violations.push(`${file}: RLS wird abgeschaltet: ${stmt.slice(0, 80)}`);
    }
    if (/service_role/.test(stmt)) {
      violations.push(`${file}: service_role wird verwendet: ${stmt.slice(0, 80)}`);
    }
  }

  // Funktionen: search_path leer, EXECUTE von public/anon entzogen, security definer nur Seed
  for (const { file, stmt } of all) {
    const fn = /^create (?:or replace )?function public\.(\w+)\(/.exec(stmt)?.[1];
    if (!fn) continue;
    if (!/set search_path = ''/.test(stmt))
      violations.push(`${file}: ${fn} ohne set search_path = ''`);
    const isPublic = PUBLIC_RPC_ALLOWLIST.includes(fn);
    if (/security definer/.test(stmt) && !SECURITY_DEFINER_ALLOWLIST.includes(fn) && !isPublic) {
      violations.push(`${file}: ${fn} ist security definer (nicht erlaubt)`);
    }
    if (isPublic && !/\bstable\b/.test(stmt)) {
      violations.push(`${file}: ${fn} (öffentlich) ist nicht stable`);
    }
    if (!/security (?:invoker|definer)/.test(stmt)) {
      violations.push(`${file}: ${fn} ohne ausdrückliches security invoker/definer`);
    }
    const revoked = all.some(({ stmt: s }) =>
      new RegExp(`^revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon\\b`).test(
        s,
      ),
    );
    if (!revoked) violations.push(`${file}: ${fn}: revoke execute … from public, anon fehlt`);
  }

  // Funktionen nie nachträglich per ALTER ändern (security definer, search_path, Besitzer …
  // gingen sonst am Audit vorbei) – immer `create or replace` mit allen Angaben (Migration 46)
  for (const { file, stmt } of all) {
    if (/^alter (?:function|procedure|routine) public\./.test(stmt)) {
      violations.push(`${file}: Funktion per ALTER geändert: ${stmt.slice(0, 80)}`);
    }
  }

  // Views: security_invoker + Grant an authenticated
  for (const { file, stmt } of all) {
    const view = /^create (?:or replace )?view public\.(\w+)/.exec(stmt)?.[1];
    if (!view) continue;
    if (!/with \(security_invoker = true\)/.test(stmt))
      violations.push(`${file}: View ${view} ohne security_invoker = true`);
    if (!has(new RegExp(`^grant select on table public\\.${view} to authenticated$`))) {
      violations.push(`${file}: View ${view} ohne grant select … to authenticated`);
    }
  }

  return violations;
}
