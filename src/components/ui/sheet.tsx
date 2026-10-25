"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export type SheetSide = "left" | "right" | "bottom";

const SIDES: Record<SheetSide, string> = {
  left: "inset-y-0 left-0 h-dvh w-sidebar max-w-[85vw] border-r data-[state=open]:animate-sheet-left-in data-[state=closed]:animate-sheet-left-out",
  right:
    "inset-y-0 right-0 h-dvh w-96 max-w-[90vw] border-l data-[state=open]:animate-sheet-right-in data-[state=closed]:animate-sheet-right-out",
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-sheet border-t pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-sheet-bottom-in data-[state=closed]:animate-sheet-bottom-out",
};

export interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: SheetSide;
  title: string;
  /** Titel nur für Screenreader (z. B. bei der Navigation) */
  hideTitle?: boolean;
  description?: string;
  trigger?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Sheet (von links, rechts oder unten) – auf Mobil Ersatz für Sidebar und rechtes Panel. */
export function Sheet({
  open,
  onOpenChange,
  side = "bottom",
  title,
  hideTitle,
  description,
  trigger,
  children,
  className,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <Dialog.Content
          className={cn(
            "fixed z-50 flex flex-col overflow-y-auto border-border bg-sidebar text-fg shadow-float outline-none",
            SIDES[side],
            className,
          )}
        >
          {side === "bottom" ? (
            <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
          ) : null}
          <div
            className={cn(
              "flex items-center justify-between gap-2 px-4 pt-3",
              // ohne sichtbaren Titel nur der Titel unsichtbar: Radix fokussiert beim Öffnen den
              // Schließen-Knopf – unsichtbar sähe man den Fokus nicht (O-17)
              hideTitle && "absolute top-0 right-0 z-10 px-2 pt-2",
              // seitliche Sheets reichen bis zum oberen Rand: im App-Modus unter die Statusleiste frei
              // halten (eine Klasse – `cn` löst Konflikte nicht auf, eine zweite pt-[…] bliebe wirkungslos)
              side !== "bottom" && "pt-[max(0.75rem,env(safe-area-inset-top))]",
            )}
          >
            <Dialog.Title className={cn("heading text-heading", hideTitle && "sr-only")}>
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Schließen">
                <X size={16} strokeWidth={1.5} aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="px-4 text-ui-sm text-muted">
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="flex-1 p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
