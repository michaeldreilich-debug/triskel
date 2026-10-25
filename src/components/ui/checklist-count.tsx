import { ListChecks } from "lucide-react";
import { cn } from "@/lib/cn";

/** „2/5“ der Checkliste einer Aufgabe in Zeile und Karte (#42); alles erledigt = grünes Symbol. */
export function ChecklistCount({ done, total }: { done: number; total: number }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 tabular-nums",
        done === total && "text-success",
      )}
      title={`Checkliste: ${done} von ${total} erledigt`}
    >
      <ListChecks
        size={12}
        strokeWidth={1.5}
        aria-hidden
        className={cn(done === total && "text-success")}
      />
      <span className="sr-only">Checkliste: </span>
      {done}/{total}
      <span className="sr-only"> erledigt</span>
    </span>
  );
}
