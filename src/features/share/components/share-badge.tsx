"use client";

import { Globe, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNoteShare, useNoteShares } from "../api";
import { openNoteShare } from "./share-dialog";

/**
 * Kleines Zeichen „Öffentlich“ neben dem Titel in Liste, Tabelle, Karte und Wissen (U-4): nur
 * Anzeige (steht in einem Link), damit der Nutzer nicht Privates in eine öffentliche Notiz schreibt,
 * ohne es zu sehen.
 */
export function NoteShareMark({ noteId, className }: { noteId: string; className?: string }) {
  const share = useNoteShare(noteId);
  if (!share) return null;
  return (
    <span
      role="img"
      aria-label="Öffentlich freigegeben"
      title="Öffentlich freigegeben"
      data-testid="share-mark"
      className={cn("inline-flex shrink-0 items-center text-faint", className)}
    >
      <Globe size={12} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/**
 * Plakette „Öffentlich“ im Kopf einer freigegebenen Notiz (#94): sichtbar, dass jeder mit dem Link
 * sie lesen kann; ein Klick (auch am Handy) öffnet das Fenster der Freigabe. Lassen sich die
 * Freigaben nicht laden, steht hier „Freigabe unbekannt“ statt nichts (U-4).
 */
export function NoteShareBadge({ noteId, className }: { noteId: string; className?: string }) {
  const shares = useNoteShares();
  const share = useNoteShare(noteId);
  if (shares.isError && !share) {
    return (
      <span
        title="Die Freigaben ließen sich nicht laden – ob diese Notiz öffentlich ist, ist gerade unbekannt."
        data-testid="share-unknown"
        className={cn(
          "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2 text-meta text-warning md:h-8",
          className,
        )}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/60 px-2.5 py-0.5">
          <TriangleAlert size={12} strokeWidth={1.75} aria-hidden />
          Freigabe unbekannt
        </span>
      </span>
    );
  }
  if (!share) return null;
  return (
    <button
      type="button"
      onClick={() => openNoteShare(noteId)}
      title="Öffentlich freigegeben – Freigabe ansehen oder beenden"
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2 text-meta text-muted transition-colors hover:bg-surface-2 hover:text-fg md:h-8",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-2.5 py-0.5">
        <Globe size={12} strokeWidth={1.75} aria-hidden />
        Öffentlich
      </span>
    </button>
  );
}
