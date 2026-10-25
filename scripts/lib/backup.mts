// ---------------------------------------------------------------
// Regeln der nächtlichen Sicherung (E32) – reine Funktionen, getestet in
// tests/unit/backup-rules.test.ts. Das Skript selbst steht in scripts/backup-nightly.mts.
//   - Stand = ein Ordner je Lauf, Name „JJJJ-MM-TT-HHMM“ (Ortszeit des Macs).
//   - Fällig ist ein Lauf, wenn der letzte Erfolg vor der letzten Nachtgrenze (02:00) liegt;
//     hat der Mac geschlafen, holt der nächste stündliche Aufruf nach.
//   - Aufbewahrung: alle Stände der letzten 30 Tage, davor der erste Stand je Monat für
//     12 Monate. Die neuesten 7 Stände bleiben immer, Unbekanntes wird nie gelöscht.
// ---------------------------------------------------------------

/** Ab dieser Stunde (Ortszeit) gilt eine neue Nacht. */
export const NIGHT_HOUR = 2;

export interface Retention {
  /** alle Stände dieser Tage behalten */
  days: number;
  /** davor je Monat den ersten Stand, für so viele Monate */
  months: number;
  /** so viele neueste Stände bleiben in jedem Fall */
  keepMin: number;
}

export const RETENTION: Retention = { days: 30, months: 12, keepMin: 7 };

const pad = (n: number) => String(n).padStart(2, "0");

/** „2026-10-18-0307“ aus einem Zeitpunkt (Ortszeit). */
export function standName(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** Zeitpunkt eines Stand-Namens oder null, wenn der Name keiner ist. */
export function parseStand(name: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/.exec(name);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  // 2026-02-31 o. Ä. rollt in den nächsten Monat – dann ist es kein gültiger Name
  return standName(date) === name ? date : null;
}

/** Die letzte Nachtgrenze (02:00 Ortszeit) zu oder vor `now`. */
export function nightStart(now: Date, hour = NIGHT_HOUR): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (start > now) start.setDate(start.getDate() - 1);
  return start;
}

/** Ist eine Sicherung fällig? (kein Erfolg seit der letzten Nachtgrenze) */
export function isDue(lastSuccess: Date | null, now: Date): boolean {
  return !lastSuccess || lastSuccess < nightStart(now);
}

/**
 * Welche Stände dürfen weg? Gibt nur gültige Stand-Namen zurück, nie die neuesten `keepMin`
 * und nie einen Stand aus der Zukunft (falsche Uhr).
 */
