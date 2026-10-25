#!/usr/bin/env node
// ---------------------------------------------------------------
// Umzug der Dateien aus den alten Supabase-Buckets nach Cloudflare R2 (E41, Konzept R2).
//
//   node scripts/r2-umzug.mts test            → Test-Projekt → Bucket triskel-dateien-test
//   node scripts/r2-umzug.mts prod            → Prod → Bucket triskel-dateien (nur nach Freigabe, R7)
//   node scripts/r2-umzug.mts <ziel> --probe  → Trockenlauf: zeigt nur, was kopiert würde
//
// Je alter Bucket (note-images, attachments): `rclone copy --ignore-existing` nach
// <r2-bucket>/<alter-bucket>/… (gleiche Pfade <user>/<besitzer>/<id>.<ext>), danach `rclone check`
// (Größe + Prüfsumme; beide Seiten sind S3 mit MD5-ETag, die Dateien liegen unter dem
// Multipart-Schwellwert – gibt es keinen gemeinsamen Hash, vergleicht rclone nur die Größe und
// meldet das). Läuft beliebig oft: vorhandene Dateien werden nie überschrieben, ein zweiter Lauf
// meldet „nichts Neues“ (Nachkopieren nach dem Live-Gang). Nur `copy` und lesende Befehle –
// nie sync/move/delete/purge; im Supabase-Storage wird nichts verändert.
// Quelle: SUPABASE_S3_* des Ziels; Ziel prod: R2_MIGRATE_* (befristeter Token), test: R2_ACCESS_KEY_ID/….
// Zugangsdaten nur über RCLONE_CONFIG_*-Umgebung, nie in Befehlszeile oder Ausgabe.
// Ergebnis: .backups/umzug/<ziel>/<zeitstempel>.json (gitignored, nur für den eigenen Nutzer).
// ---------------------------------------------------------------
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./lib/backup.mts";
import {
  BUCKETS,
  type Context,
  loadContext,
  REPO,
  r2Store,
  rclone,
  requireTools,
  store,
} from "./lib/backup-io.mts";
import { isEmptyPrefixError } from "./lib/backup-r2.mts";

process.chdir(REPO);

const args = process.argv.slice(2);
const probe = args.includes("--probe");
const [target] = args.filter((a) => !a.startsWith("--"));

interface FileInfo {
  path: string;
  size: number;
}

const sum = (files: FileInfo[]) => files.reduce((n, f) => n + f.size, 0);

/** Dateien eines Ordners (rekursiv); ein leerer/fehlender Präfix zählt als leer. */
async function list(ctx: Context, remote: string): Promise<FileInfo[]> {
  try {
    const { stdout } = await rclone(ctx, ["lsjson", "-R", "--files-only", remote], {
      write: true,
    });
    return (JSON.parse(stdout) as { Path: string; Size: number }[]).map((f) => ({
      path: f.Path,
      size: f.Size,
    }));
  } catch (error) {
    if (isEmptyPrefixError(String((error as Error).message))) return [];
    throw error;
  }
}

/**
 * `rclone check` mit --combined-Datei; Abweichungen lassen rclone mit Fehlercode enden. Nur in
 * eine Richtung (`--one-way`): Jede Datei der Quelle muss gleich in R2 liegen; Dateien, die es nur
 * in R2 gibt (nach dem Live-Gang hochgeladen), sind kein Fehler – sonst schlüge das Nachkopieren fehl.
 */
async function check(ctx: Context, from: string, to: string, combined: string) {
  let failure: string | null = null;
  let stderr = "";
  try {
    ({ stderr } = await rclone(ctx, ["check", "--one-way", from, to, "--combined", combined], {
      write: true,
    }));
  } catch (error) {
    failure = (error as Error).message;
  }
  const lines = existsSync(combined) ? readFileSync(combined, "utf8").split("\n") : [];
  const count = (mark: string) => lines.filter((l) => l.startsWith(`${mark} `)).length;
  return {
    // rclone --combined: „+“ nur in der Quelle (fehlt in R2), „-“ nur in R2 (mit --one-way leer)
    gleich: count("="),
    fehltImZiel: count("+"),
    abweichend: count("*"),
    fehler: count("!"),
    nurHashlos: /no common hash/i.test(stderr),
    failure,
  };
}

