import { Fragment } from "react";
import { cn } from "@/lib/cn";

export interface SummaryPart {
  text: string;
  tone?: "danger" | "warning";
}

const TONE = { danger: "text-danger", warning: "text-warning" } as const;

/**
 * Zusammenfassung unter dem Seitentitel (Muster 1, Rückmeldung #23): was zählt, in einer Zeile,
 * getrennt durch Punkte. Farbe nur, wo sie Bedeutung trägt (überfällig, festgefahren).
 */
export function SummaryLine({
  parts,
  className,
  ...props
}: { parts: SummaryPart[]; className?: string } & React.HTMLAttributes<HTMLParagraphElement>) {
  if (parts.length === 0) return null;
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-ui-sm text-muted tabular-nums md:text-ui",
        className,
      )}
      {...props}
    >
      {parts.map((part, index) => (
        <Fragment key={part.text}>
          {index > 0 ? (
            <span aria-hidden className="text-faint">
              ·
            </span>
          ) : null}
          <span className={part.tone ? TONE[part.tone] : undefined}>{part.text}</span>
        </Fragment>
      ))}
    </p>
  );
}
