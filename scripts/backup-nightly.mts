#!/usr/bin/env node
// ---------------------------------------------------------------
// Nächtliche Sicherung (E32): Datenbank (Schema public) UND die Dateien der Buckets
// note-images und attachments – lokal nach .backups/nachts/<ziel>/ und weiter nach Google Drive.
//
//   node scripts/backup-nightly.mts prod            → sichert, wenn heute Nacht noch nicht gesichert
//   node scripts/backup-nightly.mts prod --jetzt    → sichert sofort (z. B. vor einer Migration)
//   node scripts/backup-nightly.mts test --ohne-drive
//   (launchd ruft stündlich mit --nachts auf: ohne Ausgabe, wenn nichts fällig ist)
//
// Ablage je Ziel:
//   sicherungen/JJJJ-MM-TT-HHMM/db.dump      pg_dump (custom), gleicher Schnappschuss wie info.json
//   sicherungen/JJJJ-MM-TT-HHMM/info.json    Zeilen je Tabelle, Migration, Nutzer, Summen
//   sicherungen/JJJJ-MM-TT-HHMM/dateien.json Datei-Liste der Buckets zu diesem Stand
//   dateien/<bucket>/…                        Spiegel aller Dateien (nur neue kommen dazu)
// Dateien kommen aus R2 (Schlüssel <bucket>/<pfad>) und – solange SUPABASE_S3_… gesetzt ist –
// aus den Supabase-Buckets; je Bucket gilt die Vereinigung nach Pfad (E41, Übergang ohne Lücke).
// Auf Drive dieselbe Ordnung. Aufgeräumt werden nur Stände (scripts/lib/backup.mts), nie Dateien,
// nie etwas in Prod. Erfolg landet in user_settings.last_backup_at (Hinweis auf „Heute“), ein
// Fehler als Mac-Mitteilung. Gibt nie Zugangsdaten aus.
// ---------------------------------------------------------------
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import {
  formatBytes,
  isDue,
  LOCK_WARN_MS,
  type ManifestEntry,
  manifestFromLsjson,
  manifestTotals,
  type PendingDrive,
  parseStand,
  redact,
  shouldNotifyFailure,
  shouldNotifyRecovery,
  standForDrive,
  standName,
  standsToDelete,
} from "./lib/backup.mts";
import { encryptStand, plainExcludes } from "./lib/backup-age.mts";
import {
  acquireLock,
  BUCKETS,
  type Context,
  ensureDirs,
  loadContext,
  makeLogger,
  notify,
  pg,
  REPO,
  r2Store,
  rclone,
  readState,
  releaseLock,
  requireTools,
  run,
  store,
  writeState,
} from "./lib/backup-io.mts";
import { isEmptyPrefixError, mergeManifests, type SourceList } from "./lib/backup-r2.mts";

process.chdir(REPO);

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--"));
const force = args.includes("--jetzt");
const noDrive = args.includes("--ohne-drive");
const noFiles = args.includes("--ohne-dateien");
const nightly = args.includes("--nachts");

type Summary = {
  stand: string;
  zeilen: number;
  db_bytes: number;
  dateien: number;
  dateien_bytes: number;
  drive: boolean;
  dauer_s: number;
};

type Log = (message: string) => void;

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Nur Drive ist gescheitert – der Stand liegt fertig auf dem Mac (T-8). */
class DriveError extends Error {
  readonly pending: PendingDrive;

  constructor(message: string, pending: PendingDrive) {
    super(
      `Drive: ${message} – Stand ${pending.stand} liegt auf dem Mac, der nächste Lauf holt Drive nach`,
    );
    this.pending = pending;
  }
}