async function main() {
  if (target !== "test" && target !== "prod") {
    console.error("Aufruf: node scripts/r2-umzug.mts test|prod [--probe]");
    process.exit(2);
  }
  requireTools();
  const ctx = loadContext(target, { forMigrate: true });
  const say = (message: string) => process.stdout.write(`${redact(message, ctx.secrets)}\n`);
  const r2 = ctx.r2Write;
  if (!r2) {
    const names =
      target === "prod"
        ? "R2_MIGRATE_ACCESS_KEY_ID, R2_MIGRATE_SECRET_ACCESS_KEY"
        : "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY";
    throw new Error(
      `Umzug nicht möglich: ${names} fehlen (R2_ACCOUNT_ID, Schlüssel) in der Zieldatei`,
    );
  }
  if (!ctx.s3) throw new Error("Umzug nicht möglich: SUPABASE_S3_* fehlen in der Zieldatei");

  say(
    `${target === "prod" ? "*** PROD *** " : ""}Umzug Supabase-Storage → R2-Bucket ${r2.bucket} (Ziel ${target})` +
      `${probe ? " – TROCKENLAUF, es wird nichts kopiert" : ""}`,
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(REPO, ".backups", "umzug", target);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const report: Record<string, unknown> = {
    ziel: target,
    r2Bucket: r2.bucket,
    gestartet: new Date().toISOString(),
    trockenlauf: probe,
    buckets: {},
  };
  let ok = true;

  for (const bucket of BUCKETS) {
    const from = store(bucket);
    const to = r2Store(r2, bucket);
    const source = await list(ctx, from);
    const before = new Set((await list(ctx, to)).map((f) => f.path));
    const missing = source.filter((f) => !before.has(f.path));
    say(
      `${bucket}: Quelle ${source.length} Dateien (${sum(source)} B), davon neu für R2: ${missing.length} (${sum(missing)} B)`,
    );
    const entry: Record<string, unknown> = {
      quelle: { dateien: source.length, bytes: sum(source) },
      neu: { dateien: missing.length, bytes: sum(missing) },
    };
    (report.buckets as Record<string, unknown>)[bucket] = entry;
    if (probe) {
      entry.dateiliste = missing;
      continue;
    }
    if (missing.length > 0) {
      await rclone(ctx, ["copy", "--ignore-existing", "--transfers", "4", from, to], {
        write: true,
      });
    } else {
      say(`${bucket}: nichts Neues`);
    }
    const dest = await list(ctx, to);
    entry.ziel = { dateien: dest.length, bytes: sum(dest) };
    // Pfade der Quelle, die nicht oder mit anderer Größe im Ziel stehen
    const destSize = new Map(dest.map((f) => [f.path, f.size]));
    const bad = source.filter((f) => destSize.get(f.path) !== f.size);
    const checked = await check(ctx, from, to, join(outDir, `${stamp}-${bucket}.combined`));
    chmodSync(join(outDir, `${stamp}-${bucket}.combined`), 0o600);
    entry.pruefung = { ...checked, groessenAbweichungen: bad.length };
    entry.dateiliste = source;
    const good = bad.length === 0 && !checked.failure && checked.fehltImZiel === 0;
    ok &&= good;
    say(
      `${bucket}: Ziel ${dest.length} Dateien (${sum(dest)} B); Prüfung ${good ? "in Ordnung" : "FEHLER"}: ` +
        `${checked.gleich} gleich, ${checked.fehltImZiel} fehlen, ${checked.abweichend} abweichend` +
        `${checked.nurHashlos ? " (nur Größe verglichen, kein gemeinsamer Hash)" : ""}`,
    );
    if (checked.failure) say(`${bucket}: ${checked.failure}`);
  }

  report.beendet = new Date().toISOString();
  report.ergebnis = probe ? "trockenlauf" : ok ? "ok" : "fehler";
  const file = join(outDir, `${stamp}${probe ? "-probe" : ""}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  say(`Bericht: ${file.replace(`${REPO}/`, "")}`);
  if (!ok) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(
    `✗ ${String((error as Error).message).replace(/postgres(ql)?:\/\/\S+/g, "<db-url>")}\n`,
  );
  process.exit(1);
});
