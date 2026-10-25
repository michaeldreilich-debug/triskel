"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  PEEK_PANEL_QUERY,
  TASK_FOLD_PARAM,
  TASK_PARAM,
  useMediaQuery,
  usePeek,
} from "@/features/tasks/peek";
import { appPath } from "@/lib/app-links";
import type { NoteRow } from "./types";

/**
 * Notiz der Notizen-Datenbank als Seitenpanel (#88, wie die Aufgabe): `?notiz=<id>` an
 * `/notizen` – die Liste bleibt daneben stehen, „Im Wissen öffnen“ führt zur ganzen Notiz.
 */
export const NOTE_PARAM = "notiz";
/** Panel zum Reiter am rechten Rand eingeklappt (#80), wie `TASK_FOLD_PARAM`. */
export const NOTE_FOLD_PARAM = "notiz-eingeklappt";
/** Eine offene Aufgabe stünde vor der Notiz – eine andere Notiz öffnen schließt sie. */
const CLEAR_ON_OPEN = [TASK_PARAM, TASK_FOLD_PARAM] as const;

export function useNotePeek() {
  const peek = usePeek(NOTE_PARAM, NOTE_FOLD_PARAM, CLEAR_ON_OPEN);
  return useMemo(() => ({ ...peek, noteId: peek.id }), [peek]);
}

/**
 * Notiz öffnen, wo eine Liste/Tabelle von Notizen steht (Notizen-Datenbank, Projekt-Reiter, #92):
 * ab 1280 px als Panel `?notiz=` neben der Seite, schmaler wie bisher im Wissen. `menu` liefert die
 * Optionen des Rechtsklick-Menüs (`NoteContextMenu`).
 */
export function useNoteOpener() {
  const router = useRouter();
  const peek = useNotePeek();
  const inPanel = useMediaQuery(PEEK_PANEL_QUERY);
  return useMemo(() => {
    const hrefOf = (noteId: string) => (inPanel ? peek.hrefFor(noteId) : appPath.note(noteId));
    const open = (noteId: string) => router.push(hrefOf(noteId), { scroll: false });
    return {
      peek,
      inPanel,
      hrefOf,
      open,
      /** Rechtsklick-Menü: im Panel öffnen, dazu „Im Wissen öffnen“; schmal nur Wissen */
      menu: (note: NoteRow) =>
        inPanel
          ? {
              onOpen: () => open(note.id),
              onOpenInKnowledge: () => router.push(appPath.note(note.id)),
              onTrashed: note.id === peek.noteId ? peek.close : undefined,
            }
          : { onOpen: () => open(note.id), openLabel: "Im Wissen öffnen" },
    };
  }, [router, peek, inPanel]);
}
