"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Rail } from "@/components/shell/wide";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Skeleton } from "@/components/ui/skeleton";
import { useAreas } from "@/features/areas/api";
import { PEEK_PANEL_QUERY, useMediaQuery, useTaskPeek } from "@/features/tasks/peek";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { useLocalNumber } from "@/lib/local-pref";
import { useNotes, useTopics } from "../api";
import { useNotePeek } from "../peek";
import { NoteView } from "./note-view";

/** Breite des Notiz-Panels (#88), am linken Rand ziehbar wie die Spalten im Wissen (#83). */
const PANEL_WIDTH = { initial: 560, min: 400, max: 960 };

/**
 * Offene Notiz der Notizen-Datenbank (`?notiz=`, #88) als Panel rechts neben der Liste – wie die
 * Aufgabe (`TaskPeekPanel`) ab 1280 px, nicht modal. Eingeklappt (#80) bleibt sie als Reiter am
 * rechten Rand stehen; ist zugleich eine Aufgabe offen, steht diese vorn. In beiden Fällen bleibt
 * die Notiz eingehängt (Eingaben und Scroll-Stelle bleiben). Schmaler öffnet die Notiz im Wissen.
 */
export function NotePeekPanel() {
  const peek = useNotePeek();
  const task = useTaskPeek();
  const wide = useMediaQuery(PEEK_PANEL_QUERY);
  const router = useRouter();
  const [width, setWidth] = useLocalNumber(
    "sz:notiz-panel-breite",
    PANEL_WIDTH.initial,
    PANEL_WIDTH,
  );

  // Handy und Tablet: daneben ist kein Platz – die Notiz im Wissen zeigen (auch nach dem
  // Verkleinern des Fensters). Erst im Effekt prüfen: beim ersten Rendern kennt `wide` die
  // Breite noch nicht.
  const noteId = peek.noteId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wide` stößt die Prüfung beim Verkleinern an
  useEffect(() => {
    if (noteId && !window.matchMedia(PEEK_PANEL_QUERY).matches) {
      router.replace(appPath.note(noteId));
    }
  }, [noteId, wide, router]);

  if (!noteId || !wide) return null;
  const behind = Boolean(task.taskId);
  return (
    <>
      {peek.folded && !behind ? (
        <Rail
          label="Notiz"
          icon={FileText}
          side="panel"
          onClick={() => peek.fold(false)}
          className="flex"
        />
      ) : null}
      <div
        className={cn("sticky top-0 h-dvh shrink-0", (peek.folded || behind) && "hidden")}
        style={{ width }}
      >
        <ResizeHandle
          label="Breite der Notiz"
          edge="left"
          value={width}
          min={PANEL_WIDTH.min}
          max={PANEL_WIDTH.max}
          onChange={setWidth}
          onReset={() => setWidth(PANEL_WIDTH.initial)}
        />
        <aside
          aria-label="Notiz"
          data-tab-scroll="notiz-panel"
          className="scroll-quiet h-full overflow-y-auto border-l border-border bg-bg"
          onKeyDown={(event) => {
            // nur aus dem Panel selbst (nicht aus Menüs/Popovern, die per Portal darüber liegen)
            if (
              event.key === "Escape" &&
              !event.defaultPrevented &&
              event.currentTarget.contains(event.target as Node)
            ) {
              peek.close();
            }
          }}
        >
          <PanelNote noteId={noteId} onClose={peek.close} onFold={() => peek.fold(true)} />
        </aside>
      </div>
    </>
  );
}

function PanelNote({
  noteId,
  onClose,
  onFold,
}: {
  noteId: string;
  onClose: () => void;
  onFold: () => void;
}) {
  const peek = useNotePeek();
  const notes = useNotes();
  const areas = useAreas();
  const topics = useTopics();
  const note = notes.data?.find((n) => n.id === noteId);

  if (note) {
    return (
      <NoteView
        key={note.id}
        note={note}
        notes={notes.data ?? []}
        areas={areas.data ?? []}
        topics={topics.data ?? []}
        backHref={appPath.notes()}
        hrefFor={peek.hrefFor}
        onOpenNote={peek.open}
        onTrashed={onClose}
        backlinksInColumn={false}
        panel={{ onClose, onFold }}
      />
    );
  }
  if (notes.isPending) {
    return (
      <div className="flex flex-col gap-4 px-6 py-5" aria-busy="true">
        <span className="sr-only">Notiz wird geladen</span>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  return (
    <div className="p-6">
      <EmptyState
        title={notes.isError ? "Notiz konnte nicht geladen werden" : "Notiz nicht gefunden"}
        description={
          notes.isError
            ? "Bitte Verbindung prüfen und neu laden."
            : "Sie liegt im Papierkorb oder existiert nicht mehr."
        }
        action={<Button onClick={onClose}>Schließen</Button>}
      />
    </div>
  );
}
