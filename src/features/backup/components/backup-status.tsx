"use client";

import { AlertTriangle, CircleCheck, DatabaseBackup } from "lucide-react";
import Link from "next/link";
import { FoldSection } from "@/components/ui/fold-section";
import { FieldHint } from "@/components/ui/input";
import { formatBytes } from "@/features/notes/attachments";
import { useUserSettings } from "@/features/settings/api";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { backupAgo, backupHint, backupState, parseBackupSummary } from "../status";

/**
 * Hinweis unter dem Titel von „Heute“ (E32): nur, wenn die letzte nächtliche Sicherung älter als
 * 36 Stunden ist oder fehlt. Leise Zeile mit Warnsymbol (wie „festgefahren“), ein Klick führt zu
 * den Einstellungen.
 */
export function BackupHint({ now }: { now: number }) {
  const settings = useUserSettings();
  if (!settings.data) return null;
  const text = backupHint(settings.data.last_backup_at, new Date(now));
  // geprüft und in Ordnung: nur eine unsichtbare Marke (damit Tests „kein Hinweis“ erst nach
  // dem Laden der Einstellungen feststellen, T-14)
  if (!text) return <span hidden data-testid="backup-ok" />;
  return (
    <p
      role="status"
      data-testid="backup-hint"
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-sm text-muted"
    >
      <AlertTriangle size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-warning" />
      <span>{text}</span>
      <Link href={appPath.settings("sicherung")} className="text-link hover:underline">
        Details
      </Link>
    </p>
  );
}

/** Einstellungen › Sicherung: Stand der letzten Nacht und wie es funktioniert. */
export function BackupSection() {
  const settings = useUserSettings();
  const last = settings.data?.last_backup_at ?? null;
  const summary = parseBackupSummary(settings.data?.last_backup_summary);
  const state = backupState(last);
  const ok = state.kind === "ok";
  const Icon = ok ? CircleCheck : AlertTriangle;

  return (
    <FoldSection
      id="sicherung"
      icon={DatabaseBackup}
      title="Sicherung"
      sub="Jede Nacht automatisch nach Google Drive"
      summary={
        // erst mit geladenen Einstellungen – sonst stünde beim Laden „Noch keine …“ im Kopf (M3-2)
        !settings.data
          ? undefined
          : state.kind === "none"
            ? "Noch keine nächtliche Sicherung"
            : `${ok ? "Letzte Sicherung" : "Überfällig – letzte Sicherung"} ${backupAgo(state)}`
      }
    >
      <div className="flex flex-col items-start gap-1.5">
        {settings.data ? (
          <p
            data-testid="last-backup"
            className={cn("flex items-center gap-2 text-ui", ok ? "text-text" : "text-warning")}
          >
            <Icon
              size={16}
              strokeWidth={1.5}
              aria-hidden
              className={cn("shrink-0", ok ? "text-success" : "text-warning")}
            />
            {state.kind === "none"
              ? "Noch keine nächtliche Sicherung."
              : `${ok ? "Letzte Sicherung" : "Überfällig – letzte Sicherung"} ${backupAgo(state)}`}
          </p>
        ) : null}
        {summary && state.kind !== "none" ? (
          <p className="text-ui-sm text-muted tabular-nums" data-testid="last-backup-summary">
            {summary.zeilen.toLocaleString("de-DE")} Zeilen ·{" "}
            {summary.dateien.toLocaleString("de-DE")} Dateien
            {summary.dateien_bytes > 0 ? ` (${formatBytes(summary.dateien_bytes)})` : ""} ·{" "}
            {summary.drive ? "auf Google Drive" : "nur auf dem Mac"}
          </p>
        ) : null}
        <FieldHint>
          Der Mac sichert jede Nacht ab 2 Uhr die Datenbank und alle Bilder und Dateien nach Google
          Drive (Ordner „Schaltzentrale-Backup“); hat er geschlafen, holt er es nach. Fehlt die
          Sicherung länger als 36 Stunden, steht auf Heute ein Hinweis. Wiederherstellen: README ›
          Sichern und Export.
        </FieldHint>
      </div>
    </FoldSection>
  );
}
