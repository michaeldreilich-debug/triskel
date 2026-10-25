import { describe, expect, it } from "vitest";
import {
  assertR2Bucket,
  isEmptyPrefixError,
  mergeManifests,
  r2RcloneEnv,
  resolveR2Access,
} from "../../scripts/lib/backup-r2.mts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

describe("R2-Zugang der Sicherung", () => {
  it("prod liest mit den R2_BACKUP_*-Werten aus dem festen Prod-Bucket", () => {
    const access = resolveR2Access(
      "prod",
      {
        R2_ACCOUNT_ID: ACCOUNT,
        R2_BACKUP_ACCESS_KEY_ID: "kennung",
        R2_BACKUP_SECRET_ACCESS_KEY: "geheimnis",
        // darf die Wahl nicht beeinflussen
        R2_BUCKET: "triskel-dateien-test",
        R2_ACCESS_KEY_ID: "anderer",
      },
      "read",
      ".env.local",
    );
    expect(access).toEqual({
      endpoint: `https://${ACCOUNT}.eu.r2.cloudflarestorage.com`,
      bucket: "triskel-dateien",
      keyId: "kennung",
      secret: "geheimnis",
    });
  });

  it("test nimmt R2_ACCESS_KEY_ID und den Test-Bucket, egal was R2_BUCKET sagt", () => {
    const access = resolveR2Access(
      "test",
      {
        R2_ACCOUNT_ID: ACCOUNT,
        R2_ACCESS_KEY_ID: "k",
        R2_SECRET_ACCESS_KEY: "s",
        R2_BUCKET: "triskel-dateien",
      },
      "read",
      ".env.test.local",
    );
    expect(access?.bucket).toBe("triskel-dateien-test");
  });

  it("schreibt in prod nur mit eigenem R2_RESTORE_*-Token", () => {
    const env = {
      R2_ACCOUNT_ID: ACCOUNT,
      R2_BACKUP_ACCESS_KEY_ID: "lesen",
      R2_BACKUP_SECRET_ACCESS_KEY: "lesen-geheim",
    };
    expect(resolveR2Access("prod", env, "write", ".env.local")).toBeNull();
    const withRestore = resolveR2Access(
      "prod",
      { ...env, R2_RESTORE_ACCESS_KEY_ID: "schreiben", R2_RESTORE_SECRET_ACCESS_KEY: "s2" },
      "write",
      ".env.local",
    );
    expect(withRestore?.keyId).toBe("schreiben");
  });

  it("Umzug: prod nur mit R2_MIGRATE_*-Token, nie mit dem Lese- oder Restore-Token", () => {
    const env = {
      R2_ACCOUNT_ID: ACCOUNT,
      R2_BACKUP_ACCESS_KEY_ID: "lesen",
      R2_BACKUP_SECRET_ACCESS_KEY: "lesen-geheim",
      R2_RESTORE_ACCESS_KEY_ID: "restore",
      R2_RESTORE_SECRET_ACCESS_KEY: "restore-geheim",
    };
    expect(resolveR2Access("prod", env, "migrate", ".env.local")).toBeNull();
    const access = resolveR2Access(
      "prod",
      { ...env, R2_MIGRATE_ACCESS_KEY_ID: "umzug", R2_MIGRATE_SECRET_ACCESS_KEY: "umzug-geheim" },
      "migrate",
      ".env.local",
    );
    expect(access).toMatchObject({ bucket: "triskel-dateien", keyId: "umzug" });
  });

  it("ohne alle Werte: null (Übergang nur Supabase); halb gefüllt: Fehler mit Namen, ohne Werte", () => {
    expect(resolveR2Access("prod", {}, "read", ".env.local")).toBeNull();
    const partial = () =>
      resolveR2Access(
        "prod",
        { R2_ACCOUNT_ID: ACCOUNT, R2_BACKUP_ACCESS_KEY_ID: "kennung-wert" },
        "read",
        ".env.local",
      );
    expect(partial).toThrow(/R2_BACKUP_SECRET_ACCESS_KEY/);
    expect(partial).not.toThrow(/kennung-wert/);
    expect(() =>
      resolveR2Access(
        "test",
        { R2_ACCOUNT_ID: "kurz", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" },
        "read",
        ".env.test.local",
      ),
    ).toThrow(/Konto-ID/);
  });

  it("Bucket-Schutz: prod nie der Test-Bucket, test nie der Prod-Bucket", () => {
    expect(() => assertR2Bucket("prod", "triskel-dateien")).not.toThrow();
    expect(() => assertR2Bucket("test", "triskel-dateien-test")).not.toThrow();
    expect(() => assertR2Bucket("prod", "triskel-dateien-test")).toThrow();
    expect(() => assertR2Bucket("test", "triskel-dateien")).toThrow();
  });
});

describe("rclone-Umgebung für R2", () => {
  it("setzt alle Werte als RCLONE_CONFIG_<NAME>_*", () => {
    const env = r2RcloneEnv("r2store", {
      endpoint: "https://x.eu.r2.cloudflarestorage.com",
      bucket: "triskel-dateien",
      keyId: "kennung",
      secret: "geheimnis",
    });
    expect(env.RCLONE_CONFIG_R2STORE_TYPE).toBe("s3");
    expect(env.RCLONE_CONFIG_R2STORE_PROVIDER).toBe("Cloudflare");
    expect(env.RCLONE_CONFIG_R2STORE_ACCESS_KEY_ID).toBe("kennung");
    expect(env.RCLONE_CONFIG_R2STORE_SECRET_ACCESS_KEY).toBe("geheimnis");
    expect(env.RCLONE_CONFIG_R2STORE_NO_CHECK_BUCKET).toBe("true");
    expect(Object.keys(env).every((k) => k.startsWith("RCLONE_CONFIG_R2STORE_"))).toBe(true);
  });
});

describe("Datei-Listen aus mehreren Quellen", () => {
  const file = (path: string, size: number, md5?: string) => ({
    bucket: "note-images",
    path,
    size,
    ...(md5 ? { md5 } : {}),
  });

  it("vereinigt nach Pfad, gleicher Pfad nur einmal, sortiert", () => {
    const merged = mergeManifests("note-images", [
      { source: "r2", entries: [file("u/b.png", 2), file("u/a.png", 1)] },
      { source: "supabase", entries: [file("u/a.png", 1, "abc"), file("u/c.png", 3)] },
    ]);
    expect(merged.map((e) => e.path)).toEqual(["u/a.png", "u/b.png", "u/c.png"]);
    expect(merged[0].md5).toBe("abc");
  });

  it("meldet gleichen Pfad mit anderer Größe als Fehler", () => {
    expect(() =>
      mergeManifests("note-images", [
        { source: "r2", entries: [file("u/a.png", 1)] },
        { source: "supabase", entries: [file("u/a.png", 2)] },
      ]),
    ).toThrow(/gleicher Pfad, andere Größe/);
  });

  it("kommt mit leeren Quellen zurecht (R2 noch leer)", () => {
    expect(
      mergeManifests("attachments", [
        { source: "r2", entries: [] },
        { source: "supabase", entries: [file("u/a.pdf", 5)] },
      ]),
    ).toHaveLength(1);
    expect(mergeManifests("attachments", [])).toEqual([]);
  });

  it("erkennt den leeren Präfix-Fehler von rclone", () => {
    expect(isEmptyPrefixError("rclone brach ab (Code 3): directory not found")).toBe(true);
    expect(isEmptyPrefixError("AccessDenied")).toBe(false);
  });
});
