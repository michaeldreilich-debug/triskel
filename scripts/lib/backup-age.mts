// ---------------------------------------------------------------
// Stände der nächtlichen Sicherung verschlüsseln (Review Teil B, R-3): Der Dump enthält alle
// Inhalte samt geheimer iCal-Adressen und Freigabe-Token. Nach Google Drive geht deshalb nur
// noch die mit `age` verschlüsselte Fassung (db.dump.age, info.json.age, dateien.json.age) –
// sobald BACKUP_AGE_RECIPIENT in .env.local steht. Der private Schlüssel (BACKUP_AGE_IDENTITY)
// liegt nur in .env.local (nicht im Drive-Spiegel, nicht im Repo) und zusätzlich im
// Passwort-Manager; ohne ihn ist ein Stand von Drive nicht lesbar (README › Sichern).
// Reine Regeln hier oben (Unit-Test), darunter die Aufrufe von `age`.
// ---------------------------------------------------------------
import { chmodSync, existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const AGE_BIN = "/opt/homebrew/bin/age";
export const AGE_KEYGEN_BIN = "/opt/homebrew/bin/age-keygen";

/** Dateien eines Stands, die verschlüsselt nach Drive gehen */
export const STAND_FILES = ["db.dump", "info.json", "dateien.json"] as const;

export interface AgeConfig {
  /** öffentlicher Schlüssel `age1…` – zum Verschlüsseln */
  recipient: string;
  /** privater Schlüssel `AGE-SECRET-KEY-1…` – nur zum Entschlüsseln (Wiederherstellen) */
  identity: string | null;
}

const RECIPIENT = /^age1[a-z0-9]{58}$/;
const IDENTITY = /^AGE-SECRET-KEY-1[A-Z0-9]{58}$/;

/**
 * Aus der Umgebung (.env.local bzw. Prozess): null = keine Verschlüsselung eingerichtet. Ein
 * falsch geformter Wert ist ein Fehler, kein stilles „aus“ – sonst ginge der Stand unverschlüsselt
 * nach Drive, obwohl der Nutzer das Gegenteil wollte.
 */
export function ageConfig(env: Record<string, string | undefined>, file: string): AgeConfig | null {
  const recipient = env.BACKUP_AGE_RECIPIENT?.trim() ?? "";
  const identity = env.BACKUP_AGE_IDENTITY?.trim() ?? "";
  if (!recipient && !identity) return null;
  if (!RECIPIENT.test(recipient)) {
    throw new Error(
      `BACKUP_AGE_RECIPIENT in ${file} ist kein age-Empfänger (age1…, 62 Zeichen) – README › Sichern › Verschlüsselung`,
    );
  }
  if (identity && !IDENTITY.test(identity)) {
    throw new Error(`BACKUP_AGE_IDENTITY in ${file} ist kein age-Schlüssel (AGE-SECRET-KEY-1…)`);
  }
  return { recipient, identity: identity || null };
}

export const encryptedName = (name: string) => `${name}.age`;

/** rclone: Klartext-Dateien eines Stands auslassen (gilt in jeder Ordnertiefe). */
export function plainExcludes(): string[] {
  return STAND_FILES.flatMap((name) => ["--exclude", name]);
}

/** Dateien eines Stands, die noch nicht verschlüsselt neben dem Klartext liegen. */
export function toEncrypt(dir: string): string[] {
  return STAND_FILES.filter(
    (name) => existsSync(join(dir, name)) && !existsSync(join(dir, encryptedName(name))),
  );
}

/** Dateien eines Stands, die nur verschlüsselt vorliegen (z. B. frisch von Drive geholt). */
export function toDecrypt(dir: string): string[] {
  return STAND_FILES.filter(
    (name) => !existsSync(join(dir, name)) && existsSync(join(dir, encryptedName(name))),
  );
}

type Run = (cmd: string, args: string[]) => Promise<unknown>;

/** Alle Klartext-Dateien des Stands verschlüsseln (vorhandene .age bleiben). */
export async function encryptStand(
  age: AgeConfig,
  dir: string,
  run: Run,
  bin = AGE_BIN,
): Promise<string[]> {
  const names = toEncrypt(dir);
  if (names.length === 0) return [];
  if (!existsSync(bin)) {
    throw new Error(
      `age fehlt (${bin}) – brew install age; sonst BACKUP_AGE_* aus .env.local nehmen`,
    );
  }
  for (const name of names) {
    const target = join(dir, encryptedName(name));
    await run(bin, ["-r", age.recipient, "-o", target, join(dir, name)]);
    chmodSync(target, 0o600);
    if (statSync(target).size === 0) throw new Error(`age: ${name} wurde nicht verschlüsselt`);
  }
  return names;
}

/**
 * Nur verschlüsselt vorliegende Dateien entschlüsseln (Wiederherstellen von Drive). Der private
 * Schlüssel geht nur über eine kurzlebige Datei (0600) an `age`, nie über die Befehlszeile.
 */
export async function decryptStand(
  age: AgeConfig,
  dir: string,
  keyDir: string,
  run: Run,
  bin = AGE_BIN,
): Promise<string[]> {
  const names = toDecrypt(dir);
  if (names.length === 0) return [];
  if (!age.identity) {
    throw new Error(
      "Der Stand ist verschlüsselt (age), aber BACKUP_AGE_IDENTITY fehlt in .env.local – den privaten Schlüssel aus dem Passwort-Manager eintragen",
    );
  }
  if (!existsSync(bin)) throw new Error(`age fehlt (${bin}) – brew install age`);
  const keyFile = join(keyDir, `.age-identity-${process.pid}`);
  writeFileSync(keyFile, `${age.identity}\n`, { mode: 0o600 });
  try {
    for (const name of names) {
      const target = join(dir, name);
      await run(bin, ["-d", "-i", keyFile, "-o", target, join(dir, encryptedName(name))]);
      chmodSync(target, 0o600);
    }
  } finally {
    unlinkSync(keyFile);
  }
  return names;
}
