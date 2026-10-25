"use client";

/**
 * Einstellungen › Freigaben (#94, E42): alle Notizen, die gerade jeder mit dem Link lesen kann –
 * „Notiz öffnen“, „Öffentliche Seite öffnen“, „Beenden“ (direkt gespeichert, mit Rückgängig). Eine Notiz im Papierkorb
 * steht mit „ruht“ da: ihre Seite ist bis zum Zurückholen nicht erreichbar.
 */
import { ExternalLink, Globe } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { FoldSection } from "@/components/ui/fold-section";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotes } from "@/features/notes/api";
import { noteTitle } from "@/features/notes/types";
import { appPath, publicShareUrl } from "@/lib/app-links";
import { berlinDate, formatDateShort } from "@/lib/dates";
import { type NoteShareRow, useNoteShares, useShareActions } from "../api";

export function SharesSection() {
  const shares = useNoteShares();
  const notes = useNotes();
  const list = shares.data ?? [];
  const loading = shares.isPending || notes.isPending;
  return (
    <FoldSection
      id="freigaben"
      icon={Globe}
      title="Freigaben"
      sub="Notizen, die jeder mit dem Link lesen kann (ohne Eigenschaften)"
      summary={
        loading
          ? undefined
          : list.length === 0
            ? "Keine Notiz ist öffentlich"
            : `${list.length} ${list.length === 1 ? "Notiz" : "Notizen"} öffentlich`
      }
    >
      {loading ? (
        <Skeleton className="h-16 w-full rounded-card" />
      ) : list.length === 0 ? (
        <p className="text-ui-sm text-faint">
          Keine Notiz ist öffentlich freigegeben. Freigeben geht im Menü einer Notiz (⋯ oder
          Rechtsklick › „Öffentlich freigeben …“).
        </p>
      ) : (
        <ul aria-label="Aktive Freigaben" className="flex flex-col divide-y divide-border">
          {list.map((share) => (
            <ShareRow
              key={share.id}
              share={share}
              title={(() => {
                const note = notes.data?.find((n) => n.id === share.note_id);
                return note ? noteTitle(note) : null;
              })()}
            />
          ))}
        </ul>
      )}
    </FoldSection>
  );
}

function ShareRow({ share, title }: { share: NoteShareRow; title: string | null }) {
  const actions = useShareActions();
  const [ending, setEnding] = useState(false);
  const label = title ?? "Notiz im Papierkorb";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-ui font-medium">{label}</span>
        <span className="text-meta text-faint">
          seit {formatDateShort(berlinDate(share.created_at))}
          {title ? "" : " · ruht, bis die Notiz zurückgeholt ist"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {title ? (
          <Link
            href={appPath.note(share.note_id)}
            className={buttonClasses("ghost", "sm")}
            aria-label={`Notiz öffnen: „${label}“`}
          >
            Notiz öffnen
          </Link>
        ) : null}
        <a
          href={publicShareUrl(share.token)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses("ghost", "sm")}
          aria-label={`Öffentliche Seite öffnen: „${label}“`}
        >
          <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
          Öffentliche Seite öffnen
        </a>
        <Button
          variant="danger"
          size="sm"
          disabled={ending}
          onClick={async () => {
            setEnding(true);
            await actions.end(share, label);
            setEnding(false);
          }}
          aria-label={`Beenden: Freigabe von „${label}“`}
        >
          {ending ? "Wird beendet …" : "Beenden"}
        </Button>
      </div>
    </li>
  );
}
