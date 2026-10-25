"use client";

/**
 * „Öffentlich freigeben …“ (#94, E42): kleines Fenster für eine Notiz – Erklärung, „Freigabe
 * erstellen“, danach der Link (nur lesbar), „Öffentlichen Link kopieren“ und „Freigabe beenden“
 * (direkt gespeichert, Meldung mit Rückgängig erst nach der Bestätigung). Am Desktop in der Mitte, am Handy ein Sheet von unten. Geöffnet wird es aus
 * Menüs und der Plakette über `openNoteShare` – das Fenster selbst hängt einmal in der Shell
 * (`NoteShareDialogHost`), damit es das Schließen des Menüs überlebt.
 */
import { Globe, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { copyAppLink } from "@/components/ui/copy-link";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotes } from "@/features/notes/api";
import { noteTitle } from "@/features/notes/types";
import { appPath, publicShareUrl } from "@/lib/app-links";
import { useSaveQueue, useSaveStatus } from "@/lib/save-queue/react";
import { useNoteShares, useShareActions } from "../api";

let openId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Fenster für diese Notiz öffnen. Erst nach dem Schließen des Menüs, aus dem es kommt (sonst
 * stritten Menü und Fenster um Fokus und Zeiger-Sperre).
 */
export function openNoteShare(noteId: string) {
  setTimeout(() => {
    openId = noteId;
    emit();
  }, 0);
}

function closeNoteShare() {
  openId = null;
  emit();
}

/** Einmal in der Shell: zeigt das Fenster, sobald `openNoteShare` aufgerufen wurde. */
export function NoteShareDialogHost() {
  const noteId = useSyncExternalStore(
    subscribe,
    () => openId,
    () => null,
  );
  return (
    <Dialog.Root open={noteId !== null} onOpenChange={(open) => !open && closeNoteShare()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in" />
        <Dialog.Content
          data-testid="note-share"
          className="fixed z-50 flex max-h-[90dvh] flex-col overflow-y-auto border-border bg-surface text-fg shadow-float outline-none max-md:inset-x-0 max-md:bottom-0 max-md:rounded-t-sheet max-md:border-t max-md:pb-[env(safe-area-inset-bottom)] md:inset-x-4 md:top-[12dvh] md:mx-auto md:max-w-md md:rounded-card md:border data-[state=open]:animate-pop-in"
        >
          {noteId ? <ShareBody noteId={noteId} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShareBody({ noteId }: { noteId: string }) {
  const notes = useNotes();
  const shares = useNoteShares();
  const actions = useShareActions();
  const linkId = useId();
  // Beenden wartet auf die Datenbank (nicht optimistisch)
  const [ending, setEnding] = useState(false);
  const note = notes.data?.find((n) => n.id === noteId);
  const title = note ? noteTitle(note) : "Notiz";
  const share = shares.data?.find((s) => s.note_id === noteId) ?? null;
  const url = share ? publicShareUrl(share.token) : "";
  // Kopieren erst, wenn die Freigabe bestätigt gespeichert ist (U-8); der Speicherstatus hält
  // die Anzeige aktuell, sobald die Warteschlange gesendet hat
  const queue = useSaveQueue();
  const status = useSaveStatus(queue);
  const saving = share ? actions.isUnsaved(share.id) : false;
  const stuck = saving && status.failed > 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <Dialog.Title className="heading flex min-w-0 items-center gap-2 text-heading">
          <Globe size={18} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
          <span className="truncate">Öffentlich freigeben</span>
        </Dialog.Title>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Schließen">
            <X size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        </Dialog.Close>
      </div>
      <Dialog.Description className="text-ui text-muted">
        Jeder mit dem Link sieht Titel und Inhalt von „{title}“ – ohne Eigenschaften (Typ, Bereich,
        Thema, Projekt, Tags, Daten). Verknüpfte Notizen bleiben privat; Bilder und Dateien der
        Notiz lassen sich über den Link öffnen.
      </Dialog.Description>

      {shares.isPending ? (
        <Skeleton className="h-11 w-full md:h-9" />
      ) : shares.isError && !share ? (
        // U-4: ohne geladene Freigaben weder „erstellen“ (scheiterte an note_shares_one_active) noch raten
        <p className="text-ui-sm text-warning" data-testid="share-load-error">
          Die Freigaben ließen sich nicht laden – ob diese Notiz schon öffentlich ist, ist gerade
          unbekannt. Bitte Verbindung prüfen und noch einmal öffnen.
        </p>
      ) : share ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={linkId} className="text-ui-sm text-faint">
              Öffentlicher Link
            </label>
            <Input
              id={linkId}
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-ui-sm md:text-ui-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={saving}
              data-testid="share-copy"
              onClick={() =>
                void copyAppLink(appPath.share(share.token), "Öffentlicher Link kopiert")
              }
            >
              {saving ? "Wird gespeichert …" : "Öffentlichen Link kopieren"}
            </Button>
            <Button
              variant="danger"
              disabled={ending}
              onClick={async () => {
                setEnding(true);
                await actions.end(share, title);
                setEnding(false);
              }}
            >
              {ending ? "Wird beendet …" : "Freigabe beenden"}
            </Button>
          </div>
          {stuck ? (
            <p className="text-ui-sm text-warning" data-testid="share-unsaved">
              Noch nicht gespeichert – der Link gilt erst, wenn die Freigabe gespeichert ist (siehe
              Speicherstatus).
            </p>
          ) : null}
          <p className="text-ui-sm text-faint">
            Beenden macht den Link ungültig – schon geöffnete Bilder und Dateien höchstens eine
            Minute später. Neu freigeben erzeugt einen neuen Link. Alle Freigaben stehen unter
            Einstellungen › Freigaben.
          </p>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!note} onClick={() => actions.share(noteId)}>
            Freigabe erstellen
          </Button>
        </div>
      )}
    </div>
  );
}
