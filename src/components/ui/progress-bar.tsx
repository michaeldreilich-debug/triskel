import { cn } from "@/lib/cn";
import type { AreaColor } from "./pill";

const FILL: Record<AreaColor | "neutral", string> = {
  orange: "bg-area-orange",
  blue: "bg-area-blue",
  // ohne Bereich (Inbox): keine Bereichsfarbe vortäuschen
  neutral: "bg-muted",
};

export function ProgressBar({
  value,
  color = "blue",
  label,
}: {
  value: number;
  color?: AreaColor | "neutral";
  label: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1 w-full rounded-full bg-border"
    >
      <div
        className={cn("h-1 rounded-full transition-[width]", FILL[color])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
