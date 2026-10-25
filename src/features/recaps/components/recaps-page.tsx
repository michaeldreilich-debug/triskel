"use client";

import { CircleDashed, History, PenLine } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryLine, type SummaryPart } from "@/components/ui/summary-line";
import { appPath } from "@/lib/app-links";
import { berlinDate, formatDayShort, formatRange, isoWeekYear } from "@/lib/dates";
import { useRecapActions, useRecaps } from "../api";
import {
  dueMonth,
  gapCount,
  historyRows,
  isAnswered,
  type MonthSlot,
  questionsOf,
  recapMonths,
  recapWeeks,
  type WeekSlot,
} from "../model";
import type { RecapRow } from "../types";
import { type HistoryParams, parseHistoryParams, RecapHistory } from "./recap-history";
import { useRecapQuestions } from "./recap-questions";
import { RecapRowLink } from "./recap-row";

/** Reiter der Rückblick-Seite (`?ansicht=`, damit sich Ansichten verlinken lassen). */
export type RecapsTab = "wochen" | "monate" | "verlauf";
const TABS: Array<{ value: RecapsTab; label: string }> = [
  { value: "wochen", label: "Wochen" },
  { value: "monate", label: "Monate" },
  { value: "verlauf", label: "Verlauf" },
];
const parseTab = (value: string | null): RecapsTab =>
  TABS.some((t) => t.value === value) ? (value as RecapsTab) : "wochen";

/**
 * Rückblicke (B12, S1a, S1b): Reiter Wochen (laufende Woche oben, darunter die früheren mit
 * Lücken, E24), Monate (Monatsrückblick, der gerade dran ist, darunter die früheren Monate) und
 * Verlauf (Werte über die Zeit, wiederkehrende Themen, Filter nach Art, Jahr und Thema).
 */
export function RecapsPage() {
  const recaps = useRecaps();
  const actions = useRecapActions();
  const questions = useRecapQuestions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseTab(params.get("ansicht"));
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const loading = !mounted || recaps.isPending;
  const today = berlinDate();
  const all = recaps.data ?? [];
  const weeks = loading ? [] : recapWeeks(all, today);
  const months = loading ? [] : recapMonths(all, today);
  const weekCount = all.filter((r) => r.kind === "woche").length;
  const monthCount = all.filter((r) => r.kind === "monat").length;
  // Lücken im Kopf: die des Reiters (im Verlauf stehen sie beim Diagramm)
  const gaps =
    loading || tab === "verlauf" ? 0 : gapCount(tab === "monate" ? months : weeks, today);

  const write = (
    kind: RecapRow["kind"],
    slot: { start: string; end: string; recap: RecapRow | null },
  ) => {
    const recap = slot.recap ?? actions.create(kind, slot.start, slot.end, questions);
    router.push(appPath.recap(recap.id));
  };
  const replace = (search: URLSearchParams) => {
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const setTab = (next: RecapsTab) => {
    const search = new URLSearchParams(params.toString());
    if (next === "wochen") search.delete("ansicht");
    else search.set("ansicht", next);
    if (next !== "verlauf") for (const key of ["art", "jahr", "thema"]) search.delete(key);
    replace(search);
  };
  const history = parseHistoryParams(params);
  const setHistory = (next: Partial<HistoryParams>) => {
    const merged = { ...history, ...next };
    const search = new URLSearchParams(params.toString());
    search.set("ansicht", "verlauf");
    if (merged.kind === "monat") search.set("art", "monat");
    else search.delete("art");
    if (merged.year === null) search.delete("jahr");
    else search.set("jahr", String(merged.year));
    if (merged.theme) search.set("thema", merged.theme);
    else search.delete("thema");
    replace(search);
  };

  const summary: SummaryPart[] = [
    { text: weekCount === 1 ? "1 Wochenrückblick" : `${weekCount} Wochenrückblicke` },
  ];
  if (monthCount) {
    summary.push({
      text: monthCount === 1 ? "1 Monatsrückblick" : `${monthCount} Monatsrückblicke`,
    });
  }
  if (gaps) summary.push({ text: gaps === 1 ? "1 Lücke" : `${gaps} Lücken`, tone: "warning" });

  return (
    <Page>
      <PageHeader
        title="Rückblicke"
        summary={loading ? null : <SummaryLine parts={summary} data-testid="recaps-summary" />}
        actions={
          <SegmentedControl
            aria-label="Rückblicke zeigen"
            value={tab}
            onValueChange={setTab}
            options={TABS}
            className="max-md:w-full md:min-w-72"
          />
        }
      />
      {recaps.isError ? (
        <p role="alert" className="text-ui text-danger">
          Rückblicke konnten nicht geladen werden. Verbindung prüfen.
        </p>
      ) : loading ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <span className="sr-only">Rückblicke werden geladen</span>
          <Skeleton className="h-32 w-full rounded-card" />
          <Skeleton className="h-48 w-full rounded-card" />
        </div>
      ) : tab === "verlauf" ? (
        <RecapHistory recaps={all} today={today} params={history} onChange={setHistory} />
      ) : tab === "monate" ? (
        <MonthsTab slots={months} today={today} onWrite={(slot) => write("monat", slot)} />
      ) : (
        <WeeksTab slots={weeks} today={today} onWrite={(slot) => write("woche", slot)} />
      )}
    </Page>
  );
}

