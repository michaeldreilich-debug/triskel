/**
 * Wiederherstellungs-Probe (E32) gegen das Testprojekt – nur mit RESTORE_DRILL=1, denn sie setzt
 * das GANZE Testprojekt auf den Stand der Sicherung zurück (parallel laufende Tests verlören ihre
 * Daten):
 *   RESTORE_DRILL=1 npx vitest run --project integration tests/integration/backup-restore.test.ts
 * Ablauf: Projekt, Aufgabe, Notiz (+ Bild) anlegen → sichern → „Unfall“ (löschen, Titel ändern,
 * Bild weg) → scripts/backup-restore.mts → alles wieder da, genau wie gesichert, Bild für den
 * Nutzer wieder ladbar. Dazu (T-12): eine neuere Tabelle mit Fremdschlüssel auf den Stand (T-3),
 * ein vorhandener, aber unpassender Stand ändert nichts, `--trotzdem` spielt in ein neueres
 * Schema ein.
 */
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { deleteObjects, getObject, putObject } from "@/features/storage/client";
import { objectKey } from "@/features/storage/paths";
import { REPO_ROOT, readEnvFile } from "../support/env-file";
import { testR2Config } from "../support/media";
import { runMarker, userClient } from "../support/supabase-node";

const drill = process.env.RESTORE_DRILL === "1";
const exec = promisify(execFile);
const sessionA = inject("sessionA");
const a = userClient(sessionA);
const env = readEnvFile(".env.test.local");
/** Dateien werden aus R2 gesichert und nach R2 wiederhergestellt (Test-Bucket) */
const r2 = testR2Config();
const hasFiles = r2 !== null;
const base = mkdtempSync(join(tmpdir(), "schaltzentrale-restore-"));
const marker = runMarker();
const ids = {
  project: crypto.randomUUID(),
  task: crypto.randomUUID(),
  note: crypto.randomUUID(),
};
const imagePath = `${sessionA.userId}/${ids.note}/${crypto.randomUUID()}.png`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function script(name: string, ...args: string[]) {
  const all = [`scripts/${name}`, "test", ...args, ...(hasFiles ? [] : ["--ohne-dateien"])];
  try {
    const { stdout, stderr } = await exec(process.execPath, all, {
      cwd: REPO_ROOT,
      env: { ...process.env, BACKUP_BASE_DIR: base },
      timeout: 180_000,
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Was der Nutzer von seinen drei Einträgen sieht (mit allen Zeitstempeln). */
async function snapshot() {
  const [project, task, note] = await Promise.all([
    a.from("projects").select("*").eq("id", ids.project).maybeSingle(),
    a.from("tasks").select("*").eq("id", ids.task).maybeSingle(),
    a.from("notes").select("*").eq("id", ids.note).maybeSingle(),
  ]);
  return { project: project.data, task: task.data, note: note.data };
}

let areaId = "";
/** Stand aus dem ersten Fall – die weiteren Fälle spielen Abwandlungen davon ein */
let stand = "";
const PROBE = "e2e_restore_probe";

/** Direkter SQL-Zugang zum Testprojekt (Schutz: global-setup prüft das Ziel vorher). */
async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(env.SUPABASE_DB_URL ?? "", { max: 1, prepare: false, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Kopie des Stands unter neuem Namen, `info.json` abgewandelt. */
function variant(name: string, change: (info: Record<string, unknown>) => void) {
  const from = join(base, "sicherungen", stand);
  const to = join(base, "sicherungen", name);
  cpSync(from, to, { recursive: true });
  const info = JSON.parse(readFileSync(join(to, "info.json"), "utf8"));
  change(info);
  writeFileSync(join(to, "info.json"), JSON.stringify(info));
  return name;
}

beforeAll(async () => {
  if (!drill) return;
  const { data } = await a.from("areas").select("id").order("sort").limit(1).single();
  areaId = data?.id ?? "";
  const project = await a.from("projects").insert({
    id: ids.project,
    area_id: areaId,
    title: `Probe ${marker}`,
    status: "aktiv",
    sort: "a0",
  });
  expect(project.error).toBeNull();
  const task = await a.from("tasks").insert({
    id: ids.task,
    area_id: areaId,
    project_id: ids.project,
    title: `Probe-Aufgabe ${marker}`,
    sort: "a0",
  });
  expect(task.error).toBeNull();
  const note = await a.from("notes").insert({
    id: ids.note,
    area_id: areaId,
    project_id: ids.project,
    title: `Probe-Notiz ${marker}`,
  });
  expect(note.error).toBeNull();
  if (r2) await putObject(r2, objectKey("note-images", imagePath), png, "image/png");
});

afterAll(async () => {
  if (drill) {
    await withSql((sql) => sql.unsafe(`drop table if exists public.${PROBE}`));
    await a.from("notes").delete().eq("id", ids.note);
    await a.from("tasks").delete().eq("id", ids.task);
    await a.from("projects").delete().eq("id", ids.project);
    if (r2) await deleteObjects(r2, [objectKey("note-images", imagePath)]);
  }
  rmSync(base, { recursive: true, force: true });
});

describe.skipIf(!drill)("Wiederherstellungs-Probe (setzt das Testprojekt zurück)", () => {
  it("bringt nach einem „Unfall“ Daten und Bild genau so zurück, wie gesichert", async () => {
    const before = await snapshot();
    expect(before.project?.title).toBe(`Probe ${marker}`);

    const backup = await script("backup-nightly.mts", "--jetzt", "--ohne-drive");
    expect(backup.out).toContain("✓ fertig");
    [stand] = readdirSync(join(base, "sicherungen")).filter((n) => /^\d{4}-/.test(n));

    // neuere Tabelle, die der Stand nicht kennt, mit Verweis auf eine Tabelle des Stands (T-3)
    await withSql(async (sql) => {
      await sql.unsafe(
        `create table public.${PROBE} (id uuid primary key, project_id uuid not null references public.projects(id))`,
      );
      await sql.unsafe(`insert into public.${PROBE} values (gen_random_uuid(), '${ids.project}')`);
    });

    // „Unfall“: Aufgabe und Notiz weg, Projekt umbenannt, Bild gelöscht
    expect((await a.from("notes").delete().eq("id", ids.note)).error).toBeNull();
    expect((await a.from("tasks").delete().eq("id", ids.task)).error).toBeNull();
    await a.from("projects").update({ title: "kaputt" }).eq("id", ids.project);
    if (r2) await deleteObjects(r2, [objectKey("note-images", imagePath)]);
    const broken = await snapshot();
    expect(broken.note).toBeNull();
    expect(broken.project?.title).toBe("kaputt");

    // erst nur prüfen (ändert nichts), dann wiederherstellen
    const check = await script("backup-restore.mts", stand, "--pruefen");
    expect(check.out).toContain("Stand passt zum Ziel");
    expect(check.code).toBe(0);
    const restore = await script("backup-restore.mts", stand);
    expect(restore.out).toContain(`✓ Stand ${stand} wiederhergestellt`);
    expect(restore.code).toBe(0);
    expect(restore.out).not.toMatch(/postgres(ql)?:\/\//);
    // die neuere Tabelle wird genannt und geleert (ihre Zeile zeigte sonst ins Leere)
    expect(restore.out).toContain(`Nicht im Stand, werden geleert: ${PROBE}`);
    const [{ n }] = await withSql((sql) =>
      sql.unsafe<{ n: number }[]>(`select count(*)::int as n from public.${PROBE}`),
    );
    expect(n).toBe(0);
    await withSql((sql) => sql.unsafe(`drop table public.${PROBE}`));

    // genau wie vorher – auch updated_at/edited_at (Trigger waren beim Einspielen aus)
    expect(await snapshot()).toEqual(before);
    if (r2) {
      const down = await getObject(r2, objectKey("note-images", imagePath));
      expect(down).not.toBeNull();
      expect(Buffer.from(down?.body ?? new ArrayBuffer(0)).equals(png)).toBe(true);
    }
  }, 300_000);

  it("verweigert einen Stand, der nicht passt, ohne etwas zu ändern", async () => {
    const missing = await script("backup-restore.mts", "1999-01-01-0000");
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/nicht gefunden/);

    // vorhanden, aber neuere Migration und ein Konto, das es im Ziel nicht gibt
    const wrong = variant("1999-01-01-0001", (info) => {
      info.migration = "29991231235959";
      info.nutzer = [...(info.nutzer as unknown[]), { id: crypto.randomUUID(), email: null }];
    });
    await a.from("projects").update({ title: "nach der Probe" }).eq("id", ids.project);
    const result = await script("backup-restore.mts", wrong);
    expect(result.code).toBe(1);
    expect(result.out).toContain("erst die Migrationen im Ziel einspielen");
    expect(result.out).toMatch(/Konto .* fehlt im Ziel/);
    expect(result.out).toContain("nichts geändert");
    expect((await snapshot()).project?.title).toBe("nach der Probe");
  }, 120_000);

  it("spielt mit --trotzdem einen älteren Stand in das neuere Schema ein", async () => {
    const older = variant("1999-01-01-0002", (info) => {
      info.migration = "20000101000000";
    });
    const refused = await script("backup-restore.mts", older, "--ohne-dateien");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("mit --trotzdem in das neuere Schema einspielen");

    const restore = await script("backup-restore.mts", older, "--trotzdem", "--ohne-dateien");
    expect(restore.out).toContain("neuere Spalten bekommen ihre Standardwerte");
    expect(restore.out).toContain(`✓ Stand ${older} wiederhergestellt`);
    expect(restore.code).toBe(0);
    expect((await snapshot()).project?.title).toBe(`Probe ${marker}`);
  }, 300_000);
});
