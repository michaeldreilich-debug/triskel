import { strToU8, zipSync } from "fflate";
import type { VaultFile } from "./vault";

/** Ordnername im ZIP und Dateiname des Downloads: „Schaltzentrale-Export-2026-10-17“. */
export const exportName = (date: string) => `Schaltzentrale-Export-${date}`;

/** Vault als ZIP (alle Dateien unter einem Ordner, Namen in UTF-8). */
export function zipVault(files: VaultFile[], root: string, mtime = new Date()): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[`${root}/${file.path}`] =
      typeof file.content === "string" ? strToU8(file.content) : file.content;
  }
  return zipSync(entries, { level: 6, mtime });
}

/** Wie lange ist der letzte Export her? (für Einstellungen und den Rückblick) */
export function exportAge(last: string | null | undefined, now = new Date()) {
  if (!last) return { days: null, label: "Noch kein Export" };
  const days = Math.floor((now.getTime() - Date.parse(last)) / 86_400_000);
  const label = days <= 0 ? "heute" : days === 1 ? "gestern" : `vor ${days} Tagen`;
  return { days, label };
}
