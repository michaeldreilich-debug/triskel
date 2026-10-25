#!/usr/bin/env node
// ---------------------------------------------------------------
// Wiederherstellen aus der nächtlichen Sicherung (E32) – Anleitung: README › Sichern und Export.
//
//   node scripts/backup-restore.mts test                 → neuester Stand ins Testprojekt
//   node scripts/backup-restore.mts test 2026-10-18-0307 → bestimmter Stand
//   node scripts/backup-restore.mts prod … --ja-prod     → Prod (nur nach Rücksprache mit dem Nutzer)
// Weitere Schalter:
//   --von-drive        Stand und Dateien zuerst von Google Drive holen (z. B. neuer Mac)
//   --nutzer ALT=NEU   neues Projekt: Konto hat eine neue ID (Daten und Datei-Pfade umschreiben)
//   --trotzdem         Ziel hat neuere Migrationen als der Stand
//   --ohne-dateien     nur die Datenbank
//   --pruefen          nur prüfen, ob der Stand passt (ändert nichts)
//
// Ablauf: Stand prüfen (Migration, Konten, Tabellen) → Sicherheits-Dump des Ziels nach
// .backups/vor-wiederherstellung/ → in EINER Transaktion alle public-Tabellen des Ziels leeren
// (auch neuere, die der Stand nicht kennt – sie werden genannt) und die Daten einspielen (Trigger und Fremdschlüssel währenddessen aus, damit Zeitstempel und
// Verweise genau so zurückkommen) → fehlende Dateien laut Datei-Liste nach R2 hochladen (Bucket
// triskel-dateien bzw. -test, Schlüssel <bucket>/<pfad>; vorhandene bleiben, nichts wird gelöscht) → Zeilen und Dateien mit dem Stand vergleichen.
// Gibt nie Zugangsdaten aus.
// ---------------------------------------------------------------
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import {
  checkRestore,
  countDiffs,
  type ManifestEntry,
  mapUserIds,
  parseStand,
  parseUserMap,
  standName,
} from "./lib/backup.mts";
import { decryptStand } from "./lib/backup-age.mts";
import {
  BUCKETS,
  type Context,
  ensureDirs,
  loadContext,
  makeLogger,
  pg,
  REPO,
  r2Store,
  rclone,
  requireTools,
  run,
} from "./lib/backup-io.mts";

process.chdir(REPO);

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const userArgs: string[] = [];
const positional: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--nutzer") userArgs.push(args[++i] ?? "");
  else if (!args[i].startsWith("--")) positional.push(args[i]);
}
const [target, wantedStand] = positional;

type Log = (message: string) => void;

interface StandInfo {
  stand: string;
  migration: string | null;
  tabellen: Record<string, number>;
  nutzer: { id: string; email: string | null }[];
  dateien: { gesichert: boolean };
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

function connect(ctx: Context) {
  return postgres(ctx.dbUrl, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 30 });
}

async function targetFacts(ctx: Context) {
  const sql = connect(ctx);
  try {
    const tables = await sql<{ name: string }[]>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`;
    const [{ version }] = await sql<{ version: string | null }[]>`
      select max(version) as version from supabase_migrations.schema_migrations`;
    const users = await sql<{ id: string }[]>`select id from auth.users`;
    return {
      migration: version,
      tables: tables.map((t) => t.name),
      users: users.map((u) => u.id.toLowerCase()),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function countRows(ctx: Context, tables: string[]) {
  const sql = connect(ctx);
  try {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [{ n }] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public.${quoteIdent(table)}`,
      );
      counts[table] = n;
    }
    return counts;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Stand (und Dateien) von Drive in den lokalen Ordner holen. */
async function fetchFromDrive(ctx: Context, stand: string | undefined, log: Log) {
  log(`Hole ${stand ?? "alle Stände"} und den Datei-Spiegel von Drive …`);
  const from = `${ctx.drive}/sicherungen${stand ? `/${stand}` : ""}`;
  const to = stand ? join(ctx.dir.stands, stand) : ctx.dir.stands;
  await rclone(ctx, ["copy", from, to]);
  if (!flag("--ohne-dateien")) {
    await rclone(ctx, ["copy", `${ctx.drive}/dateien`, ctx.dir.files, "--transfers", "4"]);
  }
}

function pickStand(ctx: Context): string {
  const stands = readdirSync(ctx.dir.stands)
    .filter((name) => parseStand(name))
    .sort();
  const stand = wantedStand ?? stands.at(-1);
  if (!stand || !stands.includes(stand)) {
    throw new Error(
      `Stand ${wantedStand ?? ""} nicht gefunden in ${ctx.dir.stands} (vorhanden: ${stands.slice(-5).join(", ") || "keine"})`,
    );
  }
  return stand;
}

/** Tabellen des Ziels, die der Stand nicht kennt (neuere Migrationen, nur mit --trotzdem). */
const newerTables = (info: StandInfo, targetTables: string[]) =>
  targetTables.filter((table) => !(table in info.tabellen));

