/**
 * Verschlüsselung der Sicherungsstände mit age (Review Teil B, R-3): Regeln ohne `age` selbst –
 * Schlüssel aus der Umgebung, Dateinamen, rclone-Ausschlüsse, was zu ver-/entschlüsseln ist.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ageConfig,
  decryptStand,
  encryptedName,
  encryptStand,
  plainExcludes,
  STAND_FILES,
  toDecrypt,
  toEncrypt,
} from "../../scripts/lib/backup-age.mts";

const RECIPIENT = `age1${"q".repeat(58)}`;
const IDENTITY = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "age-test-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("age: Schlüssel aus .env.local", () => {
  it("ohne Werte aus; Empfänger nötig, privater Schlüssel optional (nur Wiederherstellen)", () => {
    expect(ageConfig({}, ".env.local")).toBeNull();
    expect(ageConfig({ BACKUP_AGE_RECIPIENT: RECIPIENT }, ".env.local")).toEqual({
      recipient: RECIPIENT,
      identity: null,
    });
    expect(
      ageConfig({ BACKUP_AGE_RECIPIENT: ` ${RECIPIENT} `, BACKUP_AGE_IDENTITY: IDENTITY }, "x"),
    ).toEqual({ recipient: RECIPIENT, identity: IDENTITY });
  });

  it("falsch geformte Werte sind ein Fehler, kein stilles „aus“", () => {
    expect(() => ageConfig({ BACKUP_AGE_RECIPIENT: "age1kurz" }, ".env.local")).toThrow(
      /kein age-Empfänger/,
    );
    // nur der private Schlüssel ohne Empfänger: unvollständig → Fehler
    expect(() => ageConfig({ BACKUP_AGE_IDENTITY: IDENTITY }, ".env.local")).toThrow(
      /kein age-Empfänger/,
    );
    expect(() =>
      ageConfig({ BACKUP_AGE_RECIPIENT: RECIPIENT, BACKUP_AGE_IDENTITY: "nope" }, ".env.local"),
    ).toThrow(/kein age-Schlüssel/);
  });
});

describe("age: Dateien eines Stands", () => {
  it("Namen und rclone-Ausschlüsse: nur .age geht nach Drive", () => {
    expect(encryptedName("db.dump")).toBe("db.dump.age");
    expect(plainExcludes()).toEqual([
      "--exclude",
      "db.dump",
      "--exclude",
      "info.json",
      "--exclude",
      "dateien.json",
    ]);
    expect(STAND_FILES).toEqual(["db.dump", "info.json", "dateien.json"]);
  });

  it("zu verschlüsseln: Klartext ohne .age; zu entschlüsseln: .age ohne Klartext", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "db.dump"), "x");
    writeFileSync(join(dir, "info.json"), "{}");
    writeFileSync(join(dir, "info.json.age"), "age");
    writeFileSync(join(dir, "dateien.json.age"), "age");
    expect(toEncrypt(dir)).toEqual(["db.dump"]);
    expect(toDecrypt(dir)).toEqual(["dateien.json"]);
  });

  it("verschlüsseln ruft age je Datei mit Empfänger auf; ohne age-Programm klarer Fehler", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "db.dump"), "dump");
    writeFileSync(join(dir, "info.json"), "{}");
    const calls: string[][] = [];
    const fakeAge = join(dir, "age");
    writeFileSync(fakeAge, "#!/bin/sh\n");
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      // -o <ziel>: etwas hineinschreiben wie age
      writeFileSync(args[args.indexOf("-o") + 1] as string, "verschlüsselt");
    };
    const done = await encryptStand({ recipient: RECIPIENT, identity: null }, dir, run, fakeAge);
    expect(done).toEqual(["db.dump", "info.json"]);
    expect(calls).toEqual([
      [fakeAge, "-r", RECIPIENT, "-o", join(dir, "db.dump.age"), join(dir, "db.dump")],
      [fakeAge, "-r", RECIPIENT, "-o", join(dir, "info.json.age"), join(dir, "info.json")],
    ]);
    // zweiter Lauf: nichts mehr zu tun
    expect(await encryptStand({ recipient: RECIPIENT, identity: null }, dir, run, fakeAge)).toEqual(
      [],
    );
    await expect(
      encryptStand(
        { recipient: RECIPIENT, identity: null },
        (() => {
          const other = tempDir();
          writeFileSync(join(other, "db.dump"), "x");
          return other;
        })(),
        run,
        join(dir, "gibt-es-nicht"),
      ),
    ).rejects.toThrow(/age fehlt/);
  });

  it("entschlüsseln braucht den privaten Schlüssel, gibt ihn nur über eine Datei weiter und räumt sie auf", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "db.dump.age"), "age");
    await expect(
      decryptStand({ recipient: RECIPIENT, identity: null }, dir, dir, async () => {}),
    ).rejects.toThrow(/BACKUP_AGE_IDENTITY fehlt/);
    const fakeAge = join(dir, "age");
    writeFileSync(fakeAge, "#!/bin/sh\n");
    let keyFileSeen = "";
    const run = async (_cmd: string, args: string[]) => {
      keyFileSeen = args[args.indexOf("-i") + 1] as string;
      expect(args).not.toContain(IDENTITY);
      writeFileSync(args[args.indexOf("-o") + 1] as string, "dump");
    };
    const done = await decryptStand(
      { recipient: RECIPIENT, identity: IDENTITY },
      dir,
      dir,
      run,
      fakeAge,
    );
    expect(done).toEqual(["db.dump"]);
    expect(keyFileSeen.startsWith(join(dir, ".age-identity-"))).toBe(true);
    expect(toDecrypt(dir)).toEqual([]);
    // die Schlüsseldatei ist weg
    expect(() => rmSync(keyFileSeen)).toThrow();
  });
});
