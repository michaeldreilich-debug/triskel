// ---------------------------------------------------------------
// Ein- und Ausgabe der Sicherung (E32): Ziel und Zugänge aus .env*.local, Ordner, Aufrufe von
// pg_dump/pg_restore/rclone (Zugangsdaten nur über Umgebungsvariablen, nie in der Befehlszeile),
// Log und Mac-Mitteilung. Gemeinsam für scripts/backup-nightly.mts und scripts/backup-restore.mts.
// ---------------------------------------------------------------
import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  EMPTY_STATE,
  isStaleLock,
  type LockInfo,
  parseLock,
  type RunState,
  redact,
} from "./backup.mts";
import { type AgeConfig, ageConfig } from "./backup-age.mts";
import { type R2Access, r2RcloneEnv, resolveR2Access, type Target } from "./backup-r2.mts";
import { ENV_FILES, readEnv, testProject } from "./env.mjs";
import { checkSameProject } from "./guard.mjs";

export type { Target };

export const BUCKETS = ["note-images", "attachments"] as const;

/** Namen der rclone-Verbindungen (nur über Umgebungsvariablen konfiguriert): alter Supabase-Storage, R2. */
const STORE = "sbstore";
const R2_STORE = "r2store";

const DRIVE: Record<Target, string> = {
  prod: "gdrive:Triskel-Backup",
  test: "gdrive:Triskel-Backup-Test",
};

const BIN = {
  pgDump: "/opt/homebrew/opt/libpq/bin/pg_dump",
  pgRestore: "/opt/homebrew/opt/libpq/bin/pg_restore",
  psql: "/opt/homebrew/opt/libpq/bin/psql",
  rclone: "/opt/homebrew/bin/rclone",
};

export const REPO = resolve(import.meta.dirname, "../..");

export interface Context {
  target: Target;
  dbUrl: string;
  /** Verbindung ohne Passwort (für pg_dump), Passwort separat */
  db: { url: string; password: string };
  /** alter Supabase-Storage (Übergang bis zum Widerruf des S3-Schlüssels), sonst null */
  s3: { endpoint: string; region: string; keyId: string; secret: string } | null;
  /** R2 zum Lesen (Sicherung), sonst null */
  r2: R2Access | null;
  /** R2 zum Schreiben (nur Wiederherstellen), sonst null */
  r2Write: R2Access | null;
  /** Stände vor Drive mit age verschlüsseln (R-3), sonst null */
  age: AgeConfig | null;
  drive: string;
  dir: {
    base: string;
    stands: string;
    files: string;
    state: string;
    log: string;
    lock: string;
  };
  secrets: string[];
}

