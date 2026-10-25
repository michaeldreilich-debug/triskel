"use client";

import { Checkbox as RadixCheckbox } from "radix-ui";
import { cn } from "@/lib/cn";

export type TaskCheckStatus = "offen" | "in_arbeit" | "wartet" | "erledigt";

export interface TaskCheckProps
  extends Omit<React.ComponentProps<typeof RadixCheckbox.Root>, "checked"> {
  status: TaskCheckStatus;
  /** 1 = hoch (rot), 2 = mittel (gelb), sonst neutral */
  priority?: number | null;
  size?: "md" | "lg";
}

/**
 * Aufgaben-Kreis (Muster 3, Rückmeldung #23): Die Farbe zeigt die Priorität (rot hoch, gelb
 * mittel), die Füllung den Status (halb = in Arbeit, gestrichelt = wartet). Abhaken füllt den
 * Kreis grün und zeichnet den Haken – dieselbe Farbe wie beim Wischen nach rechts.
 * Die Trefferfläche ist am Handy 44 px groß, auch wenn der Kreis kleiner ist.
 */
export function TaskCheck({ status, priority, size = "md", className, ...props }: TaskCheckProps) {
  const done = status === "erledigt";
  return (
    <RadixCheckbox.Root
      checked={done}
      data-priority={!done && priority && priority < 3 ? priority : undefined}
      data-task-status={status}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-faint",
        "transition-colors hover:border-muted disabled:opacity-50",
        "after:absolute after:-inset-3 after:content-[''] md:after:-inset-1.5",
        size === "lg" ? "size-6" : "size-5",
        status === "wartet" && "border-dashed",
        "data-[priority=1]:border-danger data-[priority=1]:bg-danger/12",
        "data-[priority=2]:border-warning data-[priority=2]:bg-warning/12",
        "data-[state=checked]:border-solid data-[state=checked]:border-success data-[state=checked]:bg-success",
        className,
      )}
      {...props}
    >
      {status === "in_arbeit" ? (
        <svg
          viewBox="0 0 10 10"
          aria-hidden
          className={cn("absolute fill-muted", size === "lg" ? "inset-1" : "inset-[3px]")}
        >
          <path d="M5 0a5 5 0 0 1 0 10z" />
        </svg>
      ) : null}
      <RadixCheckbox.Indicator asChild>
        <svg
          viewBox="0 0 12 12"
          aria-hidden
          className={cn(
            "fill-none stroke-accent-fg animate-check-draw [stroke-dasharray:16]",
            size === "lg" ? "size-3.5" : "size-3",
          )}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 6.5l2.2 2.2 4.8-5" />
        </svg>
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
