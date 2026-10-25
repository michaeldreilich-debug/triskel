import { cn } from "@/lib/cn";
import { formatEdited } from "@/lib/dates";

/** Leise Zeile unter dem Titel (#41): „Zuletzt geändert heute um 14:32“. */
export function EditedLine({
  at,
  className,
}: {
  at: string | number | null | undefined;
  className?: string;
}) {
  const iso = typeof at === "number" ? (at > 0 ? new Date(at).toISOString() : null) : at;
  const text = formatEdited(iso);
  if (!iso || !text) return null;
  return (
    <p className={cn("text-meta text-faint tabular-nums", className)}>
      Zuletzt geändert <time dateTime={iso}>{text}</time>
    </p>
  );
}
