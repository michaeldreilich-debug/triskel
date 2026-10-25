import { cn } from "@/lib/cn";

export type AreaColor = "orange" | "blue";
export type Tone = "default" | "success" | "warning" | "danger" | "muted";

const AREA_BG: Record<AreaColor, string> = {
  orange: "bg-area-orange",
  blue: "bg-area-blue",
};

export const AREA_TEXT: Record<AreaColor, string> = {
  orange: "text-area-orange",
  blue: "text-area-blue",
};

/** Bereichsfarbe nur als Punkt (nie als Fläche). */
export function AreaDot({ color, className }: { color: AreaColor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", AREA_BG[color], className)}
    />
  );
}

const TONE_DOT: Record<Tone, string> = {
  default: "bg-faint",
  muted: "bg-faint/50",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/** Umrandete Pille für Status, Tags, Typen – nie gefüllt. */
export function Pill({
  tone,
  area,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; area?: AreaColor }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-strong px-2.5 py-0.5 text-meta text-fg/85",
        className,
      )}
      {...props}
    >
      {area ? <AreaDot color={area} /> : null}
      {tone ? (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Tag({ name, className }: { name: string; className?: string }) {
  return <Pill className={cn("text-muted", className)}>#{name}</Pill>;
}
