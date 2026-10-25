"use client";

/**
 * Verlauf (S1b): Stimmung, Energie, Sport, Beziehungen und Lernen über Wochen bzw. Monate als
 * ruhige Balken aus Tokens (keine Diagramm-Bibliothek), Lücken sichtbar, wiederkehrende Themen,
 * darunter die passenden Rückblicke. Filter in der Adresse: `art`, `jahr`, `thema` – „alle
 * Monatsrückblicke 2027“ ist `?ansicht=verlauf&art=monat&jahr=2027`.
 */
import { LineChart, ListFilter, Tags } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { formatRange, type IsoDate } from "@/lib/dates";
import {
  aggregateValue,
  formatValue,
  type HistoryPeriod,
  historyGaps,
  historyPeriods,
  historyYears,
  isScaleValue,
  recapLabel,
  recapYear,
  themeCounts,
  VALUE_KEYS,
  VALUE_LABELS,
  type ValueKey,
} from "../model";
import type { RecapRow } from "../types";
import { RecapRowLink } from "./recap-row";

export interface HistoryParams {
  kind: RecapRow["kind"];
  year: number | null;
  theme: string | null;
}

export function parseHistoryParams(params: URLSearchParams): HistoryParams {
  const year = Number(params.get("jahr"));
  return {
    kind: params.get("art") === "monat" ? "monat" : "woche",
    year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null,
    theme: params.get("thema")?.trim() || null,
  };
}

const KIND_OPTIONS: Array<{ value: RecapRow["kind"]; label: string }> = [
  { value: "woche", label: "Wochen" },
  { value: "monat", label: "Monate" },
];

/** Höhe der Balken in px (Skala 1–5 → 9,6 px je Stufe). */
const CHART_HEIGHT = 48;