/** Ziel „test“ | „prod“ samt Zugängen; Testziel mit Prod-Schutz (wie tests/guard.ts), beide Ziele mit Projekt-Abgleich. */
export function loadContext(
  target: string | undefined,
  { forRestore = false, forMigrate = false }: { forRestore?: boolean; forMigrate?: boolean } = {},
): Context {
  if (target !== "test" && target !== "prod") {
    throw new Error("Ziel fehlt: test oder prod");
  }
  const env = target === "test" ? testProject().env : readEnv(join(REPO, ENV_FILES.prod));
  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error(`SUPABASE_DB_URL in ${ENV_FILES[target]} ist leer.`);
  // Schutz (T-1): die DB-URL gehört zum Projekt aus NEXT_PUBLIC_SUPABASE_URL – sonst sichert
  // „prod“ eine fremde DB bzw. leert „test“ beim Wiederherstellen eine fremde (etwa Prod)
  const same = checkSameProject({ url: env.NEXT_PUBLIC_SUPABASE_URL, dbUrl });
  if (!same.ok) throw new Error(`${ENV_FILES[target]}: ${same.reason}`);
  const parsed = new URL(dbUrl);
  const password = decodeURIComponent(parsed.password);
  parsed.password = "";
  const s3 =
    env.SUPABASE_S3_ENDPOINT &&
    env.SUPABASE_S3_REGION &&
    env.SUPABASE_S3_ACCESS_KEY_ID &&
    env.SUPABASE_S3_SECRET_ACCESS_KEY
      ? {
          endpoint: env.SUPABASE_S3_ENDPOINT,
          region: env.SUPABASE_S3_REGION,
          keyId: env.SUPABASE_S3_ACCESS_KEY_ID,
          secret: env.SUPABASE_S3_SECRET_ACCESS_KEY,
        }
      : null;
  // BACKUP_BASE_DIR: eigener Ordner für Tests (tests/integration/backup.test.ts)
  // Schutz: der S3-Endpunkt muss zum selben Projekt gehören wie URL und DB-URL des Ziels
  const ref = (url: string | undefined) => /^https?:\/\/([a-z0-9]+)\./i.exec(url ?? "")?.[1];
  if (s3 && ref(s3.endpoint) !== ref(env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error(`SUPABASE_S3_ENDPOINT in ${ENV_FILES[target]} gehört zu einem anderen Projekt`);
  }
  // R2: Bucket und Konto fest je Ziel (Prod nie der Test-Bucket und umgekehrt, backup-r2.mts)
  const r2 = resolveR2Access(target, env, "read", ENV_FILES[target]);
  // Schreib-Zugang: Wiederherstellen (R2_RESTORE_*) bzw. Umzug (R2_MIGRATE_*) – nie beides zugleich
  const r2Write = forMigrate
    ? resolveR2Access(target, env, "migrate", ENV_FILES[target])
    : forRestore
      ? resolveR2Access(target, env, "write", ENV_FILES[target])
      : null;
  const base = process.env.BACKUP_BASE_DIR || join(REPO, ".backups", "nachts", target);
  // age (R-3): aus der Umgebungsdatei; Tests geben die Schlüssel über den Prozess mit
  const age = ageConfig(
    {
      BACKUP_AGE_RECIPIENT: process.env.BACKUP_AGE_RECIPIENT ?? env.BACKUP_AGE_RECIPIENT,
      BACKUP_AGE_IDENTITY: process.env.BACKUP_AGE_IDENTITY ?? env.BACKUP_AGE_IDENTITY,
    },
    ENV_FILES[target],
  );
  return {
    target,
    dbUrl,
    db: { url: parsed.toString(), password },
    s3,
    r2,
    r2Write,
    age,
    drive: process.env.BACKUP_DRIVE_REMOTE || DRIVE[target],
    dir: {
      base,
      stands: join(base, "sicherungen"),
      files: join(base, "dateien"),
      state: join(base, "zustand.json"),
      log: join(base, "lauf.log"),
      lock: join(base, ".lauf.lock"),
    },
    secrets: [
      password,
      dbUrl,
      s3?.keyId,
      s3?.secret,
      r2?.keyId,
      r2?.secret,
      r2Write?.keyId,
      r2Write?.secret,
      age?.identity ?? undefined,
    ].filter((s): s is string => Boolean(s)),
  };
}

/** Ordner anlegen, nur für den eigenen Nutzer lesbar. */
export function ensureDirs(ctx: Context): void {
  mkdirSync(ctx.dir.base, { recursive: true, mode: 0o700 });
  mkdirSync(ctx.dir.stands, { recursive: true, mode: 0o700 });
  mkdirSync(ctx.dir.files, { recursive: true, mode: 0o700 });
}

// ---------- Log ----------

const LOG_MAX_BYTES = 1024 * 1024;

export function makeLogger(ctx: Context, { quiet = false } = {}) {
  return (message: string) => {
    const line = `${new Date().toISOString()} ${redact(message, ctx.secrets)}`;
    if (!quiet) process.stdout.write(`${line}\n`);
    try {
      if (existsSync(ctx.dir.log) && statSync(ctx.dir.log).size > LOG_MAX_BYTES) {
        const keep = readFileSync(ctx.dir.log, "utf8").slice(-LOG_MAX_BYTES / 2);
        writeFileSync(ctx.dir.log, keep, { mode: 0o600 });
      }
      appendFileSync(ctx.dir.log, `${line}\n`, { mode: 0o600 });
    } catch {
      // Log ist Beiwerk – ein voller Datenträger meldet sich ohnehin beim Sichern
    }
  };
}

// ---------- Zustand ----------

export function readState(ctx: Context): RunState {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(readFileSync(ctx.dir.state, "utf8")) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function writeState(ctx: Context, state: RunState): void {
  writeFileSync(ctx.dir.state, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

// ---------- Sperre (nie zwei Läufe gleichzeitig) ----------

/** Läuft unter dieser PID gerade ein Sicherungs-Lauf? (PIDs vergibt macOS nach Neustart neu) */
export function isBackupRun(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    // weg – oder (EPERM) ein Prozess eines anderen Nutzers, also kein eigener Lauf
    return false;
  }
  try {
    const command = execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /backup-(nightly|restore)/.test(command);
  } catch {
    return false; // ps findet den Prozess nicht mehr
  }
}

function readLock(file: string): LockInfo | null | undefined {
  try {
    return parseLock(readFileSync(file, "utf8"), statSync(file).mtime);
  } catch {
    return undefined; // keine Sperre (mehr)
  }
}

export type LockResult = { ok: true; takenOver: LockInfo | null } | { ok: false; held: LockInfo };

/**
 * Sperre atomar anlegen (`wx`, T-2). Eine verwaiste Sperre (Prozess weg, PID an etwas anderes
 * vergeben, älter als 3 h) wird übernommen; sonst `ok: false` mit der fremden Sperre.
 */
export function acquireLock(
  ctx: { dir: { lock: string } },
  now: Date = new Date(),
  backupRun: (pid: number) => boolean = isBackupRun,
): LockResult {
  const content = JSON.stringify({ pid: process.pid, started: now.toISOString() });
  let takenOver: LockInfo | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(ctx.dir.lock, content, { flag: "wx", mode: 0o600 });
      return { ok: true, takenOver };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const held = readLock(ctx.dir.lock);
    if (held === undefined) continue; // eben freigegeben – noch einmal
    if (held && !isStaleLock(held, now, backupRun)) return { ok: false, held };
    takenOver = held;
    try {
      unlinkSync(ctx.dir.lock);
    } catch {
      // hat ein anderer Lauf schon entfernt
    }
  }
  const held = readLock(ctx.dir.lock);
  return { ok: false, held: held ?? { pid: 0, started: now.toISOString() } };
}

export function releaseLock(ctx: { dir: { lock: string } }): void {
  try {
    if (readLock(ctx.dir.lock)?.pid === process.pid) unlinkSync(ctx.dir.lock);
  } catch {
    // schon weg
  }
}

// ---------- Programme aufrufen ----------

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Programm ausführen; Fehlertext ohne Zugangsdaten, gekürzt. */
export function run(
  ctx: Context,
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(new Error(redact(String(error), ctx.secrets))));
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else {
        const name = cmd.split("/").pop();
        const detail = redact(stderr.trim(), ctx.secrets).split("\n").slice(-6).join(" | ");
        reject(new Error(`${name} brach ab (Code ${code}): ${detail}`));
      }
    });
  });
}

