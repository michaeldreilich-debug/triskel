import { describe, expect, it } from "vitest";
import {
  checkRestore,
  countDiffs,
  EMPTY_STATE,
  formatBytes,
  isDue,
  isStaleLock,
  LOCK_STALE_MS,
  manifestFromLsjson,
  manifestTotals,
  mapUserIds,
  nightStart,
  parseLock,
  parseStand,
  parseUserMap,
  redact,
  shouldNotifyFailure,
  shouldNotifyRecovery,
  standForDrive,
  standName,
  standsToDelete,
} from "../../scripts/lib/backup.mts";

/** Ortszeit-Datum wie auf dem Mac */
const at = (y: number, m: number, d: number, h = 3, min = 7) => new Date(y, m - 1, d, h, min);

/** ein Stand je Nacht von `from` (einschließlich) bis `to` (einschließlich) */
function nightly(from: Date, to: Date): string[] {
  const names: string[] = [];
  for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) {
    names.push(standName(day));
  }
  return names;
}

describe("Stand-Namen", () => {
  it("schreibt und liest JJJJ-MM-TT-HHMM in Ortszeit", () => {
    const date = at(2026, 3, 5, 2, 9);
    expect(standName(date)).toBe("2026-03-05-0209");
    expect(parseStand("2026-03-05-0209")).toEqual(date);
  });

  it("nimmt nur gültige Namen", () => {
    expect(parseStand("2026-02-31-0300")).toBeNull();
    expect(parseStand("2026-10-18-2560")).toBeNull();
    expect(parseStand("prod-2026-10-17-2104.dump")).toBeNull();
    expect(parseStand("2026-10-18")).toBeNull();
    expect(parseStand(".DS_Store")).toBeNull();
  });
});

describe("Fälligkeit (Nachtgrenze 02:00)", () => {
  it("die Grenze liegt heute 02:00 oder – vor zwei Uhr – gestern", () => {
    expect(nightStart(at(2026, 10, 18, 3, 0))).toEqual(at(2026, 10, 18, 2, 0));
    expect(nightStart(at(2026, 10, 18, 1, 59))).toEqual(at(2026, 10, 17, 2, 0));
    expect(nightStart(at(2026, 10, 18, 2, 0))).toEqual(at(2026, 10, 18, 2, 0));
  });

  it("ohne Erfolg ist immer etwas fällig", () => {
    expect(isDue(null, at(2026, 10, 18, 15, 0))).toBe(true);
  });

  it("einmal je Nacht: nach dem Erfolg um 02:07 erst wieder ab der nächsten Nacht", () => {
    const success = at(2026, 10, 18, 2, 7);
    expect(isDue(success, at(2026, 10, 18, 3, 7))).toBe(false);
    expect(isDue(success, at(2026, 10, 19, 1, 7))).toBe(false);
    expect(isDue(success, at(2026, 10, 19, 2, 7))).toBe(true);
  });

  it("hat der Mac geschlafen, holt der erste Aufruf am Morgen nach", () => {
    const success = at(2026, 10, 17, 2, 7);
    expect(isDue(success, at(2026, 10, 18, 7, 40))).toBe(true);
  });

  it("ein Lauf am Abend zählt nicht für die kommende Nacht", () => {
    expect(isDue(at(2026, 10, 17, 22, 0), at(2026, 10, 18, 2, 7))).toBe(true);
  });
});

describe("Aufbewahrung (30 Tage täglich, 12 Monatsstände, 7 bleiben immer)", () => {
  const now = at(2026, 10, 18, 3, 10);

  it("behält alles der letzten 30 Tage", () => {
    const names = nightly(at(2026, 9, 18), at(2026, 10, 18));
    expect(standsToDelete(names, now)).toEqual([]);
  });

  it("löscht ältere Tagesstände, behält aber den ersten Stand je Monat", () => {
    const names = nightly(at(2026, 8, 1), at(2026, 10, 18));
    const removed = standsToDelete(names, now);
    expect(removed).not.toContain(standName(at(2026, 8, 1)));
    expect(removed).not.toContain(standName(at(2026, 9, 1)));
    expect(removed).toContain(standName(at(2026, 8, 2)));
    expect(removed).toContain(standName(at(2026, 9, 17)));
    // die letzten 30 Tage bleiben (Grenze: jetzt minus 30 Tage = 18.09. 03:10)
    expect(removed).not.toContain(standName(at(2026, 9, 19)));
    expect(removed).toContain(standName(at(2026, 9, 18)));
    expect(removed.every((name) => (parseStand(name) as Date) < at(2026, 9, 18, 3, 10))).toBe(true);
  });

  it("Monatsstände gelten 12 Monate (einschließlich des laufenden)", () => {
    const names = [
      "2025-10-01-0307",
      "2025-11-01-0307",
      "2026-03-01-0307",
      ...nightly(at(2026, 10, 1), at(2026, 10, 18)),
    ];
    expect(standsToDelete(names, now)).toEqual(["2025-10-01-0307"]);
  });

  it("die neuesten 7 bleiben immer, auch wenn sie uralt sind (Mac lange aus)", () => {
    const names = nightly(at(2025, 1, 2), at(2025, 1, 12));
    const removed = standsToDelete(names, now);
    expect(removed).toHaveLength(4);
    expect(removed).toEqual(names.slice(0, 4));
  });

  it("löscht nie Unbekanntes und nie Stände aus der Zukunft", () => {
    const names = ["notizen.txt", "2027-01-01-0307", ...nightly(at(2026, 6, 2), at(2026, 6, 20))];
    const removed = standsToDelete(names, now);
    expect(removed).not.toContain("notizen.txt");
    expect(removed).not.toContain("2027-01-01-0307");
  });

  it("ist stabil: ein zweiter Durchgang löscht nichts mehr", () => {
    const names = nightly(at(2025, 6, 1), at(2026, 10, 18));
    const removed = new Set(standsToDelete(names, now));
    const left = names.filter((name) => !removed.has(name));
    expect(standsToDelete(left, now)).toEqual([]);
    // 30 Nächte (19.09.–18.10.) + Monatsstände Nov 2025 bis Sep 2026 (der 01.10. liegt im Fenster)
    expect(left.length).toBe(30 + 11);
  });
});

