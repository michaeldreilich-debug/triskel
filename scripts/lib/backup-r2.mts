// ---------------------------------------------------------------
// Reine Teile der Datei-Sicherung mit Cloudflare R2 (E41) – ohne Netz und ohne Dateizugriff,
// damit sie sich als Unit-Test prüfen lassen: Zugang je Ziel, Bucket-Schutz, rclone-Umgebung
// (Zugangsdaten nur dort, nie in der Befehlszeile) und die Vereinigung der Datei-Listen aus
// mehreren Quellen (Übergang: R2 und die alten Supabase-Buckets).
// ---------------------------------------------------------------
import type { ManifestEntry } from "./backup.mts";

export type Target = "test" | "prod";
export type Env = Record<string, string | undefined>;

/** Buckets fest im Skript – nie aus `R2_BUCKET` (ein falscher Eintrag darf Prod nicht treffen). */
export const R2_BUCKET_BY_TARGET: Record<Target, string> = {
  prod: "triskel-dateien",
  test: "triskel-dateien-test",
};

/** Namen der Werte je Ziel und Zweck (Lesen für die Sicherung, Schreiben für die Wiederherstellung). */
const NAMES = {
  read: {
    prod: { keyId: "R2_BACKUP_ACCESS_KEY_ID", secret: "R2_BACKUP_SECRET_ACCESS_KEY" },
    test: { keyId: "R2_ACCESS_KEY_ID", secret: "R2_SECRET_ACCESS_KEY" },
  },
  write: {
    prod: { keyId: "R2_RESTORE_ACCESS_KEY_ID", secret: "R2_RESTORE_SECRET_ACCESS_KEY" },
    test: { keyId: "R2_ACCESS_KEY_ID", secret: "R2_SECRET_ACCESS_KEY" },
  },
  // befristeter Schreib-Token nur für den Umzug aus Supabase (scripts/r2-umzug.mts)
  migrate: {
    prod: { keyId: "R2_MIGRATE_ACCESS_KEY_ID", secret: "R2_MIGRATE_SECRET_ACCESS_KEY" },
    test: { keyId: "R2_ACCESS_KEY_ID", secret: "R2_SECRET_ACCESS_KEY" },
  },
} as const;

export interface R2Access {
  endpoint: string;
  bucket: string;
  keyId: string;
  secret: string;
}

export const r2Endpoint = (accountId: string) => `https://${accountId}.eu.r2.cloudflarestorage.com`;

const clean = (value: string | undefined) => (value ?? "").trim();

/**
 * R2-Zugang aus der Zieldatei. `null` = keine Schlüssel eingetragen (Übergang: nur Supabase);
 * halb eingetragen oder mit falschem Bucket ist ein Fehler (Namen, nie Werte, in der Meldung).
 */
export function resolveR2Access(
  target: Target,
  env: Env,
  purpose: "read" | "write" | "migrate",
  file: string,
): R2Access | null {
  const names = NAMES[purpose][target];
  const account = clean(env.R2_ACCOUNT_ID);
  const keyId = clean(env[names.keyId]);
  const secret = clean(env[names.secret]);
  // keine Schlüssel eingetragen (auch wenn nur die Konto-ID dasteht) = nicht eingerichtet
  if (!keyId && !secret) return null;
  const missing = [
    ["R2_ACCOUNT_ID", account],
    [names.keyId, keyId],
    [names.secret, secret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0)
    throw new Error(`R2-Zugang unvollständig: ${missing.join(", ")} in ${file}`);
  if (!/^[0-9a-f]{32}$/i.test(account)) {
    throw new Error(`R2_ACCOUNT_ID in ${file} ist keine Konto-ID (32 Zeichen)`);
  }
  const access = {
    endpoint: r2Endpoint(account),
    bucket: R2_BUCKET_BY_TARGET[target],
    keyId,
    secret,
  };
  assertR2Bucket(target, access.bucket);
  return access;
}

/** Prod nie den Test-Bucket, Test nie den Prod-Bucket. */
export function assertR2Bucket(target: Target, bucket: string): void {
  if (bucket !== R2_BUCKET_BY_TARGET[target]) {
    throw new Error(
      `Ziel ${target} darf nur den R2-Bucket ${R2_BUCKET_BY_TARGET[target]} benutzen`,
    );
  }
}

/** rclone-Verbindung `<name>:` für R2 – nur als Umgebungsvariablen `RCLONE_CONFIG_<NAME>_*`. */
export function r2RcloneEnv(name: string, access: R2Access): Record<string, string> {
  const prefix = `RCLONE_CONFIG_${name.toUpperCase()}_`;
  return {
    [`${prefix}TYPE`]: "s3",
    [`${prefix}PROVIDER`]: "Cloudflare",
    [`${prefix}ENDPOINT`]: access.endpoint,
    [`${prefix}REGION`]: "auto",
    [`${prefix}ACCESS_KEY_ID`]: access.keyId,
    [`${prefix}SECRET_ACCESS_KEY`]: access.secret,
    [`${prefix}NO_CHECK_BUCKET`]: "true",
  };
}

export interface SourceList {
  /** Anzeigename der Quelle: "r2" | "supabase" */
  source: string;
  entries: ManifestEntry[];
}

/**
 * Vereinigung der Listen aller Quellen nach Pfad. Gleicher Pfad mit gleicher Größe = dieselbe
 * Datei (Pfade sind unveränderlich). Unterschiedliche Größe ist ein Fehler – nichts wird
 * stillschweigend überschrieben.
 */
export function mergeManifests(bucket: string, lists: SourceList[]): ManifestEntry[] {
  const byPath = new Map<string, { entry: ManifestEntry; source: string }>();
  for (const { source, entries } of lists) {
    for (const entry of entries) {
      const known = byPath.get(entry.path);
      if (!known) {
        byPath.set(entry.path, { entry, source });
      } else if (known.entry.size !== entry.size) {
        throw new Error(
          `${bucket}/${entry.path}: ${known.source} hat ${known.entry.size} B, ${source} hat ${entry.size} B – ` +
            "gleicher Pfad, andere Größe; nichts überschrieben",
        );
      } else if (!known.entry.md5 && entry.md5) {
        known.entry.md5 = entry.md5;
      }
    }
  }
  return [...byPath.values()].map((v) => v.entry).sort((a, b) => a.path.localeCompare(b.path));
}

/** rclone meldet einen leeren/fehlenden Ordner (S3: Präfix ohne Objekte) als Fehler 3. */
export const isEmptyPrefixError = (message: string) => /directory not found/i.test(message);