/** pg_dump/pg_restore/psql: Passwort über PGPASSWORD, nicht in der Befehlszeile. */
export function pg(ctx: Context, tool: "pgDump" | "pgRestore" | "psql", args: string[]) {
  return run(ctx, BIN[tool], args, { PGPASSWORD: ctx.db.password, PGCONNECT_TIMEOUT: "30" });
}

/**
 * rclone mit den Storage-Verbindungen `sbstore:` (Supabase) und `r2store:` (R2) aus
 * Umgebungsvariablen; `write: true` nimmt für R2 den Schreib-Zugang (nur Wiederherstellen).
 */
export function rclone(ctx: Context, args: string[], { write = false } = {}) {
  const env: Record<string, string> = {};
  const r2 = write ? ctx.r2Write : ctx.r2;
  if (r2) Object.assign(env, r2RcloneEnv(R2_STORE, r2));
  if (ctx.s3) {
    const prefix = `RCLONE_CONFIG_${STORE.toUpperCase()}_`;
    Object.assign(env, {
      [`${prefix}TYPE`]: "s3",
      [`${prefix}PROVIDER`]: "Other",
      [`${prefix}ENDPOINT`]: ctx.s3.endpoint,
      [`${prefix}REGION`]: ctx.s3.region,
      [`${prefix}ACCESS_KEY_ID`]: ctx.s3.keyId,
      [`${prefix}SECRET_ACCESS_KEY`]: ctx.s3.secret,
      [`${prefix}FORCE_PATH_STYLE`]: "true",
      [`${prefix}NO_CHECK_BUCKET`]: "true",
    });
  }
  return run(ctx, BIN.rclone, [...args, "--retries", "3", "--low-level-retries", "10"], env);
}

export const store = (bucket: string) => `${STORE}:${bucket}`;
/** Ordner eines alten Buckets in R2 (`<bucket>/…` im neuen Bucket). */
export const r2Store = (access: R2Access, bucket: string) =>
  `${R2_STORE}:${access.bucket}/${bucket}`;

export function requireTools(): void {
  for (const [name, path] of Object.entries(BIN)) {
    if (!existsSync(path)) throw new Error(`${name} fehlt (${path}) – brew install libpq rclone`);
  }
}

// ---------- Mac-Mitteilung ----------

export async function notify(ctx: Context, message: string): Promise<void> {
  const title =
    ctx.target === "prod" ? "Schaltzentrale-Sicherung" : "Schaltzentrale-Sicherung (Test)";
  try {
    await run(ctx, "/usr/bin/osascript", [
      "-e",
      "on run argv",
      "-e",
      "display notification (item 1 of argv) with title (item 2 of argv)",
      "-e",
      "end run",
      redact(message, ctx.secrets).slice(0, 220),
      title,
    ]);
  } catch {
    // ohne Mitteilung bleibt der Hinweis in der App (Heute) und das Log
  }
}
