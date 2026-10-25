import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkSameProject,
  checkTestTarget,
  projectRefFromDbUrl,
  projectRefFromUrl,
} from "../guard";
import { parseEnvFile, REPO_ROOT } from "../support/env-file";

const PROD = {
  url: "https://prodref123.supabase.co",
  dbUrl:
    "postgresql://postgres.prodref123:geheim@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
};
const TEST = {
  url: "https://testref456.supabase.co",
  dbUrl:
    "postgresql://postgres.testref456:geheim@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
};

describe("Test-Schutzschalter", () => {
  it("lässt das Testprojekt durch", () => {
    expect(checkTestTarget(TEST, PROD)).toEqual({ ok: true });
  });

  it("bricht bei leerer Test-URL ab", () => {
    const result = checkTestTarget({ url: "" }, PROD);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/leer/);
    expect(checkTestTarget({}, PROD).ok).toBe(false);
    expect(checkTestTarget({ url: "   " }, {}).ok).toBe(false);
  });

  it("verweigert die Prod-URL (auch mit Schrägstrich oder anderer Schreibweise)", () => {
    expect(checkTestTarget({ url: PROD.url }, PROD).ok).toBe(false);
    expect(checkTestTarget({ url: `${PROD.url}/` }, PROD).ok).toBe(false);
    expect(checkTestTarget({ url: PROD.url.toUpperCase() }, PROD).ok).toBe(false);
  });

  it("verweigert eine Prod-DB-URL im Testprojekt", () => {
    expect(checkTestTarget({ url: TEST.url, dbUrl: PROD.dbUrl }, PROD).ok).toBe(false);
  });

  it("verweigert eine DB-URL, die nicht zum Testprojekt gehört", () => {
    const other =
      "postgresql://postgres.anderes789:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
    expect(checkTestTarget({ url: TEST.url, dbUrl: other }, PROD).ok).toBe(false);
  });

  it("erkennt Projekt-Refs aus URL und DB-URL", () => {
    expect(projectRefFromUrl("https://abc123.supabase.co")).toBe("abc123");
    expect(projectRefFromUrl("http://127.0.0.1:54321")).toBeNull();
    expect(projectRefFromDbUrl(TEST.dbUrl)).toBe("testref456");
    expect(
      projectRefFromDbUrl("postgresql://postgres:pw@db.xyz789.supabase.co:5432/postgres"),
    ).toBe("xyz789");
  });
});

describe("Skripte: derselbe Schutz wie die Tests (T-1)", () => {
  const PROD_DIRECT = "postgresql://postgres:geheim@db.prodref123.supabase.co:5432/postgres";
  const envMjs = path.join(REPO_ROOT, "scripts", "lib", "env.mjs");

  /** testProject() in einem eigenen Ordner mit diesen .env-Dateien; Exit-Code des Laufs */
  function runTestProject(test: Record<string, string>, prod: Record<string, string>): number {
    const dir = mkdtempSync(path.join(tmpdir(), "guard-"));
    const write = (file: string, env: Record<string, string>) =>
      writeFileSync(
        path.join(dir, file),
        Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n"),
      );
    write(".env.test.local", test);
    write(".env.local", prod);
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { testProject } from ${JSON.stringify(envMjs)}; testProject();`,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    rmSync(dir, { recursive: true, force: true });
    return run.status ?? -1;
  }
  const testEnv = (dbUrl: string) => ({
    NEXT_PUBLIC_SUPABASE_URL: TEST.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_DB_URL: dbUrl,
  });
  const prodEnv = { NEXT_PUBLIC_SUPABASE_URL: PROD.url, SUPABASE_DB_URL: PROD.dbUrl };

  it("testProject lässt das Testprojekt durch", () => {
    expect(runTestProject(testEnv(TEST.dbUrl), prodEnv)).toBe(0);
  });

  it("testProject verweigert die direkte Prod-DB-URL (db.<ref>.supabase.co)", () => {
    expect(runTestProject(testEnv(PROD_DIRECT), prodEnv)).toBe(1);
  });

  it("testProject verweigert eine DB-URL eines fremden Projekts", () => {
    const other = "postgresql://postgres:pw@db.anderes789.supabase.co:5432/postgres";
    expect(runTestProject(testEnv(other), prodEnv)).toBe(1);
  });

  it("checkSameProject: DB-URL muss zum Projekt der URL gehören (beide Ziele)", () => {
    expect(checkSameProject(PROD).ok).toBe(true);
    expect(checkSameProject({ url: PROD.url, dbUrl: PROD_DIRECT }).ok).toBe(true);
    expect(checkSameProject({ url: PROD.url, dbUrl: TEST.dbUrl }).ok).toBe(false);
    expect(checkSameProject({ url: TEST.url, dbUrl: PROD_DIRECT }).ok).toBe(false);
    // unbekannte Form der DB-URL: lieber abbrechen als eine fremde DB sichern
    expect(checkSameProject({ url: PROD.url, dbUrl: "postgresql://u:p@localhost:5432/x" }).ok).toBe(
      false,
    );
    expect(checkSameProject({ url: PROD.url, dbUrl: "" }).ok).toBe(false);
  });
});

describe("parseEnvFile", () => {
  it("liest Schlüssel, ignoriert Kommentare und entfernt Anführungszeichen", () => {
    const env = parseEnvFile(
      [
        "# Kommentar",
        "A=1",
        'B="mit # Raute"',
        "C='einfach'",
        "D=wert # Kommentar",
        "E=",
        "export F=x",
        "kaputt",
      ].join("\n"),
    );
    expect(env).toEqual({ A: "1", B: "mit # Raute", C: "einfach", D: "wert", E: "", F: "x" });
  });
});
