import { Share, SquarePlus } from "lucide-react";
import { TriskelMark } from "@/components/triskel-mark";
import { INSTALL_NOTE, INSTALL_STEPS } from "@/lib/install-hint";

const STEP_ICONS = [
  <Share key="share" size={18} strokeWidth={1.5} aria-hidden />,
  <SquarePlus key="plus" size={18} strokeWidth={1.5} aria-hidden />,
  <TriskelMark key="mark" size={18} />,
];

/** Die drei Schritte mit Symbol – im Hinweis auf Heute und in Einstellungen › Auf dem Handy. */
export function InstallSteps({ label = "So geht es" }: { label?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ol aria-label={label} className="flex flex-col divide-y divide-border">
        {INSTALL_STEPS.map((step, index) => (
          <li key={step} className="flex min-h-11 min-w-0 items-center gap-3 py-1.5 text-ui">
            <span aria-hidden className="w-4 shrink-0 text-meta text-faint tabular-nums">
              {index + 1}
            </span>
            <span className="flex size-5 shrink-0 items-center justify-center">
              {STEP_ICONS[index]}
            </span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
      <p className="text-ui-sm text-muted">{INSTALL_NOTE}</p>
    </div>
  );
}