describe("Mitteilungen", () => {
  const now = at(2026, 10, 18, 4, 7);

  it("meldet den ersten Fehler sofort, danach höchstens alle 6 Stunden", () => {
    expect(shouldNotifyFailure(EMPTY_STATE, now)).toBe(true);
    const notified = { ...EMPTY_STATE, lastNotified: at(2026, 10, 18, 2, 7).toISOString() };
    expect(shouldNotifyFailure(notified, now)).toBe(false);
    expect(shouldNotifyFailure(notified, at(2026, 10, 18, 8, 7))).toBe(true);
  });

  it("meldet „wieder in Ordnung“ nur nach einem gemeldeten Fehler", () => {
    expect(shouldNotifyRecovery(EMPTY_STATE)).toBe(false);
    const failed = {
      ...EMPTY_STATE,
      lastError: { at: now.toISOString(), message: "x" },
      lastNotified: now.toISOString(),
    };
    expect(shouldNotifyRecovery(failed)).toBe(true);
    expect(shouldNotifyRecovery({ ...failed, lastNotified: null })).toBe(false);
  });
});

describe("Zugangsdaten bleiben aus Logs", () => {
  it("ersetzt DB-URL und Schlüssel", () => {
    const text =
      "fehler bei postgresql://postgres.ref:pw@host:5432/postgres mit Schlüssel AKIA123456 und geheim-xyz-789";
    const out = redact(text, ["AKIA123456", "geheim-xyz-789", undefined, ""]);
    expect(out).not.toContain("pw@host");
    expect(out).not.toContain("AKIA123456");
    expect(out).not.toContain("geheim-xyz-789");
    expect(out).toContain("<db-url>");
  });
});

describe("Datei-Liste", () => {
  it("liest rclone lsjson, ohne Ordner, sortiert", () => {
    const json = JSON.stringify([
      { Path: "u/n/b.png", Size: 20, Hashes: { md5: "bb" } },
      { Path: "u/n", Size: -1, IsDir: true },
      { Path: "u/n/a.jpg", Size: 10 },
    ]);
    const entries = manifestFromLsjson("note-images", json);
    expect(entries).toEqual([
      { bucket: "note-images", path: "u/n/a.jpg", size: 10 },
      { bucket: "note-images", path: "u/n/b.png", size: 20, md5: "bb" },
    ]);
    expect(manifestTotals(entries)).toEqual({ files: 2, bytes: 30 });
  });

  it("schreibt Größen deutsch", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(18.3 * 1024 * 1024)).toBe("18,3 MB");
  });
});