export function standsToDelete(names: string[], now: Date, rules: Retention = RETENTION): string[] {
  const stands = names
    .map((name) => ({ name, at: parseStand(name) }))
    .filter((s): s is { name: string; at: Date } => s.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const keep = new Set(stands.slice(0, rules.keepMin).map((s) => s.name));
  const dayLimit = new Date(now);
  dayLimit.setDate(dayLimit.getDate() - rules.days);
  // erster Monat, der noch einen Monatsstand behält (inkl. des aktuellen Monats)
  const monthLimit = new Date(now.getFullYear(), now.getMonth() - (rules.months - 1), 1);

  const firstOfMonth = new Map<string, string>();
  for (const s of [...stands].reverse()) {
    const key = `${s.at.getFullYear()}-${s.at.getMonth()}`;
    if (!firstOfMonth.has(key)) firstOfMonth.set(key, s.name);
  }

  const remove: string[] = [];
  for (const s of stands) {
    if (keep.has(s.name) || s.at > now || s.at >= dayLimit) continue;
    const key = `${s.at.getFullYear()}-${s.at.getMonth()}`;
    if (s.at >= monthLimit && firstOfMonth.get(key) === s.name) continue;
    remove.push(s.name);
  }
  return remove.sort();
}

// ---------- Mitteilungen ----------

/** Ein Stand, der auf dem Mac fertig ist, aber Drive noch nicht erreicht hat (T-8). */
export interface PendingDrive {
  stand: string;
  /** Zeitpunkt des Stands (ISO) – gilt nach dem Nachholen als Zeitpunkt der Sicherung */
  at: string;
  /** Zusammenfassung des Stands für die App */
  summary: Record<string, unknown>;
}

export interface RunState {
  /** letzter erfolgreicher Lauf (ISO) */
  lastSuccess: string | null;
  /** letzter Fehler (ISO) samt kurzer Meldung, null nach einem Erfolg */
  lastError: { at: string; message: string } | null;
  /** letzte Mac-Mitteilung über einen Fehler (ISO) */
  lastNotified: string | null;
  /** lokal fertiger Stand, dem nur noch Drive fehlt */
  pendingDrive: PendingDrive | null;
}

export const EMPTY_STATE: RunState = {
  lastSuccess: null,
  lastError: null,
  lastNotified: null,
  pendingDrive: null,
};

/**
 * Scheiterte nur Drive, holt der nächste Lauf derselben Nacht Drive für diesen Stand nach,
 * statt einen neuen vollen Stand anzulegen (sonst 24 Stände am Tag, T-8). Aus einer früheren
 * Nacht gilt er nicht mehr – dann gibt es einen neuen Stand, der alte geht mit nach Drive.
 */
export function standForDrive(state: RunState, now: Date): PendingDrive | null {
  const pending = state.pendingDrive;
  const at = pending ? parseStand(pending.stand) : null;
  if (!pending || !at || at > now) return null;
  return at >= nightStart(now) ? pending : null;
}

// ---------- Sperre ----------

/** Inhalt von .lauf.lock: PID und Start des Laufs. */
export interface LockInfo {
  pid: number;
  /** Start (ISO); bei Sperren des alten Formats (nur PID) die Änderungszeit der Datei */
  started: string;
}

/** Länger hält kein Lauf die Sperre – danach gilt sie als verwaist (Absturz, PID neu vergeben). */
export const LOCK_STALE_MS = 3 * 60 * 60 * 1000;
/** Ein Überspringen wegen einer Sperre, die älter ist, gilt als Fehler (Mitteilung). */
export const LOCK_WARN_MS = 60 * 60 * 1000;

/** Sperrdatei lesen – JSON `{ pid, started }` oder (alt) nur die PID. */
export function parseLock(text: string, modified: Date): LockInfo | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return { pid: Number(trimmed), started: modified.toISOString() };
  try {
    const value = JSON.parse(trimmed) as Partial<LockInfo>;
    const pid = Number(value.pid);
    const started = typeof value.started === "string" ? value.started : modified.toISOString();
    return pid > 0 && !Number.isNaN(Date.parse(started)) ? { pid, started } : null;
  } catch {
    return null;
  }
}

/**
 * Gilt eine Sperre als verwaist? Ja, wenn sie unlesbar ist, ihr Prozess kein Sicherungs-Lauf mehr
 * ist (beendet oder PID neu vergeben) oder sie älter als `LOCK_STALE_MS` ist.
 */
export function isStaleLock(
  lock: LockInfo | null,
  now: Date,
  isBackupRun: (pid: number) => boolean,
): boolean {
  if (!lock) return true;
  if (now.getTime() - Date.parse(lock.started) >= LOCK_STALE_MS) return true;
  return !isBackupRun(lock.pid);
}

/** Höchstens alle 6 Stunden eine Fehler-Mitteilung (der Lauf wiederholt sich stündlich). */
export const NOTIFY_EVERY_MS = 6 * 60 * 60 * 1000;

export function shouldNotifyFailure(state: RunState, now: Date): boolean {
  if (!state.lastNotified) return true;
  return now.getTime() - new Date(state.lastNotified).getTime() >= NOTIFY_EVERY_MS;
}

/** Nach einem gemeldeten Fehler sagt der nächste Erfolg Bescheid, dass es wieder geht. */
export function shouldNotifyRecovery(state: RunState): boolean {
  return state.lastNotified !== null && state.lastError !== null;
}

// ---------- Schutz der Zugangsdaten ----------

/** Ersetzt Geheimnisse (DB-URL, S3-Schlüssel) in Fehlertexten und Logs. */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text.replace(/postgres(ql)?:\/\/\S+/g, "<db-url>");
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("<geheim>");
  }
  return out;
}

