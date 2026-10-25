/**
 * Umzug Supabase-Storage → R2 (E41, R5) gegen die Testprojekte: `scripts/r2-umzug.mts test`.
 * Der Umzug kopiert nur Neues (`--ignore-existing`), löscht nie und ist beliebig oft wiederholbar;
 * geprüft werden Trockenlauf (schreibt nichts), echter Lauf mit Prüfung (Größe + Prüfsumme) und die
 * Weigerung ohne Ziel. Ohne S3-Schlüssel des Testprojekts oder R2-Werte wird übersprungen.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, inject, it } from "vitest";
import { deleteObjects, putObject } from "@/features/storage/client";
import { objectKey } from "@/features/storage/paths";
import { REPO_ROOT, readEnvFile } from "../support/env-file";
import { testR2Config } from "../support/media";

const exec = promisify(execFile);
const env = readEnvFile(".env.test.local");
const ready =
  Boolean(env.SUPABASE_S3_ACCESS_KEY_ID && env.SUPABASE_S3_SECRET_ACCESS_KEY) &&
  testR2Config() !== null;

async function umzug(...args: string[]) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["scripts/r2-umzug.mts", ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      timeout: 120_000,
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("Umzug nach R2 (Ziel test)", () => {
  it("ohne Ziel: Abbruch mit Aufruf-Hinweis, nichts geschieht", async () => {
    const result = await umzug();
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("Aufruf");
  });

  it.skipIf(!ready)(
    "Trockenlauf kopiert nichts, echter Lauf prüft ohne Fehler",
    async () => {
      const probe = await umzug("test", "--probe");
      expect(probe.code).toBe(0);
      expect(probe.out).toContain("TROCKENLAUF");
      expect(probe.out).toContain("triskel-dateien-test");

      const real = await umzug("test");
      expect(real.code).toBe(0);
      expect(real.out).not.toContain("FEHLER");
      expect(real.out).toMatch(/note-images: Ziel \d+ Dateien .*Prüfung in Ordnung/);
      expect(real.out).toMatch(/attachments: Ziel \d+ Dateien .*Prüfung in Ordnung/);
      // zweiter Lauf: alles schon da. Dazu eine Datei, die es nur in R2 gibt (nach dem Live-Gang
      // hochgeladen) – die Prüfung vergleicht nur in eine Richtung (Quelle → R2), sonst schlüge das
      // Nachkopieren (R7 Schritt 6) immer fehl.
      const r2 = testR2Config();
      if (!r2) throw new Error("R2-Werte fehlen");
      const userId = inject("sessionA").userId;
      const onlyInR2 = objectKey(
        "attachments",
        `${userId}/${crypto.randomUUID()}/${crypto.randomUUID()}.txt`,
      );
      await putObject(r2, onlyInR2, new TextEncoder().encode("nur in R2"), "text/plain");
      try {
        const again = await umzug("test");
        expect(again.code, again.out).toBe(0);
        expect(again.out).toContain("nichts Neues");
        expect(again.out).not.toContain("FEHLER");
      } finally {
        await deleteObjects(r2, [onlyInR2]);
      }
    },
    240_000,
  );
});
