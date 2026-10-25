import { cn } from "@/lib/cn";
import { type DueTone, dueTone, formatDue, type IsoDate } from "@/lib/dates";

const TONE: Record<DueTone, string> = {
  over: "text-danger",
  today: "font-medium text-fg",
  soon: "text-muted",
  later: "text-faint",
};

/**
 * Fälligkeit mit Bedeutung (Muster 4, Rückmeldung #23): überfällig rot mit Wochentag, heute
 * kräftig, morgen grau, später blass. Erledigtes immer blass. Orange bleibt dem Bereich
 * Beruf vorbehalten.
 */
export function DueDate({
  value,
  today,
  done = false,
  prefix,
  size = "meta",
  className,
}: {
  value: IsoDate | null | undefined;
  today: IsoDate;
  done?: boolean;
  prefix?: string;
  /** „inherit“ übernimmt die Schriftgröße der Umgebung (z. B. Tabellenzelle) */
  size?: "meta" | "inherit";
  className?: string;
}) {
  if (!value) return null;
  const tone = done ? null : dueTone(value, today);
  return (
    <span
      className={cn(
        // relative: hält den Screenreader-Text in scrollenden Bereichen (Board) fest
        "relative whitespace-nowrap tabular-nums",
        size === "meta" && "text-meta",
        tone ? TONE[tone] : "text-faint",
        className,
      )}
    >
      {tone === "over" ? <span className="sr-only">überfällig: </span> : null}
      {prefix}
      {formatDue(value, today)}
    </span>
  );
}
