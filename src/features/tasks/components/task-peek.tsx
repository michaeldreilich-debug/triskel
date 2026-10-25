"use client";

import { SquareCheck } from "lucide-react";
import { Dialog } from "radix-ui";
import { Rail, useWide } from "@/components/shell/wide";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { cn } from "@/lib/cn";
import { useLocalNumber } from "@/lib/local-pref";
import { useMediaQuery, useTaskPeek } from "../peek";
import { TaskDetail } from "./task-detail";

/** Breite des Aufgaben-Panels, am linken Rand ziehbar wie das Notiz-Panel (#95). */
const PANEL_WIDTH = { initial: 460, min: 360, max: 960 };

/**
 * Offene Aufgabe (`?aufgabe=`) als Panel rechts neben dem Inhalt (ab 1280 px, nicht modal)
 * bzw. als Sheet von rechts darunter (Design: „rechtes Panel wird zu Sheet“). Eingeklappt (#80)
 * bleibt sie als Reiter am rechten Rand stehen – eingehängt, damit Eingaben und Scroll-Stelle bleiben.
 */
export function TaskPeekPanel() {
  const peek = useTaskPeek();
  const wide = useMediaQuery("(min-width: 1280px)");
  const wideMode = useWide();
  const [width, setWidth] = useLocalNumber(
    "sz:aufgabe-panel-breite",
    PANEL_WIDTH.initial,
    PANEL_WIDTH,
  );
  if (!peek.taskId || !wide) return null;
  return (
    <>
      {peek.folded ? (
        <Rail
          label="Aufgabe"
          icon={SquareCheck}
          side="panel"
          onClick={() => peek.fold(false)}
          className="flex"
        />
      ) : null}
      <div
        className={cn(
          "sticky top-0 h-dvh shrink-0",
          // ganze Breite (#31): Seite dahinter ist ein Reiter, die Aufgabe nimmt den Rest
          wideMode.task && "min-w-0 flex-1",
          peek.folded && "hidden",
        )}
        style={wideMode.task ? undefined : { width }}
      >
        {wideMode.task ? null : (
          <ResizeHandle
            label="Breite der Aufgabe"
            edge="left"
            value={width}
            min={PANEL_WIDTH.min}
            max={PANEL_WIDTH.max}
            onChange={setWidth}
            onReset={() => setWidth(PANEL_WIDTH.initial)}
          />
        )}
        <aside
          aria-label="Aufgabe"
          data-wide={wideMode.task || undefined}
          data-tab-scroll="aufgabe"
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
          <TaskDetail
            key={peek.taskId}
            taskId={peek.taskId}
            onClose={peek.close}
            onFold={() => {
              // eingeklappt braucht die Seite dahinter wieder ihren Platz
              wideMode.setWide(null);
              peek.fold(true);
            }}
          />
        </aside>
      </div>
    </>
  );
}

export function TaskPeekSheet() {
  const peek = useTaskPeek();
  const wide = useMediaQuery("(min-width: 1280px)");
  const open = Boolean(peek.taskId) && !wide;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && peek.close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          // App-Modus am iPhone (E44): reicht unter die Statusleiste – oben frei halten, sonst läge
          // „Aufgabe schließen“ unter Uhr und Akku (dort kommen keine Tipps an)
          className="scroll-quiet fixed inset-y-0 right-0 z-50 h-dvh w-full max-w-[520px] overflow-y-auto border-l border-border bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-fg shadow-float outline-none data-[state=open]:animate-sheet-right-in"
        >
          <Dialog.Title className="sr-only">Aufgabe</Dialog.Title>
          {peek.taskId ? (
            <TaskDetail key={peek.taskId} taskId={peek.taskId} onClose={peek.close} />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
