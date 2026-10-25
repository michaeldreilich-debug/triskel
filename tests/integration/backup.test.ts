/**
 * Nächtliche Sicherung (E32) gegen das Testprojekt: scripts/backup-nightly.mts sichert in einen
 * eigenen Temp-Ordner (BACKUP_BASE_DIR), ohne Drive. Prüft Dump, Zahlen, Fälligkeit und – wenn
 * der S3-Zugang des Testprojekts in .env.test.local steht – den Datei-Spiegel. Die Uhrzeit ist
 * fest (BACKUP_NOW), sonst würde ein Lauf über die Nachtgrenze 02:00 rot (T-13). „Drive“ ist im
 * letzten Fall ein lokaler Ordner (rclone kann das).
 */
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ALREADY_EXISTS, deleteObjects, putObject, R2Error } from "@/features/storage/client";
import { objectKey } from "@/features/storage/paths";
import type { Json } from "@/lib/supabase/database.types";
import { REPO_ROOT, readEnvFile } from "../support/env-file";
import { testR2Config } from "../support/media";
import { runMarker, userClient } from "../support/supabase-node";

const exec = promisify(execFile);
const sessionA = inject("sessionA");
const sessionB = inject("sessionB");
const a = userClient(sessionA);
const b = userClient(sessionB);
const env = readEnvFile(".env.test.local");
const hasS3 = Boolean(env.SUPABASE_S3_ACCESS_KEY_ID && env.SUPABASE_S3_SECRET_ACCESS_KEY);
const r2 = testR2Config();
const base = mkdtempSync(join(tmpdir(), "schaltzentrale-backup-"));
const marker = runMarker().replace(/[^a-z0-9-]/gi, "-");
/** feste Uhrzeit für alle Läufe dieser Datei (T-13) */
const NOW = new Date().toISOString();
/**
 * Datei im alten Supabase-Bucket, Datei in R2 und ein Pfad in beiden (Übergang, E41). Seit
 * Migration 44 kann niemand mehr in die alten Buckets schreiben und der Test nichts löschen: die
 * zwei Supabase-Dateien sind feste Vorlagen (einmal per S3-Schlüssel angelegt, bleiben liegen).
 */
const path = `${sessionA.userId}/backup-vorlage/bild.png`;
const bothPath = `${sessionA.userId}/backup-vorlage/beide.png`;
/** Vorlage für den Größenkonflikt: im alten Bucket 1 Pixel-PNG, in R2 (nur im Konflikt-Test) länger */
const conflictPath = `${sessionA.userId}/backup-vorlage/konflikt.png`;
const r2OnlyPath = `${sessionA.userId}/backup-${marker}/nur-r2.png`;
const hasFiles = hasS3 || r2 !== null;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function backup(...flags: string[]) {
  return run({}, "--ohne-drive", ...flags);
}

