"use client";

import { AlertTriangle, Check, CloudOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SaveQueueSnapshot } from "@/lib/save-queue/save-queue";

const LABELS: Record<SaveQueueSnapshot["status"], string> = {
  idle: "Gespeichert",
  pending: "Ungespeicherte Änderungen",
  saving: "Speichert …",
  retrying: "Speichern wird wiederholt",
  offline: "Offline – wird nachgeholt",
  error: "Nicht gespeichert",
};

/** Speicherstatus-Anzeige (B3): ruhig, ohne Spinner; Fehler mit „Erneut versuchen“ und „Verwerfen“. */
export function SaveStatus({
  snapshot,
  onRetry,
  onDiscard,
  compact,
  className,
  ...props
}: {
  snapshot: SaveQueueSnapshot;
  onRetry?: () => void;
  /** Fehlgeschlagenes verwerfen (D-4) – der Aufrufer bietet „Rückgängig“ an */
  onDiscard?: () => void;
  /** nur Symbol sichtbar (Text für Screenreader), z. B. in der mobilen Kopfzeile */
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
}) {
  const { status } = snapshot;
  const icon =
    status === "idle" ? (
      <Check size={14} strokeWidth={1.5} aria-hidden />
    ) : status === "offline" ? (
      <CloudOff size={14} strokeWidth={1.5} aria-hidden />
    ) : status === "error" || status === "retrying" ? (
      <AlertTriangle size={14} strokeWidth={1.5} aria-hidden />
    ) : (
      <span aria-hidden className="size-1.5 rounded-full bg-warning" />
    );

  return (
    <div
      role="status"
      aria-live="polite"
      data-status={status}
      data-testid={props["data-testid"]}
      title={compact ? LABELS[status] : (snapshot.lastError ?? undefined)}
      className={cn(
        "inline-flex items-center gap-1.5 text-meta",
        status === "error" ? "text-danger" : status === "idle" ? "text-faint" : "text-warning",
        className,
      )}
    >
      {icon}
      <span className={compact ? "sr-only" : undefined}>{LABELS[status]}</span>
      {snapshot.storageError ? <span className="text-danger">· lokale Sicherung voll</span> : null}
      {status === "error" && onRetry && !compact ? (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 inline-flex items-center gap-1 underline underline-offset-2"
        >
          <RefreshCw size={12} strokeWidth={1.5} aria-hidden />
          Erneut versuchen
        </button>
      ) : null}
      {status === "error" && onDiscard && !compact ? (
        <button
          type="button"
          onClick={onDiscard}
          aria-label={`${snapshot.failed} Änderung${snapshot.failed === 1 ? "" : "en"} verwerfen`}
          className="ml-1 underline underline-offset-2"
        >
          Verwerfen
        </button>
      ) : null}
    </div>
  );
}
