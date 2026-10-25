import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Abschnittskopf (Muster 2, Rückmeldung #23): Symbol-Kästchen wie in der Seitenleiste, Titel,
 * blasse Unterzeile (was hier steht) und rechts die Anzahl oder ein Zustand.
 */
export function SectionHeader({
  icon: Icon,
  title,
  sub,
  meta,
  iconClassName,
  className,
  inline = false,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  sub?: React.ReactNode;
  meta?: React.ReactNode;
  iconClassName?: string;
  className?: string;
  /**
   * Nur Text-Elemente (`span`) und keine eigene Überschrift – für den Kopf in einem Knopf, um den
   * die Überschrift außen liegt (`FoldSection`, M3-3). Kinder eines Knopfs sind für
   * Bildschirmleser nur Text, eine `h2` darin wäre keine Überschrift mehr.
   */
  inline?: boolean;
}) {
  const Box = inline ? "span" : "div";
  const Title = inline ? "span" : "h2";
  const Sub = inline ? "span" : "p";
  return (
    <Box className={cn("flex min-w-0 items-center gap-3", className)}>
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-control border border-border bg-surface-2 text-muted"
      >
        <Icon size={16} strokeWidth={1.5} className={iconClassName} />
      </span>
      <Box className="flex min-w-0 flex-1 flex-col">
        <Title className="heading block truncate text-body-lg/snug">{title}</Title>
        {sub ? <Sub className="block truncate text-meta text-faint">{sub}</Sub> : null}
      </Box>
      {meta ? (
        <span className="flex shrink-0 items-center gap-2 text-ui-sm text-faint tabular-nums">
          {meta}
        </span>
      ) : null}
    </Box>
  );
}

/** Fortschritt als Segmente (z. B. Fokus: 1 von 3 erledigt). */
export function SegmentMeter({ value, total }: { value: number; total: number }) {
  return (
    <span aria-hidden className="inline-flex gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: feste Anzahl gleichartiger Segmente
          key={i}
          className={cn("h-1 w-3.5 rounded-full", i < value ? "bg-success" : "bg-border-strong")}
        />
      ))}
    </span>
  );
}
