"use client";

import { Toaster as Sonner, toast } from "sonner";
import { undoStack } from "@/lib/undo";

/** Toaster mit Token-Farben; unten mittig auf Mobil, unten rechts am Desktop. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      mobileOffset={16}
      offset={24}
      duration={6000}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 text-ui text-fg shadow-float md:w-96",
          title: "flex-1",
          description: "text-ui-sm text-muted",
          actionButton:
            "ml-auto inline-flex min-h-9 shrink-0 items-center rounded-control border border-border px-3 text-ui-sm font-medium text-fg hover:bg-surface-2",
          cancelButton:
            "inline-flex min-h-9 shrink-0 items-center rounded-control px-2 text-ui-sm text-muted hover:bg-surface-2 hover:text-fg",
          error: "border-danger/50",
        },
      }}
    />
  );
}

/**
 * Muster „Aktion mit Rückgängig“: Toast mit Rückgängig-Knopf (E8). Die Umkehrung geht auch per
 * ⌘Z (undoLatest) – jede höchstens einmal.
 */
export function notifyWithUndo(
  message: string,
  onUndo: () => void,
  options: { onOpen?: () => void } = {},
) {
  const entry = undoStack.push(message, onUndo);
  const { onOpen } = options;
  const id = toast(message, {
    action: { label: "Rückgängig", onClick: () => undoStack.take(entry.id)?.undo() },
    // #75: zweiter, ruhiger Knopf „Öffnen“ (Sonner nennt ihn „cancel“, steht vor der Aktion)
    ...(onOpen ? { cancel: { label: "Öffnen", onClick: onOpen } } : {}),
  });
  entry.toastId = id;
  return id;
}

/** ⌘Z außerhalb von Textfeldern: jüngste Aktion zurücknehmen. false = es gab nichts. */
export function undoLatest(): boolean {
  const entry = undoStack.pop();
  if (!entry) return false;
  if (entry.toastId !== undefined) toast.dismiss(entry.toastId);
  entry.undo();
  toast("Rückgängig gemacht", { description: entry.message });
  return true;
}

export { toast };