function WeeksTab({
  slots,
  today,
  onWrite,
}: {
  slots: WeekSlot[];
  today: string;
  onWrite: (slot: WeekSlot) => void;
}) {
  const current = slots.find((s) => s.current);
  const history = slots.filter((s) => !s.current && (s.recap || s.end < today));
  if (!current) return null;
  return (
    <>
      <CurrentWeek slot={current} today={today} onWrite={() => onWrite(current)} />
      <section aria-label="Frühere Wochen" className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          icon={History}
          title="Frühere Wochen"
          sub="Neueste zuerst · Wochen ohne Rückblick bleiben sichtbar"
          meta={history.length || undefined}
        />
        {history.length === 0 ? (
          <p className="text-ui-sm text-faint">
            Noch keine früheren Wochen. Der erste Rückblick beginnt den Verlauf.
          </p>
        ) : (
          <ul aria-label="Wochen" className="flex flex-col border-t border-border">
            {historyRows(history).map((row) =>
              row.kind === "gaps" ? (
                <GapRun
                  key={row.slots[0]?.start}
                  slots={row.slots}
                  label={weekGapLabel(row.slots)}
                  unit="Wochen"
                  render={(slot) => (
                    <WeekRow key={slot.start} slot={slot} onWrite={() => onWrite(slot)} />
                  )}
                />
              ) : (
                <WeekRow key={row.slot.start} slot={row.slot} onWrite={() => onWrite(row.slot)} />
              ),
            )}
          </ul>
        )}
      </section>
    </>
  );
}

/** Monate (S1a): der Monat, der dran ist, als Karte; darunter die übrigen mit Lücken. */
function MonthsTab({
  slots,
  today,
  onWrite,
}: {
  slots: MonthSlot[];
  today: string;
  onWrite: (slot: MonthSlot) => void;
}) {
  const due = dueMonth(slots, today);
  const history = slots.filter((s) => s !== due && (s.recap || s.end < today));
  if (!due) return null;
  return (
    <>
      <CurrentMonth slot={due} today={today} onWrite={() => onWrite(due)} />
      <section aria-label="Frühere Monate" className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          icon={History}
          title="Frühere Monate"
          sub="Neueste zuerst · Monate ohne Rückblick bleiben sichtbar"
          meta={history.length || undefined}
        />
        {history.length === 0 ? (
          <p className="text-ui-sm text-faint">
            Noch keine früheren Monate. Der erste Monatsrückblick beginnt den Verlauf.
          </p>
        ) : (
          <ul aria-label="Monate" className="flex flex-col border-t border-border">
            {historyRows(history).map((row) =>
              row.kind === "gaps" ? (
                <GapRun
                  key={row.slots[0]?.start}
                  slots={row.slots}
                  label={`${row.slots[row.slots.length - 1]?.label} – ${row.slots[0]?.label}`}
                  unit="Monate"
                  render={(slot) => (
                    <MonthRow key={slot.start} slot={slot} onWrite={() => onWrite(slot)} />
                  )}
                />
              ) : (
                <MonthRow key={row.slot.start} slot={row.slot} onWrite={() => onWrite(row.slot)} />
              ),
            )}
          </ul>
        )}
      </section>
    </>
  );
}