async function run(extraEnv: Record<string, string>, ...flags: string[]) {
  const args = ["scripts/backup-nightly.mts", "test", ...flags];
  if (!hasFiles && !flags.includes("--ohne-dateien")) args.push("--ohne-dateien");
  try {
    const { stdout, stderr } = await exec(process.execPath, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, BACKUP_BASE_DIR: base, BACKUP_NOW: NOW, ...extraEnv },
      timeout: 120_000,
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const stands = (dir = base) =>
  readdirSync(join(dir, "sicherungen")).filter((name) => /^\d{4}-\d\d-\d\d-\d{4}$/.test(name));

type Reported = { last_backup_at: string | null; last_backup_summary: Json | null };
/** Das Skript trägt den Erfolg bei allen Nutzern ein – danach wieder zurücksetzen. */
const before = new Map<ReturnType<typeof userClient>, Reported>();

async function reported(client: ReturnType<typeof userClient>): Promise<Reported> {
  const { data, error } = await client
    .from("user_settings")
    .select("last_backup_at, last_backup_summary")
    .single();
  expect(error).toBeNull();
  return data as Reported;
}

beforeAll(async () => {
  for (const client of [a, b]) before.set(client, await reported(client));
  if (r2) {
    await putObject(r2, objectKey("note-images", r2OnlyPath), png, "image/png");
    // feste Vorlage: nur anlegen, falls sie fehlt (ein abgebrochener Lauf lässt sie liegen)
    await putObject(r2, objectKey("note-images", bothPath), png, "image/png").catch((error) => {
      if (!(error instanceof R2Error && error.status === ALREADY_EXISTS)) throw error;
    });
  }
  if (!hasS3) return;
  // feste Vorlagen im alten Bucket anlegen, falls sie fehlen (S3-Schlüssel, nur anlegen)
  const local = join(base, "vorlage.png");
  writeFileSync(local, png);
  const prefix = "RCLONE_CONFIG_SBSTORE_";
  const rcloneEnv = {
    ...process.env,
    [`${prefix}TYPE`]: "s3",
    [`${prefix}PROVIDER`]: "Other",
    [`${prefix}ENDPOINT`]: env.SUPABASE_S3_ENDPOINT ?? "",
    [`${prefix}REGION`]: env.SUPABASE_S3_REGION ?? "",
    [`${prefix}ACCESS_KEY_ID`]: env.SUPABASE_S3_ACCESS_KEY_ID ?? "",
    [`${prefix}SECRET_ACCESS_KEY`]: env.SUPABASE_S3_SECRET_ACCESS_KEY ?? "",
    [`${prefix}FORCE_PATH_STYLE`]: "true",
    [`${prefix}NO_CHECK_BUCKET`]: "true",
  };
  for (const target of [path, bothPath, conflictPath]) {
    await exec(
      "/opt/homebrew/bin/rclone",
      ["copyto", "--ignore-existing", local, `sbstore:note-images/${target}`],
      { env: rcloneEnv },
    );
  }
});

afterAll(async () => {
  for (const [client, values] of before) {
    await client.from("user_settings").update(values).not("id", "is", null);
  }
  if (r2) {
    await deleteObjects(r2, [
      objectKey("note-images", r2OnlyPath),
      objectKey("note-images", bothPath),
    ]);
  }
  rmSync(base, { recursive: true, force: true });
});

describe("Nächtliche Sicherung", () => {
  it("sichert Datenbank (und Dateien) in einen Stand mit stimmigen Zahlen", async () => {
    const { code, out } = await backup("--jetzt");
    expect(out).toContain("✓ fertig");
    expect(code).toBe(0);
    // keine Zugangsdaten in der Ausgabe
    expect(out).not.toMatch(/postgres(ql)?:\/\//);
    if (env.SUPABASE_S3_SECRET_ACCESS_KEY)
      expect(out).not.toContain(env.SUPABASE_S3_SECRET_ACCESS_KEY);
    if (env.R2_SECRET_ACCESS_KEY) expect(out).not.toContain(env.R2_SECRET_ACCESS_KEY);

    const [stand] = stands();
    const dir = join(base, "sicherungen", stand);
    const info = JSON.parse(readFileSync(join(dir, "info.json"), "utf8"));
    expect(info.ziel).toBe("test");
    expect(info.migration).toMatch(/^\d{14}$/);
    expect(Object.keys(info.tabellen)).toEqual(
      expect.arrayContaining(["notes", "tasks", "projects", "user_settings", "note_types"]),
    );
    expect(info.nutzer.map((u: { id: string }) => u.id)).toContain(sessionA.userId);

    const { stdout } = await exec("/opt/homebrew/opt/libpq/bin/pg_restore", [
      "--list",
      join(dir, "db.dump"),
    ]);
    expect(stdout).toContain("TABLE DATA public notes");

    // Erfolg steht in user_settings (Hinweis auf „Heute“, Migration 27)
    const now = await reported(a);
    expect(Date.now() - Date.parse(now.last_backup_at ?? "")).toBeLessThan(5 * 60_000);
    expect(now.last_backup_summary).toMatchObject({ stand, drive: false });

    // Dateien aus beiden Quellen: Vereinigung nach Pfad, ein Spiegel, Quellen benannt
    const manifest = JSON.parse(readFileSync(join(dir, "dateien.json"), "utf8"));
    const paths: string[] = manifest.buckets["note-images"].map((e: { path: string }) => e.path);
    expect(manifest.quellen).toEqual([...(r2 ? ["r2"] : []), ...(hasS3 ? ["supabase"] : [])]);
    expect(info.dateien.quellen).toEqual(manifest.quellen);
    const expected = [
      ...(hasS3 ? [path, conflictPath] : []),
      ...(r2 ? [r2OnlyPath] : []),
      bothPath,
    ];
    for (const wanted of hasFiles ? expected : []) {
      expect(paths).toContain(wanted);
      const copy = readFileSync(join(base, "dateien", "note-images", wanted));
      expect(copy.equals(png)).toBe(true);
    }
    // der gemeinsame Pfad steht nur einmal in der Liste
    if (r2 && hasS3) expect(paths.filter((p) => p === bothPath)).toHaveLength(1);
  }, 180_000);

  it.skipIf(!r2 || !hasS3)(
    "meldet gleichen Pfad mit anderer Größe, statt still zu überschreiben",
    async () => {
      const own = mkdtempSync(join(tmpdir(), "schaltzentrale-backup-konflikt-"));
      const conflict = conflictPath;
      const longer = Buffer.concat([png, Buffer.from("x")]);
      try {
        await putObject(
          r2 as NonNullable<typeof r2>,
          objectKey("note-images", conflict),
          longer,
          "image/png",
        );
        const result = await run({ BACKUP_BASE_DIR: own }, "--jetzt");
        expect(result.code).toBe(1);
        expect(result.out).toContain("gleicher Pfad, andere Größe");
        expect(existsSync(join(own, "dateien", "note-images", conflict))).toBe(false);
      } finally {
        await deleteObjects(r2 as NonNullable<typeof r2>, [objectKey("note-images", conflict)]);
        rmSync(own, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it("ist danach bis zur nächsten Nacht nicht mehr fällig", async () => {
    const { code, out } = await backup();
    expect(code).toBe(0);
    expect(out).toContain("Nicht fällig");
    expect(stands()).toHaveLength(1);
    const state = JSON.parse(readFileSync(join(base, "zustand.json"), "utf8"));
    expect(state.lastSuccess).toBeTruthy();
    expect(state.lastError).toBeNull();
    expect(existsSync(join(base, ".lauf.lock"))).toBe(false);
  });

  it("holt nach einem Drive-Fehler nur Drive nach, statt neu zu sichern (T-8)", async () => {
    const own = mkdtempSync(join(tmpdir(), "schaltzentrale-backup-drive-"));
    const drive = join(own, "drive");
    mkdirSync(drive);
    try {
      // Drive gibt es nicht (unbekannte rclone-Verbindung): Stand fertig, Drive offen
      const first = await run(
        { BACKUP_BASE_DIR: join(own, "mac"), BACKUP_DRIVE_REMOTE: "gibt-es-nicht:x" },
        "--jetzt",
        "--ohne-dateien",
      );
      expect(first.code).toBe(1);
      expect(first.out).toContain("liegt auf dem Mac");
      const [stand] = stands(join(own, "mac"));
      const failed = JSON.parse(readFileSync(join(own, "mac", "zustand.json"), "utf8"));
      expect(failed.pendingDrive.stand).toBe(stand);
      expect(failed.lastSuccess).toBeNull();

      // nächster stündlicher Lauf: derselbe Stand geht nach Drive, kein zweiter Dump
      const second = await run(
        { BACKUP_BASE_DIR: join(own, "mac"), BACKUP_DRIVE_REMOTE: drive },
        "--ohne-dateien",
      );
      expect(second.out).toContain(`Drive nachholen → Stand ${stand}`);
      expect(second.code).toBe(0);
      expect(stands(join(own, "mac"))).toEqual([stand]);
      expect(existsSync(join(drive, "sicherungen", stand, "info.json"))).toBe(true);
      const state = JSON.parse(readFileSync(join(own, "mac", "zustand.json"), "utf8"));
      expect(state.pendingDrive).toBeNull();
      expect(state.lastError).toBeNull();
      expect(state.lastSuccess).toBe(failed.pendingDrive.at);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  }, 180_000);
});
