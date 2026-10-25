/**
 * Nächtliche Sicherung (E32) in der App: Das Skript auf dem Mac (scripts/backup-nightly.mts)
 * trägt jeden Erfolg in user_settings ein (Migration 27). Liegt der letzte Erfolg länger als
 * 36 Stunden zurück oder fehlt er, zeigt „Heute“ einen Hinweis – so fällt auch auf, wenn der Mac
 * aus war oder das Skript gar nicht lief.
 */
import { formatEdited } from "@/lib/dates";

export const BACKUP_STALE_HOURS = 36;

export interface BackupSummary {
  stand: string;
  zeilen: number;
  dateien: number;
  dateien_bytes: number;
  db_bytes: number;
  drive: boolean;
}

/** Zusammenfassung aus der jsonb-Spalte (fehlende oder fremde Werte → null). */
export function parseBackupSummary(value: unknown): BackupSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const num = (key: string) => (typeof v[key] === "number" ? (v[key] as number) : 0);
  if (typeof v.stand !== "string") return null;
  return {
    stand: v.stand,
    zeilen: num("zeilen"),
    dateien: num("dateien"),
    dateien_bytes: num("dateien_bytes"),
    db_bytes: num("db_bytes"),
    drive: v.drive === true,
  };
}

export type BackupState =
  | { kind: "none" }
  | { kind: "ok"; at: string }
  | { kind: "stale"; at: string; hours: number };

export function backupState(lastAt: string | null | undefined, now = new Date()): BackupState {
  const time = lastAt ? Date.parse(lastAt) : Number.NaN;
  if (!lastAt || Number.isNaN(time)) return { kind: "none" };
  const hours = (now.getTime() - time) / 3_600_000;
  return hours > BACKUP_STALE_HOURS
    ? { kind: "stale", at: lastAt, hours: Math.floor(hours) }
    : { kind: "ok", at: lastAt };
}

/** „gestern um 03:12“ bis 48 h, danach „vor 3 Tagen“. */
export function backupAgo(state: Exclude<BackupState, { kind: "none" }>, now = new Date()) {
  if (state.kind === "stale" && state.hours >= 48) {
    return `vor ${Math.floor(state.hours / 24)} Tagen`;
  }
  return formatEdited(state.at, now);
}

/** Hinweis auf „Heute“ – null, solange alles in Ordnung ist. */
export function backupHint(lastAt: string | null | undefined, now = new Date()): string | null {
  const state = backupState(lastAt, now);
  if (state.kind === "ok") return null;
  if (state.kind === "none") return "Noch keine nächtliche Sicherung";
  return `Nächtliche Sicherung überfällig – zuletzt ${backupAgo(state, now)}`;
}