/** Datenbank: Zeilen zählen und pg_dump im selben Schnappschuss (Zahlen passen zum Dump). */
async function dumpDatabase(ctx: Context, dir: string, log: Log) {
  const sql = postgres(ctx.dbUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 30,
  });
  const file = join(dir, "db.dump");
  try {
    return await sql.begin("isolation level repeatable read read only", async (tx) => {
      const [{ snapshot }] = await tx<
        { snapshot: string }[]
      >`select pg_export_snapshot() as snapshot`;
      const tables = await tx<{ name: string }[]>`
        select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`;
      const counts: Record<string, number> = {};
      for (const { name } of tables) {
        const [{ n }] = await tx.unsafe<{ n: number }[]>(
          `select count(*)::int as n from public.${quoteIdent(name)}`,
        );
        counts[name] = n;
      }
      const [{ version }] = await tx<{ version: string | null }[]>`
        select max(version) as version from supabase_migrations.schema_migrations`;
      const users = await tx<{ id: string; email: string | null }[]>`
        select id, email from auth.users order by created_at`;
      await pg(ctx, "pgDump", [
        "--dbname",
        ctx.db.url,
        "--schema=public",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--snapshot=${snapshot}`,
        "--file",
        file,
      ]);
      // Dump lesbar und vollständig? Je Tabelle ein Daten-Eintrag
      const { stdout } = await pg(ctx, "pgRestore", ["--list", file]);
      const dataEntries = stdout.split("\n").filter((line) => / TABLE DATA public /.test(line));
      if (dataEntries.length !== tables.length) {
        throw new Error(
          `Dump unvollständig: ${dataEntries.length} von ${tables.length} Tabellen mit Daten`,
        );
      }
      chmodSync(file, 0o600);
      const bytes = statSync(file).size;
      log(`  Datenbank: ${tables.length} Tabellen, ${formatBytes(bytes)}`);
      return {
        counts,
        migration: version,
        users: users.map((u) => ({ id: u.id, email: u.email })),
        bytes,
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Eine Datei-Quelle eines alten Buckets: R2 (`<bucket>/…`) oder der Supabase-Storage. */
interface FileSource {
  name: "r2" | "supabase";
  remote: string;
}

/** Quellen eines Buckets: R2, und solange der S3-Schlüssel gesetzt ist, auch Supabase (Übergang). */
function sourcesFor(ctx: Context, bucket: string): FileSource[] {
  const sources: FileSource[] = [];
  if (ctx.r2) sources.push({ name: "r2", remote: r2Store(ctx.r2, bucket) });
  if (ctx.s3) sources.push({ name: "supabase", remote: store(bucket) });
  return sources;
}

/** Dateien: Liste je Bucket aus allen Quellen, dann neue Dateien in den Spiegel holen und Stand prüfen. */
async function mirrorFiles(ctx: Context, log: Log) {
  const manifest: Record<string, ManifestEntry[]> = {};
  const used = new Set<string>();
  for (const bucket of BUCKETS) {
    const sources = sourcesFor(ctx, bucket);
    const lists: SourceList[] = [];
    for (const source of sources) {
      let entries: ManifestEntry[] = [];
      try {
        const { stdout } = await rclone(ctx, [
          "lsjson",
          "-R",
          "--files-only",
          "--hash",
          source.remote,
        ]);
        entries = manifestFromLsjson(bucket, stdout);
      } catch (error) {
        // R2: ein Präfix ohne Objekte (noch nichts umgezogen) ist leer, kein Fehler
        if (source.name !== "r2" || !isEmptyPrefixError(String((error as Error).message))) {
          throw error;
        }
      }
      lists.push({ source: source.name, entries });
      if (entries.length > 0) used.add(source.name);
      log(`  ${bucket} ← ${source.name}: ${entries.length} Dateien`);
    }
    // gleicher Pfad mit anderer Größe wirft hier – vor dem ersten Kopieren, nichts wird überschrieben
    const entries = mergeManifests(bucket, lists);
    const local = join(ctx.dir.files, bucket);
    mkdirSync(local, { recursive: true, mode: 0o700 });
    // Pfade sind unveränderlich: gleiche Größe = schon gesichert (spart je Datei eine Anfrage).
    // Nur `copy`, nie sync/delete – weder auf den Quellen noch im Spiegel.
    for (const [index, source] of sources.entries()) {
      if (lists[index].entries.length === 0) continue;
      await rclone(ctx, ["copy", source.remote, local, "--size-only", "--transfers", "4"]);
    }
    // jede Datei der Liste liegt im Spiegel, mit derselben Größe
    const missing = entries.filter((entry) => {
      try {
        return statSync(join(local, entry.path)).size !== entry.size;
      } catch {
        return true;
      }
    });
    if (missing.length > 0) {
      throw new Error(`${missing.length} Datei(en) aus ${bucket} fehlen im Spiegel`);
    }
    manifest[bucket] = entries;
    const totals = manifestTotals(entries);
    log(`  ${bucket}: ${totals.files} Dateien, ${formatBytes(totals.bytes)}`);
  }
  return { manifest, quellen: sourcesNames(ctx), genutzt: [...used] };
}

const sourcesNames = (ctx: Context) =>
  [ctx.r2 ? "r2" : null, ctx.s3 ? "supabase" : null].filter(Boolean);

/**
 * Stand vor Drive verschlüsseln (R-3): db.dump, info.json, dateien.json → *.age neben dem
 * Klartext (der bleibt nur auf dem Mac, außerhalb des Drive-Spiegels). Ohne BACKUP_AGE_* passiert
 * nichts; mit, aber ohne `age`, bricht der Lauf ab, statt Klartext hochzuladen.
 */
async function encryptForDrive(ctx: Context, stand: string, log: Log) {
  if (!ctx.age) return;
  const done = await encryptStand(ctx.age, join(ctx.dir.stands, stand), (cmd, args) =>
    run(ctx, cmd, args),
  );
  if (done.length > 0) log(`  verschlüsselt (age): ${done.join(", ")}`);
}

/** Nach Drive: Dateien und Stände dazukopieren, den neuen Stand und den Spiegel prüfen. */
async function uploadToDrive(ctx: Context, stand: string, log: Log) {
  const drive = ["--fast-list"];
  await encryptForDrive(ctx, stand, log);
  // mit age gehen nur die .age-Fassungen der Stände nach Drive, nie der Klartext
  const plain = ctx.age ? plainExcludes() : [];
  await rclone(ctx, ["copy", ctx.dir.files, `${ctx.drive}/dateien`, "--transfers", "4", ...drive]);
  await rclone(ctx, [
    "copy",
    ctx.dir.stands,
    `${ctx.drive}/sicherungen`,
    "--exclude",
    ".*/**",
    "--exclude",
    ".*",
    ...plain,
    ...drive,
  ]);
  await rclone(ctx, [
    "check",
    join(ctx.dir.stands, stand),
    `${ctx.drive}/sicherungen/${stand}`,
    ...plain,
  ]);
  await rclone(ctx, [
    "check",
    ctx.dir.files,
    `${ctx.drive}/dateien`,
    "--one-way",
    "--size-only",
    ...drive,
  ]);
  log(`  Drive: Stand ${stand} und Dateien angekommen und geprüft`);
}

/** Alte Stände aufräumen – lokal und auf Drive nach derselben Regel, nie Dateien. */
async function prune(ctx: Context, now: Date, withDrive: boolean, log: Log) {
  const local = readdirSync(ctx.dir.stands, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const name of standsToDelete(local, now)) {
    if (!parseStand(name)) continue;
    rmSync(join(ctx.dir.stands, name), { recursive: true, force: true });
    log(`  aufgeräumt (Mac): ${name}`);
  }
  if (!withDrive) return;
  const { stdout } = await rclone(ctx, ["lsf", "--dirs-only", `${ctx.drive}/sicherungen`]);
  const remote = stdout
    .split("\n")
    .map((line) => line.trim().replace(/\/$/, ""))
    .filter(Boolean);
  for (const name of standsToDelete(remote, now)) {
    if (!parseStand(name)) continue;
    // Drive legt Gelöschtes in den Papierkorb (rclone-Standard für Google Drive)
    await rclone(ctx, ["purge", `${ctx.drive}/sicherungen/${name}`]);
    log(`  aufgeräumt (Drive, Papierkorb): ${name}`);
  }
}

/** Erfolg in user_settings eintragen – die App zeigt sonst nach 36 h einen Hinweis. */
async function reportToApp(ctx: Context, at: Date, summary: Summary, log: Log) {
  const sql = postgres(ctx.dbUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 30,
  });
  try {
    const [{ ready }] = await sql<{ ready: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'user_settings'
           and column_name = 'last_backup_at') as ready`;
    if (!ready) {
      log("  App: Spalte last_backup_at fehlt noch (Migration 27) – Meldung übersprungen");
      return;
    }
    await sql`
      update public.user_settings
         set last_backup_at = ${at.toISOString()}, last_backup_summary = ${sql.json(summary)}`;
    log("  App: letzte Sicherung eingetragen");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Stand nach Drive bringen und aufräumen. Scheitert Drive, wird lokal trotzdem aufgeräumt, und
 * der nächste Lauf derselben Nacht holt nur Drive nach (kein neuer voller Stand, T-8).
 */
async function syncDrive(ctx: Context, pending: PendingDrive, now: Date, log: Log) {
  try {
    await uploadToDrive(ctx, pending.stand, log);
    await prune(ctx, now, true, log);
  } catch (error) {
    await prune(ctx, now, false, log).catch(() => {});
    throw new DriveError(String((error as Error).message ?? error), pending);
  }
}

async function backup(ctx: Context, now: Date, log: Log): Promise<Summary> {
  const started = Date.now();
  const stand = standName(now);
  const finalDir = join(ctx.dir.stands, stand);
  const tmpDir = join(ctx.dir.stands, `.${stand}.tmp`);
  if (existsSync(finalDir)) throw new Error(`Stand ${stand} gibt es schon – in einer Minute neu`);
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { mode: 0o700 });
  log(`Sicherung ${ctx.target} → Stand ${stand}`);

  const db = await dumpDatabase(ctx, tmpDir, log);
  const files = noFiles ? null : await mirrorFiles(ctx, log);
  const manifest = files?.manifest ?? {};
  const all = Object.values(manifest).flat();
  const totals = manifestTotals(all);
  const rows = Object.values(db.counts).reduce((sum, n) => sum + n, 0);

  const write = (name: string, value: unknown) =>
    writeFileSync(join(tmpDir, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  write("dateien.json", {
    erstellt: now.toISOString(),
    quellen: files?.quellen ?? [],
    buckets: manifest,
  });
  write("info.json", {
    format: 1,
    stand,
    ziel: ctx.target,
    erstellt: now.toISOString(),
    migration: db.migration,
    tabellen: db.counts,
    zeilen: rows,
    db_bytes: db.bytes,
    dateien: {
      gesichert: !noFiles,
      quellen: files?.quellen ?? [],
      anzahl: totals.files,
      bytes: totals.bytes,
      buckets: Object.fromEntries(
        Object.entries(manifest).map(([bucket, entries]) => [bucket, manifestTotals(entries)]),
      ),
    },
    nutzer: db.users,
  });
  renameSync(tmpDir, finalDir);

  const summary: Summary = {
    stand,
    zeilen: rows,
    db_bytes: db.bytes,
    dateien: totals.files,
    dateien_bytes: totals.bytes,
    drive: !noDrive,
    dauer_s: Math.round((Date.now() - started) / 1000),
  };
  if (noDrive) await prune(ctx, now, false, log);
  else await syncDrive(ctx, { stand, at: now.toISOString(), summary }, now, log);
  return summary;
}

async function main(): Promise<number> {
  let ctx: Context;
  try {
    ctx = loadContext(target);
  } catch (error) {
    console.error(`✗ ${String((error as Error).message)}`);
    console.error("Aufruf: node scripts/backup-nightly.mts test|prod [--jetzt] [--ohne-drive]");
    return 2;
  }
  ensureDirs(ctx);
  // unter launchd nur ins rotierende lauf.log (sonst wüchse launchd.log mit)
  const log = makeLogger(ctx, { quiet: nightly });
  const state = readState(ctx);
  // BACKUP_NOW: feste Uhrzeit nur fürs Testziel (Tests über die Nachtgrenze 02:00, T-13)
  const now =
    ctx.target === "test" && process.env.BACKUP_NOW ? new Date(process.env.BACKUP_NOW) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error("✗ BACKUP_NOW ist kein Zeitpunkt");
    return 2;
  }
  const lastSuccess = state.lastSuccess ? new Date(state.lastSuccess) : null;

  if (!force && !isDue(lastSuccess, now)) {
    if (!nightly) {
      process.stdout.write(
        `Nicht fällig – letzte Sicherung ${lastSuccess?.toLocaleString("de-DE")}. ` +
          "Mit --jetzt trotzdem sichern.\n",
      );
    }
    return 0;
  }
  const lock = acquireLock(ctx, now);
  if (!lock.ok) {
    const since = new Date(lock.held.started);
    if (now.getTime() - since.getTime() < LOCK_WARN_MS) {
      log("Ein anderer Lauf ist noch aktiv – übersprungen");
      return 0;
    }
    // hängt ein Lauf länger als eine Stunde, soll das auffallen (T-2)
    const message = `Ein anderer Lauf (PID ${lock.held.pid}) hält die Sperre seit ${since.toLocaleString("de-DE")} – übersprungen`;
    log(`✗ ${message}`);
    const failed = { ...state, lastError: { at: now.toISOString(), message } };
    if (shouldNotifyFailure(state, now)) {
      await notify(ctx, `Sicherung: ${message}`);
      failed.lastNotified = now.toISOString();
    }
    writeState(ctx, failed);
    return 1;
  }
  if (lock.takenOver) {
    log(
      `  verwaiste Sperre übernommen (PID ${lock.takenOver.pid}, seit ${new Date(lock.takenOver.started).toLocaleString("de-DE")})`,
    );
  }
  try {
    requireTools();
    const envFile = ctx.target === "prod" ? ".env.local" : ".env.test.local";
    if (!ctx.s3 && !ctx.r2 && !noFiles) {
      throw new Error(
        `Kein Datei-Zugang (weder R2_… noch SUPABASE_S3_… in ${envFile}) – Dateien lassen sich nicht sichern`,
      );
    }
    if (!ctx.r2 && !noFiles) {
      log(`! R2-Zugang fehlt in ${envFile} – Dateien nur aus dem Supabase-Storage (Übergang)`);
    }
    // nur Drive fehlte heute Nacht: den fertigen Stand nachreichen statt neu zu sichern (T-8)
    const pending = force || noDrive ? null : standForDrive(state, now);
    let at = now;
    let summary: Summary;
    if (pending && existsSync(join(ctx.dir.stands, pending.stand))) {
      log(`Drive nachholen → Stand ${pending.stand}`);
      await syncDrive(ctx, pending, now, log);
      at = new Date(pending.at);
      summary = { ...(pending.summary as Summary), drive: true };
    } else {
      summary = await backup(ctx, now, log);
    }
    const recovered = shouldNotifyRecovery(state);
    writeState(ctx, {
      lastSuccess: at.toISOString(),
      lastError: null,
      lastNotified: null,
      pendingDrive: null,
    });
    log(
      `✓ fertig in ${summary.dauer_s} s: ${summary.zeilen} Zeilen, ${summary.dateien} Dateien ` +
        `(${formatBytes(summary.dateien_bytes)})`,
    );
    try {
      await reportToApp(ctx, at, summary, log);
    } catch (error) {
      const message = `Sicherung ok, Meldung an die App fehlgeschlagen: ${redact(String((error as Error).message), ctx.secrets)}`;
      log(`! ${message}`);
      await notify(ctx, message);
      return 1;
    }
    if (recovered) await notify(ctx, "Sicherung wieder in Ordnung.");
    return 0;
  } catch (error) {
    const message = redact(String((error as Error).message ?? error), ctx.secrets);
    log(`✗ ${message}`);
    const failed = { ...state, lastError: { at: now.toISOString(), message } };
    if (error instanceof DriveError) failed.pendingDrive = error.pending;
    if (shouldNotifyFailure(state, now)) {
      await notify(ctx, `Sicherung fehlgeschlagen: ${message}`);
      failed.lastNotified = now.toISOString();
    }
    writeState(ctx, failed);
    // Reste eines abgebrochenen Stands entfernen (nie fertige Stände)
    rmSync(join(ctx.dir.stands, `.${standName(now)}.tmp`), { recursive: true, force: true });
    return 1;
  } finally {
    releaseLock(ctx);
  }
}

process.exitCode = await main();
