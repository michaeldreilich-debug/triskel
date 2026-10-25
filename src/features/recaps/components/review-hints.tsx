"use client";

import { CalendarCheck, Target } from "lucide-react";
import Link from "next/link";
import { appPath } from "@/lib/app-links";
import { berlinDate } from "@/lib/dates";
import { useRecaps } from "../api";
import { todayHints } from "../review";

/**
 * Hinweise auf Heute (S1c): sonntags das Wochenreview (montags nur ein angefangenes), zum
 * Monatswechsel der Monatsrückblick. Ruhige Zeilen unter der Zusammenfassung, keine Warnung.
 */
export function ReviewHints({ now }: { now: number }) {
  const recaps = useRecaps();
  if (!recaps.data) return null;
  const hints = todayHints(recaps.data, berlinDate(new Date(now)), {
    review: appPath.weeklyReview(),
    month: (start) => appPath.recapPeriod("monat", start),
  });
  return (
    <>
      {hints.map((hint) => {
        const Icon = hint.kind === "woche" ? Target : CalendarCheck;
        return (
          <p
            key={hint.kind}
            data-testid={`review-hint-${hint.kind}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-sm text-muted"
          >
            <Icon size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
            <span>{hint.text}</span>
            <Link href={hint.href} className="text-link hover:underline">
              {hint.action}
            </Link>
          </p>
        );
      })}
    </>
  );
}
