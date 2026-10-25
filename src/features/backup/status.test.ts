import { describe, expect, it } from "vitest";
import { backupAgo, backupHint, backupState, parseBackupSummary } from "./status";

const now = new Date("2026-10-18T10:00:00+02:00");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("Stand der nächtlichen Sicherung", () => {
  it("ohne Eintrag: keine Sicherung", () => {
    expect(backupState(null, now)).toEqual({ kind: "none" });
    expect(backupState("kaputt", now)).toEqual({ kind: "none" });
    expect(backupHint(undefined, now)).toBe("Noch keine nächtliche Sicherung");
  });

  it("bis 36 Stunden in Ordnung – kein Hinweis auf Heute", () => {
    expect(backupState(hoursAgo(7), now).kind).toBe("ok");
    expect(backupState(hoursAgo(36), now).kind).toBe("ok");
    expect(backupHint(hoursAgo(30), now)).toBeNull();
  });

  it("danach überfällig: erst mit Uhrzeit, ab zwei Tagen „vor n Tagen“", () => {
    const yesterday = new Date("2026-10-17T03:12:00+02:00").toISOString();
    const late = backupState(hoursAgo(40), now);
    expect(late.kind).toBe("stale");
    expect(backupHint(new Date("2026-10-16T21:00:00+02:00").toISOString(), now)).toBe(
      "Nächtliche Sicherung überfällig – zuletzt am Fr, 16.10. um 21:00",
    );
    expect(backupAgo({ kind: "ok", at: yesterday }, now)).toBe("gestern um 03:12");
    expect(backupHint(hoursAgo(80), now)).toBe(
      "Nächtliche Sicherung überfällig – zuletzt vor 3 Tagen",
    );
  });
});

describe("Zusammenfassung", () => {
  it("liest die Werte des Skripts, Fremdes wird null bzw. 0", () => {
    expect(
      parseBackupSummary({
        stand: "2026-10-18-0307",
        zeilen: 1200,
        dateien: 41,
        dateien_bytes: 11_000_000,
        db_bytes: 150_000,
        drive: true,
        dauer_s: 70,
      }),
    ).toEqual({
      stand: "2026-10-18-0307",
      zeilen: 1200,
      dateien: 41,
      dateien_bytes: 11_000_000,
      db_bytes: 150_000,
      drive: true,
    });
    expect(parseBackupSummary(null)).toBeNull();
    expect(parseBackupSummary([1])).toBeNull();
    expect(parseBackupSummary({ zeilen: 3 })).toBeNull();
    expect(parseBackupSummary({ stand: "x", zeilen: "3" })?.zeilen).toBe(0);
  });
});