describe("Wiederherstellen", () => {
  const OLD = "11111111-2222-4333-8444-555555555555";
  const NEW = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const stand = {
    migration: "20261017000027",
    tabellen: { notes: 3, tasks: 2 },
    nutzer: [{ id: OLD }],
  };

  it("--nutzer ALT=NEU wird geprüft und ersetzt IDs in Daten und Pfaden", () => {
    const map = parseUserMap([`${OLD}=${NEW.toUpperCase()}`]);
    expect(map.get(OLD)).toBe(NEW);
    expect(mapUserIds(`${OLD}\tnote\t{"src":"${OLD}/n1/bild.png"}`, map)).toBe(
      `${NEW}\tnote\t{"src":"${NEW}/n1/bild.png"}`,
    );
    expect(mapUserIds("ohne", new Map())).toBe("ohne");
    expect(() => parseUserMap(["kaputt"])).toThrow(/ALT=NEU/);
    expect(() => parseUserMap([`${OLD}=x`])).toThrow(/ALT=NEU/);
  });

  it("passt: gleiche Migration, Konto und Tabellen vorhanden", () => {
    const target = { migration: stand.migration, tables: ["notes", "tasks", "x"], users: [OLD] };
    expect(checkRestore(stand, target, new Map(), false)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });

  it("älteres Ziel: erst Migrationen; neueres Ziel nur mit --trotzdem", () => {
    const base = { tables: ["notes", "tasks"], users: [OLD] };
    const older = checkRestore(stand, { ...base, migration: "20261017000026" }, new Map(), true);
    expect(older.ok).toBe(false);
    expect(older.problems[0]).toMatch(/erst die Migrationen/);
    const newer = { ...base, migration: "20261101000028" };
    expect(checkRestore(stand, newer, new Map(), false).problems[0]).toMatch(/--trotzdem/);
    const forced = checkRestore(stand, newer, new Map(), true);
    expect(forced.ok).toBe(true);
    expect(forced.warnings).toHaveLength(1);
  });

  it("fehlendes Konto oder fehlende Tabelle: nichts ändern", () => {
    const target = { migration: stand.migration, tables: ["notes"], users: [NEW] };
    const check = checkRestore(stand, target, new Map(), false);
    expect(check.ok).toBe(false);
    expect(check.problems.join(" ")).toMatch(/Konto .* fehlt/);
    expect(check.problems.join(" ")).toMatch(/Tabelle tasks fehlt/);
    // mit Zuordnung auf das neue Konto passt es (bis auf die Tabelle)
    const mapped = checkRestore(stand, target, parseUserMap([`${OLD}=${NEW}`]), false);
    expect(mapped.problems).toEqual(["Tabelle tasks fehlt im Ziel"]);
  });

  it("vergleicht Zeilen je Tabelle", () => {
    expect(countDiffs({ notes: 3, tasks: 2 }, { notes: 3, tasks: 2 })).toEqual([]);
    expect(countDiffs({ notes: 3, tasks: 2 }, { notes: 2 })).toEqual([
      "notes: 2 statt 3",
      "tasks: fehlt statt 2",
    ]);
  });
});

describe("Nur Drive gescheitert (T-8)", () => {
  const pending = (stand: string) => ({
    ...EMPTY_STATE,
    pendingDrive: { stand, at: parseStand(stand)?.toISOString() ?? "", summary: { stand } },
  });

  it("holt Drive für den Stand derselben Nacht nach, statt neu zu sichern", () => {
    expect(standForDrive(pending("2026-10-18-0207"), at(2026, 10, 18, 5, 7))?.stand).toBe(
      "2026-10-18-0207",
    );
    // kurz vor der nächsten Nachtgrenze gilt er noch
    expect(standForDrive(pending("2026-10-18-0207"), at(2026, 10, 19, 1, 59))).not.toBeNull();
  });

  it("nimmt einen Stand aus einer früheren Nacht, aus der Zukunft oder ohne Namen nicht", () => {
    expect(standForDrive(pending("2026-10-18-0207"), at(2026, 10, 19, 2, 7))).toBeNull();
    expect(standForDrive(pending("2026-10-18-0207"), at(2026, 10, 18, 1, 7))).toBeNull();
    expect(standForDrive(pending("kaputt"), at(2026, 10, 18, 5, 7))).toBeNull();
    expect(standForDrive(EMPTY_STATE, at(2026, 10, 18, 5, 7))).toBeNull();
  });
});

describe("Sperre (T-2)", () => {
  const now = at(2026, 10, 18, 3, 7);
  const alive = () => true;
  const gone = () => false;

  it("liest das neue Format und das alte (nur PID, Start = Änderungszeit)", () => {
    expect(parseLock('{"pid":4711,"started":"2026-10-18T01:07:00.000Z"}', now)).toEqual({
      pid: 4711,
      started: "2026-10-18T01:07:00.000Z",
    });
    expect(parseLock("4711\n", now)).toEqual({ pid: 4711, started: now.toISOString() });
    expect(parseLock("", now)).toBeNull();
    expect(parseLock("{kaputt", now)).toBeNull();
  });

  it("verwaist: Prozess weg oder PID an etwas anderes vergeben", () => {
    const lock = { pid: 4711, started: now.toISOString() };
    expect(isStaleLock(lock, now, gone)).toBe(true);
    expect(isStaleLock(lock, now, alive)).toBe(false);
    expect(isStaleLock(null, now, alive)).toBe(true);
  });

  it("verwaist nach 3 Stunden, auch wenn die PID noch belegt ist", () => {
    const started = new Date(now.getTime() - LOCK_STALE_MS).toISOString();
    expect(isStaleLock({ pid: 4711, started }, now, alive)).toBe(true);
    const recent = new Date(now.getTime() - LOCK_STALE_MS + 60_000).toISOString();
    expect(isStaleLock({ pid: 4711, started: recent }, now, alive)).toBe(false);
  });
});