const weekGapLabel = (slots: WeekSlot[]) => {
  const newest = slots[0] as WeekSlot;
  const oldest = slots[slots.length - 1] as WeekSlot;
  return newest.year === oldest.year
    ? `KW ${oldest.week}–${newest.week}`
    : `KW ${oldest.week}/${oldest.year}–${newest.week}/${newest.year}`;
};

/** Die laufende Woche: die eine gefüllte Karte der Seite (Muster 1). */
function CurrentWeek({
  slot,
  today,
  onWrite,
}: {
  slot: WeekSlot;
  today: string;
  onWrite: () => void;
}) {
  const recap = slot.recap;
  const sunday = slot.end === today;
  return (
    <section
      aria-label="Diese Woche"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 md:p-5"
    >
      <SectionHeader
        icon={PenLine}
        title={`Diese Woche · KW ${slot.week}`}
        sub={`${formatRange(slot.start, slot.end)} · ${
          recap?.closed_at
            ? "abgeschlossen"
            : sunday
              ? "heute ist Rückblick-Tag"
              : `läuft bis ${formatDayShort(slot.end)}`
        }`}
        meta={recap ? <Progress recap={recap} /> : undefined}
      />
      <div className="flex flex-wrap items-center gap-3">
        {recap ? (
          <Link
            href={appPath.recap(recap.id)}
            className="inline-flex h-11 items-center gap-2 rounded-control bg-accent px-4 text-ui font-medium text-accent-fg hover:bg-accent/90 md:h-9"
          >
            {recap.closed_at ? "Rückblick ansehen" : "Weiter schreiben"}
          </Link>
        ) : (
          <Button variant="primary" onClick={onWrite}>
            Wochenrückblick schreiben
          </Button>
        )}
        <Link
          href={appPath.weeklyReview(slot.start)}
          className="inline-flex h-11 items-center gap-2 rounded-control border border-border px-4 text-ui hover:bg-surface-2 md:h-9"
        >
          {recap?.review.finished_at
            ? "Wochenreview ansehen"
            : recap?.review.started_at
              ? "Wochenreview weitermachen"
              : "Geführtes Wochenreview"}
        </Link>
        <p className="text-ui-sm text-muted">
          Wie ging es dir, was lief gut, was war schwer – und der Fokus für nächste Woche. Das
          Wochenreview geht dazu auch Inbox, Projekte und die nächste Woche durch.
        </p>
      </div>
    </section>
  );
}

function Progress({ recap }: { recap: RecapRow }) {
  const questions = questionsOf(recap);
  const answered = questions.filter((q) => isAnswered(recap, q)).length;
  return (
    <span>
      {answered} von {questions.length} beantwortet
    </span>
  );
}

/** Mehrere Wochen bzw. Monate ohne Rückblick hintereinander: eine Zeile, aufklappbar. */
function GapRun<T extends { start: string }>({
  slots,
  label,
  unit,
  render,
}: {
  slots: T[];
  label: string;
  unit: string;
  render: (slot: T) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (open) return <>{slots.map(render)}</>;
  return (
    <li className="grid min-h-12 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-1.5">
      <CircleDashed size={16} strokeWidth={1.5} aria-hidden className="text-faint" />
      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <span className="text-ui text-faint">{label}</span>
        <span className="truncate text-meta text-faint tabular-nums">
          {slots.length} {unit} ohne Rückblick
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`${label} einzeln zeigen`}
      >
        Einzeln zeigen
      </Button>
    </li>
  );
}