/**
 * Daten des Stands in einer Transaktion einspielen. Vorher ALLE public-Tabellen des Ziels leeren
 * (T-3): Verweist eine neuere Tabelle per Fremdschlüssel auf eine des Stands, bräche ein
 * `truncate` nur der Stand-Tabellen ab – und ohne Verweis blieben ihre Zeilen verwaist zurück.
 */
async function restoreData(
  ctx: Context,
  dir: string,
  info: StandInfo,
  targetTables: string[],
  map: Map<string, string>,
  log: Log,
) {
  const work = join(ctx.dir.base, ".wiederherstellung");
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const dataFile = join(work, "daten.sql");
  await pg(ctx, "pgRestore", [
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--file",
    dataFile,
    join(dir, "db.dump"),
  ]);
  if (map.size > 0) {
    writeFileSync(dataFile, mapUserIds(readFileSync(dataFile, "utf8"), map), { mode: 0o600 });
  }
  const tables = [...new Set([...Object.keys(info.tabellen), ...targetTables])].map(
    (t) => `public.${quoteIdent(t)}`,
  );
  // vor dem COMMIT: stimmen die Zeilen nicht, rollt alles zurück (Ziel bleibt wie vorher)
  const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
  const verify = Object.entries(info.tabellen).map(
    ([table, n]) =>
      `  select count(*) into n from public.${quoteIdent(table)};\n` +
      `  if n <> ${n} then raise exception '%: % statt %', ${literal(table)}, n, ${n}; end if;`,
  );
  const wrapper = join(work, "einspielen.sql");
  writeFileSync(
    wrapper,
    [
      "\\set ON_ERROR_STOP on",
      // Trigger (edited_at, Suche, Seeds) und Fremdschlüssel aus: Daten kommen genau so zurück
      "set session_replication_role = replica;",
      `truncate table ${tables.join(", ")};`,
      `\\i '${dataFile}'`,
      "do $$\ndeclare n bigint;\nbegin",
      ...verify,
      "end $$;",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await pg(ctx, "psql", [
    "--no-psqlrc",
    "--quiet",
    "--single-transaction",
    "--set",
    "ON_ERROR_STOP=1",
    "--dbname",
    ctx.db.url,
    "--file",
    wrapper,
  ]);
  for (const file of [dataFile, wrapper]) writeFileSync(file, "");
  log(`  Datenbank: ${Object.keys(info.tabellen).length} Tabellen eingespielt`);
}

/** Fehlende Dateien laut Datei-Liste nach R2 hochladen (`<bucket>/<pfad>`); vorhandene bleiben unangetastet. */
async function restoreFiles(
  ctx: Context,
  dir: string,
  map: Map<string, string>,
  log: Log,
): Promise<string[]> {
  const manifest = JSON.parse(readFileSync(join(dir, "dateien.json"), "utf8")) as {
    buckets: Record<string, ManifestEntry[]>;
  };
  const problems: string[] = [];
  const r2 = ctx.r2Write;
  if (!r2) throw new Error("R2-Schreib-Zugang fehlt");
  for (const bucket of BUCKETS) {
    const entries = manifest.buckets[bucket] ?? [];
    if (entries.length === 0) continue;
    const local = join(ctx.dir.files, bucket);
    const missingLocal = entries.filter((e) => !existsSync(join(local, e.path)));
    if (missingLocal.length > 0) {
      problems.push(`${bucket}: ${missingLocal.length} Datei(en) fehlen im lokalen Spiegel`);
    }
    // Bei neuer Nutzer-ID: Pfade in einem Ordner mit festen Links umschreiben (kein Kopieren)
    let source = local;
    if (map.size > 0) {
      source = join(ctx.dir.base, ".wiederherstellung", "dateien", bucket);
      for (const entry of entries) {
        const from = join(local, entry.path);
        const to = join(source, mapUserIds(entry.path, map));
        if (!existsSync(from) || existsSync(to)) continue;
        mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
        linkSync(from, to);
      }
    }
    const list = join(ctx.dir.base, ".wiederherstellung", `${bucket}.txt`);
    writeFileSync(list, `${entries.map((e) => mapUserIds(e.path, map)).join("\n")}\n`, {
      mode: 0o600,
    });
    // nur kopieren, nie löschen (kein sync/move)
    await rclone(
      ctx,
      [
        "copy",
        source,
        r2Store(r2, bucket),
        "--files-from",
        list,
        "--ignore-existing",
        "--transfers",
        "4",
      ],
      { write: true },
    );
    // prüfen: jede Datei der Liste liegt im Bucket, mit derselben Größe
    const { stdout } = await rclone(ctx, ["lsjson", "-R", "--files-only", r2Store(r2, bucket)], {
      write: true,
    });
    const inBucket = new Map(
      (JSON.parse(stdout) as { Path: string; Size: number }[]).map((r) => [r.Path, r.Size]),
    );
    const wrong = entries.filter((e) => inBucket.get(mapUserIds(e.path, map)) !== e.size);
    if (wrong.length > 0) problems.push(`${bucket}: ${wrong.length} Datei(en) fehlen im Ziel`);
    log(`  ${bucket}: ${entries.length - wrong.length} von ${entries.length} Dateien im Ziel`);
  }
  return problems;
}

async function main(): Promise<number> {
  let ctx: Context;
  let map: Map<string, string>;
  try {
    ctx = loadContext(target, { forRestore: true });
    map = parseUserMap(userArgs);
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    console.error("Aufruf: node scripts/backup-restore.mts test|prod [Stand] [--ja-prod] …");
    return 2;
  }
  if (ctx.target === "prod" && !flag("--ja-prod") && !flag("--pruefen")) {
    console.error("✗ Prod nur mit --ja-prod (und nur nach Rücksprache mit dem Nutzer).");
    return 2;
  }
  ensureDirs(ctx);
  const log = makeLogger(ctx);
  try {
    requireTools();
    const withFiles = !flag("--ohne-dateien");
    // vor jeder Änderung: ohne Schreib-Token für R2 lässt sich nur die Datenbank einspielen
    if (withFiles && !ctx.r2Write) {
      const prod = ctx.target === "prod";
      throw new Error(
        prod
          ? "R2-Schreib-Token fehlt (R2_RESTORE_ACCESS_KEY_ID und R2_RESTORE_SECRET_ACCESS_KEY in .env.local, README › Wiederherstellen) – oder --ohne-dateien für nur die Datenbank"
          : "R2-Zugang fehlt (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.test.local) – oder --ohne-dateien",
      );
    }
    if (flag("--von-drive")) await fetchFromDrive(ctx, wantedStand, log);
    const stand = pickStand(ctx);
    const dir = join(ctx.dir.stands, stand);
    // von Drive geholte Stände liegen nur verschlüsselt vor (R-3): erst entschlüsseln
    if (ctx.age) {
      const decrypted = await decryptStand(ctx.age, dir, ctx.dir.base, (cmd, args) =>
        run(ctx, cmd, args),
      );
      if (decrypted.length > 0) log(`  entschlüsselt (age): ${decrypted.join(", ")}`);
    }
    const info = JSON.parse(readFileSync(join(dir, "info.json"), "utf8")) as StandInfo;
    log(`Wiederherstellen ${ctx.target} ← Stand ${stand}`);

    const facts = await targetFacts(ctx);
    const check = checkRestore(info, facts, map, flag("--trotzdem"));
    for (const warning of check.warnings) log(`  ! ${warning}`);
    const newer = newerTables(info, facts.tables);
    if (newer.length > 0) {
      log(`  ! Nicht im Stand, werden geleert: ${newer.join(", ")}`);
    }
    if (!check.ok) {
      for (const problem of check.problems) log(`  ✗ ${problem}`);
      throw new Error("Stand passt nicht zum Ziel – nichts geändert");
    }
    if (flag("--pruefen")) {
      log("✓ Stand passt zum Ziel (nur geprüft, nichts geändert)");
      return 0;
    }

    // Sicherheits-Dump des Ziels, bevor etwas überschrieben wird
    const safetyDir = join(REPO, ".backups", "vor-wiederherstellung");
    mkdirSync(safetyDir, { recursive: true, mode: 0o700 });
    const safety = join(safetyDir, `${ctx.target}-${standName(new Date())}.dump`);
    await pg(ctx, "pgDump", [
      "--dbname",
      ctx.db.url,
      "--schema=public",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      safety,
    ]);
    chmodSync(safety, 0o600);
    log(`  Sicherheits-Dump des Ziels: ${safety.replace(`${REPO}/`, "")}`);

    await restoreData(ctx, dir, info, facts.tables, map, log);
    const problems: string[] = [];
    const counts = await countRows(ctx, Object.keys(info.tabellen));
    problems.push(...countDiffs(info.tabellen, counts));
    if (withFiles && info.dateien.gesichert)
      problems.push(...(await restoreFiles(ctx, dir, map, log)));
    if (problems.length > 0) {
      for (const problem of problems) log(`  ✗ ${problem}`);
      throw new Error("Wiederhergestellt, aber nicht vollständig – siehe oben");
    }
    const rows = Object.values(counts).reduce((sum, n) => sum + n, 0);
    log(`✓ Stand ${stand} wiederhergestellt: ${rows} Zeilen stimmen mit dem Stand überein.`);
    log("  Die App in jedem Browser neu laden (offene Tabs hätten sonst alte Daten im Speicher).");
    return 0;
  } catch (error) {
    log(`✗ ${(error as Error).message}`);
    return 1;
  }
}

process.exitCode = await main();
