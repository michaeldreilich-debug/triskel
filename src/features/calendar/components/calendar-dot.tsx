import { cn } from "@/lib/cn";
import type { CalendarColor } from "../types";

/** Kalenderfarbe nur als Punkt bzw. als Text/Fläche über die Token (`--ink-*`). */
export const CALENDAR_BG: Record<CalendarColor, string> = {
  blau: "bg-ink-blau",
  gruen: "bg-ink-gruen",
  orange: "bg-ink-orange",
  gelb: "bg-ink-gelb",
  lila: "bg-ink-lila",
  rot: "bg-ink-rot",
  grau: "bg-ink-grau",
};

export const CALENDAR_TEXT: Record<CalendarColor, string> = {
  blau: "text-ink-blau",
  gruen: "text-ink-gruen",
  orange: "text-ink-orange",
  gelb: "text-ink-gelb",
  lila: "text-ink-lila",
  rot: "text-ink-rot",
  grau: "text-ink-grau",
};

/** Farbiger Balken links an Terminen (Kalender-Ansichten). */
export const CALENDAR_BORDER: Record<CalendarColor, string> = {
  blau: "border-ink-blau",
  gruen: "border-ink-gruen",
  orange: "border-ink-orange",
  gelb: "border-ink-gelb",
  lila: "border-ink-lila",
  rot: "border-ink-rot",
  grau: "border-ink-grau",
};

export function CalendarDot({ color, className }: { color: CalendarColor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", CALENDAR_BG[color], className)}
    />
  );
}