export function RecapHistory({
  recaps,
  today,
  params,
  onChange,
}: {
  recaps: RecapRow[];
  today: IsoDate;
  params: HistoryParams;
  onChange: (next: Partial<HistoryParams>) => void;
}) {
  const periods = historyPeriods(recaps, { kind: params.kind, year: params.year }, today);
  const written = periods.map((p) => p.recap).filter((r): r is RecapRow => r !== null);
  const years = historyYears(recaps, params.kind, today);
  const gaps = historyGaps(periods, today);
  const themes = themeCounts(written).filter((t) => t.count > 1);
  const unit = params.kind === "monat" ? "Monate" : "Wochen";
  const span = params.year === null ? `letzte ${periods.length} ${unit}` : `${unit} ${params.year}`;
  // Liste: alle Rückblicke der Art im Jahr (bzw. im Zeitraum des Diagramms), neueste zuerst
  const first = periods[0]?.start ?? today;
  const list = recaps
    .filter((r) => !r.deleted_at && r.kind === params.kind)
    .filter((r) => (params.year === null ? r.period_start >= first : recapYear(r) === params.year))
    .filter((r) => !params.theme || r.themes.includes(params.theme))
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
  const yearOptions = [
    { value: "letzte", label: `Letzte 12 ${unit}` },
    ...years.map((y) => ({ value: String(y), label: String(y) })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <fieldset className="flex min-w-0 flex-wrap items-center gap-3">
        <legend className="sr-only">Verlauf filtern</legend>
        <ListFilter size={16} strokeWidth={1.5} aria-hidden className="text-faint" />
        <SegmentedControl
          aria-label="Art"
          value={params.kind}
          onValueChange={(kind) => onChange({ kind, year: null, theme: null })}
          options={KIND_OPTIONS}
          className="min-w-44"
        />
        <div className="w-48 max-md:flex-1">
          <Select
            aria-label="Zeitraum"
            value={params.year === null ? "letzte" : String(params.year)}
            onValueChange={(value) => onChange({ year: value === "letzte" ? null : Number(value) })}
            options={yearOptions}
          />
        </div>
      </fieldset>

      <section aria-label="Werte" className="flex min-w-0 flex-col gap-4">
        <SectionHeader
          icon={LineChart}
          title="Werte"
          sub={`${span} · ${written.length} mit Rückblick${gaps ? ` · ${gaps === 1 ? "1 Lücke" : `${gaps} Lücken`}` : ""}`}
        />
        {written.length === 0 ? (
          <p className="text-ui-sm text-faint">
            Noch keine Rückblicke in diesem Zeitraum – die Werte erscheinen, sobald du welche
            schreibst.
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {VALUE_KEYS.map((key) => (
              <ValueRow key={key} valueKey={key} periods={periods} today={today} />
            ))}
            <Axis periods={periods} kind={params.kind} />
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-faint">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2 rounded-sm bg-fg" />
                neuester Wert
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-1.5 w-2 rounded-sm border border-dashed border-border-strong"
                />
                kein Rückblick
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1 rounded-full bg-border-strong" />
                nicht eingetragen
              </span>
            </p>
          </div>
        )}
      </section>

      <section aria-label="Wiederkehrende Themen" className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          icon={Tags}
          title="Wiederkehrende Themen"
          sub="Themen und Muster, die mehrmals vorkommen · antippen filtert die Liste"
        />
        {themes.length === 0 ? (
          <p className="text-ui-sm text-faint">
            Noch nichts kehrt wieder. Themen trägst du im Rückblick unter „Themen und Muster“ ein.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Themen">
            {themes.map((t) => {
              const active = params.theme === t.theme;
              return (
                <li key={t.theme}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange({ theme: active ? null : t.theme })}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-full border px-3 text-ui-sm transition-colors md:min-h-7",
                      active
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-border-strong text-muted hover:text-fg",
                    )}
                  >
                    #{t.theme} · {t.count}×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Rückblicke im Zeitraum" className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          icon={LineChart}
          title={params.kind === "monat" ? "Monatsrückblicke" : "Wochenrückblicke"}
          sub={`${params.year === null ? span : params.year}${params.theme ? ` · #${params.theme}` : ""} · neueste zuerst`}
          meta={list.length || undefined}
        />
        {list.length === 0 ? (
          <p className="text-ui-sm text-faint">Keine passenden Rückblicke.</p>
        ) : (
          <ul aria-label="Rückblicke" className="flex flex-col border-t border-border">
            {list.map((recap) => (
              <RecapRowLink
                key={recap.id}
                recap={recap}
                title={recapLabel(recap)}
                range={formatRange(recap.period_start, recap.period_end)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const ROW =
  "grid grid-cols-[76px_minmax(0,1fr)_44px] items-end gap-3 md:grid-cols-[104px_minmax(0,1fr)_56px]";

/** Ein Wert über die Zeiträume: Balken je Zeitraum, rechts Ø (Skalen) bzw. Summe (Sport). */
function ValueRow({
  valueKey,
  periods,
  today,
}: {
  valueKey: ValueKey;
  periods: HistoryPeriod[];
  today: IsoDate;
}) {
  const scale = isScaleValue(valueKey);
  const values = periods.map((p) => (p.recap ? p.recap[valueKey] : null));
  const max = scale ? 5 : Math.max(1, ...values.map((v) => v ?? 0));
  const written = periods.map((p) => p.recap).filter((r): r is RecapRow => r !== null);
  const total = aggregateValue(written, valueKey);
  const lastIndex = values.reduce<number>((at, v, i) => (v !== null ? i : at), -1);
  const label = VALUE_LABELS[valueKey];
  return (
    <div className={ROW}>
      <span className="pb-0.5 text-ui-sm text-muted">{label}</span>
      <ul
        aria-label={`${label} je Zeitraum`}
        className="flex items-end gap-0.5"
        style={{ height: CHART_HEIGHT }}
      >
        {periods.map((period, i) => {
          const value = values[i] ?? null;
          const text = !period.recap
            ? period.current || period.end >= today
              ? "läuft noch"
              : period.beforeFirst
                ? "vor dem ersten Rückblick"
                : "kein Rückblick"
            : value === null
              ? "nicht eingetragen"
              : scale
                ? `${value} von 5`
                : formatValue(value);
          return (
            <li
              key={period.start}
              title={`${period.title}: ${text}`}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <span className="sr-only">
                {period.title}: {text}
              </span>
              {period.recap && value !== null ? (
                <span
                  aria-hidden
                  className={cn(
                    "mx-auto w-full max-w-7 rounded-sm",
                    i === lastIndex ? "bg-fg" : "bg-border-strong",
                  )}
                  style={{ height: Math.max(3, (value / max) * CHART_HEIGHT) }}
                />
              ) : period.recap ? (
                <span aria-hidden className="mx-auto size-1 rounded-full bg-border-strong" />
              ) : period.end < today && !period.beforeFirst ? (
                <span
                  aria-hidden
                  className="mx-auto h-1.5 w-full max-w-7 rounded-sm border border-dashed border-border-strong"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <span className="pb-0.5 text-right text-ui-sm font-medium tabular-nums">
        {total === null ? (
          <span className="text-faint">–</span>
        ) : (
          `${scale ? "Ø " : ""}${formatValue(total)}`
        )}
      </span>
    </div>
  );
}

/** Achse unter den Balken: etwa sechs Beschriftungen (Wochen als Nummer), die letzte immer. */
function Axis({ periods, kind }: { periods: HistoryPeriod[]; kind: RecapRow["kind"] }) {
  const step = Math.max(1, Math.ceil(periods.length / 6));
  return (
    <div className={cn(ROW, "items-start")} aria-hidden>
      <span className="text-meta text-faint">{kind === "woche" ? "KW" : ""}</span>
      <div className="flex gap-0.5">
        {periods.map((period, i) => (
          <span
            key={period.start}
            // mittig unter dem Balken; läuft höchstens in die Spalten daneben über
            className="flex min-w-0 flex-1 justify-center whitespace-nowrap text-meta text-faint tabular-nums"
          >
            {i === periods.length - 1 || (i % step === 0 && periods.length - 1 - i >= step)
              ? period.short
              : ""}
          </span>
        ))}
      </div>
      <span />
    </div>
  );
}