// ---------- Datei-Liste eines Stands ----------

export interface ManifestEntry {
  bucket: string;
  path: string;
  size: number;
  md5?: string;
}

/** `rclone lsjson -R --files-only --hash` eines Buckets → Einträge der Datei-Liste. */
export function manifestFromLsjson(bucket: string, json: string): ManifestEntry[] {
  const rows = JSON.parse(json) as Array<{
    Path: string;
    Size: number;
    IsDir?: boolean;
    Hashes?: { md5?: string; MD5?: string };
  }>;
  return rows
    .filter((row) => !row.IsDir)
    .map((row) => {
      const md5 = row.Hashes?.md5 ?? row.Hashes?.MD5;
      return { bucket, path: row.Path, size: row.Size, ...(md5 ? { md5 } : {}) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function manifestTotals(entries: ManifestEntry[]): { files: number; bytes: number } {
  return { files: entries.length, bytes: entries.reduce((sum, e) => sum + e.size, 0) };
}

/** „412 Dateien · 18,3 MB“ */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

// ---------- Wiederherstellen ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * „--nutzer ALT=NEU“ (mehrfach) → Zuordnung alter zu neuer Nutzer-ID. Nur für ein neues Projekt,
 * in dem das Konto eine neue ID bekommen hat; ohne Angabe bleiben die IDs gleich.
 */
export function parseUserMap(values: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const value of values) {
    const [from, to, ...rest] = value.split("=");
    if (rest.length > 0 || !UUID.test(from ?? "") || !UUID.test(to ?? "")) {
      throw new Error(`--nutzer erwartet ALT=NEU (zwei UUIDs), nicht „${value}“`);
    }
    map.set(from.toLowerCase(), to.toLowerCase());
  }
  return map;
}

/** Nutzer-IDs ersetzen – in Daten (Spalten, Pfade in Notiz-Inhalten) und Datei-Pfaden. */
export function mapUserIds(text: string, map: Map<string, string>): string {
  let out = text;
  for (const [from, to] of map) out = out.split(from).join(to);
  return out;
}

export interface RestoreCheck {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/**
 * Passt der Stand zum Ziel? Gleiche Migration (sonst nur mit `trotzdem`), jedes Konto des Stands
 * (nach Zuordnung) gibt es im Ziel, keine Tabelle des Stands fehlt im Ziel.
 */
export function checkRestore(
  stand: { migration: string | null; tabellen: Record<string, number>; nutzer: { id: string }[] },
  target: { migration: string | null; tables: string[]; users: string[] },
  map: Map<string, string>,
  trotzdem: boolean,
): RestoreCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (stand.migration !== target.migration) {
    const older = (target.migration ?? "") < (stand.migration ?? "");
    const text = `Migration im Ziel ${target.migration ?? "–"}, im Stand ${stand.migration ?? "–"}`;
    if (older) problems.push(`${text}: erst die Migrationen im Ziel einspielen`);
    else if (trotzdem) warnings.push(`${text}: neuere Spalten bekommen ihre Standardwerte`);
    else problems.push(`${text}: mit --trotzdem in das neuere Schema einspielen`);
  }
  for (const user of stand.nutzer) {
    const id = map.get(user.id.toLowerCase()) ?? user.id.toLowerCase();
    if (!target.users.includes(id)) {
      problems.push(
        `Konto ${id} fehlt im Ziel – anlegen und mit --nutzer ${user.id}=<neue ID> zuordnen`,
      );
    }
  }
  for (const table of Object.keys(stand.tabellen)) {
    if (!target.tables.includes(table)) problems.push(`Tabelle ${table} fehlt im Ziel`);
  }
  return { ok: problems.length === 0, problems, warnings };
}

/** Zeilen je Tabelle vergleichen → Abweichungen „notes: 12 statt 13“. */
export function countDiffs(expected: Record<string, number>, actual: Record<string, number>) {
  return Object.entries(expected)
    .filter(([table, n]) => actual[table] !== n)
    .map(([table, n]) => `${table}: ${actual[table] ?? "fehlt"} statt ${n}`);
}