/** Der Monat, der dran ist (S1a): die eine gefüllte Karte im Reiter Monate. */
function CurrentMonth({
  slot,
  today,
  onWrite,
}: {
  slot: MonthSlot;
  today: string;
  onWrite: () => void;
}) {
  const recap = slot.recap;
  const status = recap?.closed_at
    ? "abgeschlossen"
    : slot.end === today
      ? "heute ist Rückblick-Tag"
      : slot.end < today
        ? "steht noch aus"
        : `läuft bis ${formatDayShort(slot.end)}`;
  return (
    <section
      aria-label={slot.current ? "Dieser Monat" : "Voriger Monat"}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 md:p-5"
    >
      <SectionHeader
        icon={PenLine}
        title={`${slot.current ? "Dieser Monat" : "Voriger Monat"} · ${slot.label}`}
        sub={`${formatRange(slot.start, slot.end)} · ${status}`}
        meta={recap ? <Progress recap={recap} /> : undefined}
      />
      <div className="flex flex-wrap items-center gap-3">
        {recap ? (
          <Link
            href={appPath.recap(recap.id)}
            className="inline-flex h-11 items-center gap-2 rounded-control bg-accent px-4 text-ui font-medium text-accent-fg hover:bg-accent/90 md:h-9"
          >
            {recap.closed_at ? "Rückblick ansehen" : "Weiter schreiben"}
          </Link>
        ) : (
          <Button variant="primary" onClick={onWrite}>
            Monatsrückblick schreiben
          </Button>
        )}
        <p className="text-ui-sm text-muted">
          Fasst die Wochen zusammen – Zahlen, Wochen-Reflexionen und dein Blick auf den Monat.
        </p>
      </div>
    </section>
  );
}

/** Ein Monat im Verlauf: Monatsrückblick (offen/abgeschlossen) oder Lücke mit „Nachholen“. */
function MonthRow({ slot, onWrite }: { slot: MonthSlot; onWrite: () => void }) {
  const recap = slot.recap;
  const range = formatRange(slot.start, slot.end);
  if (!recap) {
    return (
      <li className="grid min-h-12 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-1.5">
        <CircleDashed size={16} strokeWidth={1.5} aria-hidden className="text-faint" />
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <span className="text-ui text-faint">{slot.label}</span>
          <span className="truncate text-meta text-faint tabular-nums">
            {range} · kein Rückblick
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onWrite} aria-label={`${slot.label} nachholen`}>
          Nachholen
        </Button>
      </li>
    );
  }
  return <RecapRowLink recap={recap} title={slot.label} range={range} />;
}

/** Eine Woche im Verlauf: Rückblick (offen/abgeschlossen) oder Lücke mit „Nachholen“. */
function WeekRow({ slot, onWrite }: { slot: WeekSlot; onWrite: () => void }) {
  const recap = slot.recap;
  const range = formatRange(slot.start, slot.end);
  // Wochen aus anderen Jahren mit Jahr („KW 10/2025“), sobald der Verlauf über ein Jahr reicht
  const name =
    slot.year === isoWeekYear(berlinDate()) ? `KW ${slot.week}` : `KW ${slot.week}/${slot.year}`;
  if (!recap) {
    return (
      <li className="grid min-h-12 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-1.5">
        <CircleDashed size={16} strokeWidth={1.5} aria-hidden className="text-faint" />
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <span className="text-ui text-faint">{name}</span>
          <span className="truncate text-meta text-faint tabular-nums">
            {range} · kein Rückblick
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onWrite} aria-label={`${name} nachholen`}>
          Nachholen
        </Button>
      </li>
    );
  }
  return <RecapRowLink recap={recap} title={name} range={range} />;
}
