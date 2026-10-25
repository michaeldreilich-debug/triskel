/**
 * Sperre der nächtlichen Sicherung (T-2) gegen eine echte Datei: atomar angelegt, verwaiste
 * Sperren (Absturz, PID neu vergeben, alt) werden übernommen, laufende nicht.
 */
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, isBackupRun, releaseLock } from "../../scripts/lib/backup-io.mts";

let dir = "";
let ctx = { dir: { lock: "" } };
const now = new Date("2026-10-18T01:07:00.000Z");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "schaltzentrale-lock-"));
  ctx = { dir: { lock: join(dir, ".lauf.lock") } };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const held = (pid: number, started = now.toISOString()) =>
  writeFileSync(ctx.dir.lock, JSON.stringify({ pid, started }));

describe("Sperre der Sicherung", () => {
  it("legt die Sperre mit PID und Start an und gibt sie wieder frei", () => {
    expect(acquireLock(ctx, now)).toEqual({ ok: true, takenOver: null });
    expect(JSON.parse(readFileSync(ctx.dir.lock, "utf8"))).toEqual({
      pid: process.pid,
      started: now.toISOString(),
    });
    // ein zweiter Lauf (andere PID, läuft) bekommt sie nicht
    releaseLock(ctx);
    held(4711);
    expect(acquireLock(ctx, now, () => true)).toMatchObject({ ok: false, held: { pid: 4711 } });
    // fremde Sperre gibt releaseLock nicht frei
    releaseLock(ctx);
    expect(readFileSync(ctx.dir.lock, "utf8")).toContain("4711");
  });

  it("übernimmt eine Sperre, deren PID macOS an etwas anderes vergeben hat", () => {
    held(process.ppid); // lebt, ist aber kein backup-nightly
    expect(isBackupRun(process.ppid)).toBe(false);
    const result = acquireLock(ctx, now);
    expect(result).toEqual({
      ok: true,
      takenOver: { pid: process.ppid, started: now.toISOString() },
    });
    expect(readFileSync(ctx.dir.lock, "utf8")).toContain(String(process.pid));
  });

  it("übernimmt eine Sperre im alten Format (nur PID) nach 3 Stunden", () => {
    writeFileSync(ctx.dir.lock, "4711");
    const old = new Date(now.getTime() - 3 * 60 * 60 * 1000 - 1000);
    utimesSync(ctx.dir.lock, old, old);
    expect(acquireLock(ctx, now, () => true)).toMatchObject({ ok: true, takenOver: { pid: 4711 } });
  });

  it("hält eine junge Sperre eines laufenden Laufs", () => {
    writeFileSync(ctx.dir.lock, "4711");
    expect(acquireLock(ctx, new Date(), () => true)).toMatchObject({ ok: false });
  });
});
