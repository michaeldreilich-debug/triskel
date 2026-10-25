"use client";

import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { BufferedInput } from "@/components/ui/buffered-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FoldSection } from "@/components/ui/fold-section";
import { controlClasses, FieldError, FieldHint } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatDayShort } from "@/lib/dates";
import { probeCalendarUrl, useCalendarSourceActions, useCalendarSources } from "../api";
import { useGoogleStatus } from "../google/client";
import { calendarIdFromIcalUrl, icalReplacedByGoogle, sameCalendarId } from "../google/match";
import {
  CALENDAR_COLOR_LABELS,
  CALENDAR_COLORS,
  type CalendarColor,
  type CalendarProbe,
  type CalendarSourceRow,
  DEFAULT_CALENDAR_COLOR,
} from "../types";
import { CalendarDot } from "./calendar-dot";
import { GoogleAccount } from "./google-account";

const GOOGLE_HELP =
  "Google Kalender am Computer › Einstellungen › Kalender auswählen › „Kalender integrieren“ › „Geheime Adresse im iCal-Format“ kopieren.";

type ProbeState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; probe: CalendarProbe }
  | { kind: "failed"; error: string };

/** Probe-Abruf mit Zustand – geteilt von Zeile und Formular. */
function useProbe() {
  const [state, setState] = useState<ProbeState>({ kind: "idle" });
  const run = async (url: string): Promise<CalendarProbe | null> => {
    setState({ kind: "busy" });
    try {
      const probe = await probeCalendarUrl(url);
      setState({ kind: "done", probe });
      return probe;
    } catch (error) {
      setState({
        kind: "failed",
        error: error instanceof Error ? error.message : "Probe-Abruf fehlgeschlagen.",
      });
      return null;
    }
  };
  return { state, run, reset: () => setState({ kind: "idle" }) };
}

function ProbeLine({ state }: { state: ProbeState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "busy") return <FieldHint role="status">Lade Kalender …</FieldHint>;
  if (state.kind === "failed") return <FieldError>{state.error}</FieldError>;
  const { probe } = state;
  if (!probe.ok)
    return <FieldError>{probe.error ?? "Der Kalender ließ sich nicht lesen."}</FieldError>;
  const next = probe.next
    .map((e) => `${e.title} (${formatDayShort(e.date)}${e.time ? ` ${e.time}` : ""})`)
    .join(" · ");
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 text-ui-sm text-muted">
      <Check size={14} strokeWidth={2} aria-hidden className="shrink-0 text-success" />
      <span>
        {probe.calendarName ? `„${probe.calendarName}“ · ` : ""}
        {probe.count === 1 ? "1 Termin" : `${probe.count} Termine`} in den nächsten 30 Tagen
        {next ? ` · als Nächstes: ${next}` : ""}
      </span>
    </p>
  );
}

const colorOptions = CALENDAR_COLORS.map((color) => ({
  value: color,
  label: CALENDAR_COLOR_LABELS[color],
  icon: <CalendarDot color={color} />,
}));

/** Kopfzeile: Google-Stand und Zahl der Kalender – erst, wenn beides geladen ist. */
function summaryOf(all: CalendarSourceRow[], connected: boolean): string {
  const count =
    all.filter((s) => s.kind === "ical").length +
    (connected ? all.filter((s) => s.kind === "google" && s.enabled).length : 0);
  const calendars =
    count === 0 ? "Noch kein Kalender" : count === 1 ? "1 Kalender" : `${count} Kalender`;
  return connected ? `Google verbunden · ${calendars}` : calendars;
}

/**
 * Einstellungen › Kalender: oben das Google-Konto (#64, N1a – verbinden, Kalenderliste an/aus),
 * darunter die geheimen iCal-Adressen (S2a) – Name, Farbe, an/aus, Reihenfolge, Probe-Abruf. Die
 * Adresse ist ein Geheimnis: nur hier sichtbar (auf Wunsch), nie im Export, nie bei der KI;
 * gelesen wird sie nur vom Server. Meint eine Adresse einen eingeschalteten Google-Kalender, steht
 * an ihr „ersetzt durch Google“.
 */
export function CalendarSourcesSection() {
  const sources = useCalendarSources();
  const actions = useCalendarSourceActions();
  const google = useGoogleStatus();
  const all = sources.data ?? [];
  const list = all.filter((s) => s.kind === "ical");
  const connected = google.data?.connected === true;
  const enabledGoogle = all.filter((s) => s.kind === "google" && s.enabled);
  const replaced = connected
    ? icalReplacedByGoogle(
        list,
        enabledGoogle.flatMap((s) => (s.google_calendar_id ? [s.google_calendar_id] : [])),
      )
    : new Map<string, string>();
  const googleName = (calendarId: string) =>
    enabledGoogle.find((s) => s.google_calendar_id === calendarId)?.name ?? calendarId;
  const replacedColor = (calendarId: string) => {
    const match = list.find((s) => {
      const id = calendarIdFromIcalUrl(s.url);
      return id !== null && sameCalendarId(id, calendarId);
    });
    return match?.color ?? null;
  };
  return (
    <FoldSection
      id="kalender"
      icon={CalendarDays}
      title="Kalender"
      sub="Google-Konto oder geheime iCal-Adressen – nur für dich sichtbar"
      summary={sources.isPending || google.isPending ? undefined : summaryOf(all, connected)}
      bodyClassName="gap-6"
    >
      <GoogleAccount
        status={google.data}
        statusError={google.isError}
        sources={all}
        replacedColor={replacedColor}
        actions={actions}
      />
      <div className="flex flex-col gap-4">
        <h3 className="text-ui font-medium">iCal-Adressen</h3>
        {sources.isPending ? (
          <Skeleton className="h-24 w-full rounded-card" />
        ) : list.length > 0 ? (
          <ul aria-label="Kalenderquellen" className="flex flex-col gap-2">
            {list.map((source, index) => {
              const by = replaced.get(source.id);
              return (
                <SourceRow
                  key={source.id}
                  source={source}
                  first={index === 0}
                  last={index === list.length - 1}
                  replacedBy={by ? googleName(by) : null}
                  actions={actions}
                />
              );
            })}
          </ul>
        ) : (
          <FieldHint>
            Noch keine iCal-Adresse. Termine erscheinen in Woche, Monat und auf Heute.
          </FieldHint>
        )}
        <AddForm onCreate={(input) => actions.create(input) !== null} />
        <FieldHint>
          {GOOGLE_HELP} Wer die Adresse kennt, kann den Kalender lesen – sie bleibt deshalb im
          Server und fehlt im Export. In Google lässt sie sich jederzeit zurücksetzen.
        </FieldHint>
      </div>
    </FoldSection>
  );
}

function SourceRow({
  source,
  first,
  last,
  replacedBy,
  actions,
}: {
  source: CalendarSourceRow;
  first: boolean;
  last: boolean;
  /** Name des eingeschalteten Google-Kalenders, der diese Adresse ersetzt */
  replacedBy: string | null;
  actions: ReturnType<typeof useCalendarSourceActions>;
}) {
  const [shown, setShown] = useState(false);
  const probe = useProbe();
  const nameId = useId();
  const urlId = useId();
  const enabledId = useId();
  const name = source.name || "Kalender";
  return (
    <li
      data-calendar-id={source.id}
      // ausgeschaltet: gestrichelter Rahmen und gedämpfter Name (keine Transparenz – Kontrast, axe)
      className={cn(
        "flex flex-col gap-2 rounded-card border border-border p-3",
        !source.enabled && "border-dashed",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-36 shrink-0">
          <Select
            aria-label={`Farbe von „${name}“`}
            variant="quiet"
            value={source.color}
            onValueChange={(color) => actions.update(source.id, { color: color as CalendarColor })}
            options={colorOptions}
          />
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <label htmlFor={nameId} className="sr-only">
            Name des Kalenders „{name}“
          </label>
          <BufferedInput
            id={nameId}
            value={source.name}
            maxLength={80}
            onValueChange={(value) => actions.update(source.id, { name: value })}
            className={cn(controlClasses, "h-11 md:h-9", !source.enabled && "text-muted")}
          />
        </div>
        <div className="flex min-h-11 items-center gap-2 md:min-h-9">
          <Checkbox
            id={enabledId}
            aria-label={`Kalender „${name}“ anzeigen`}
            checked={source.enabled}
            onCheckedChange={(checked) => actions.update(source.id, { enabled: checked === true })}
          />
          <label htmlFor={enabledId} className="text-ui-sm text-muted">
            anzeigen
          </label>
        </div>
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`„${name}“ nach oben`}
            disabled={first}
            onClick={() => actions.move(source.id, -1)}
          >
            <ArrowUp size={16} strokeWidth={1.5} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`„${name}“ nach unten`}
            disabled={last}
            onClick={() => actions.move(source.id, 1)}
          >
            <ArrowDown size={16} strokeWidth={1.5} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Kalender „${name}“ in den Papierkorb`}
            onClick={() => actions.trash(source.id)}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor={urlId} className="sr-only">
            Geheime Adresse von „{name}“
          </label>
          <BufferedInput
            id={urlId}
            type={shown ? "url" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={source.url}
            maxLength={2048}
            onValueChange={(value) => {
              probe.reset();
              actions.update(source.id, { url: value });
            }}
            className={cn(controlClasses, "h-11 font-mono text-ui-sm md:h-9")}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={shown}
          aria-label={shown ? "Adresse verbergen" : "Adresse zeigen"}
          onClick={() => setShown(!shown)}
        >
          {shown ? (
            <EyeOff size={16} strokeWidth={1.5} aria-hidden />
          ) : (
            <Eye size={16} strokeWidth={1.5} aria-hidden />
          )}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={probe.state.kind === "busy"}
          onClick={() => void probe.run(source.url)}
        >
          <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
          Probe-Abruf
        </Button>
      </div>
      {replacedBy ? (
        <p data-testid="ical-replaced" className="flex items-start gap-2 text-ui-sm text-muted">
          <Link2 size={14} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            Ersetzt durch Google („{replacedBy}“) – die Termine kommen über das Google-Konto, die
            Adresse bleibt als Rückfall.
          </span>
        </p>
      ) : null}
      <ProbeLine state={probe.state} />
    </li>
  );
}

function AddForm({
  onCreate,
}: {
  onCreate: (input: { name: string; url: string; color: CalendarColor }) => boolean;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState<CalendarColor>(DEFAULT_CALENDAR_COLOR);
  const probe = useProbe();
  const nameId = useId();
  const urlId = useId();
  const colorId = useId();
  const reset = () => {
    setName("");
    setUrl("");
    setColor(DEFAULT_CALENDAR_COLOR);
    probe.reset();
  };
  return (
    <form
      aria-label="Kalender hinzufügen"
      className="flex flex-col gap-3 rounded-card border border-dashed border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (onCreate({ name, url, color })) reset();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <label htmlFor={nameId} className="text-ui-sm font-medium text-muted">
            Name
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="z. B. Beruf"
            className={cn(controlClasses, "mt-1 h-11 md:h-9")}
          />
        </div>
        <div className="w-36 shrink-0">
          <label htmlFor={colorId} className="text-ui-sm font-medium text-muted">
            Farbe
          </label>
          <div className="mt-1">
            <Select
              id={colorId}
              value={color}
              onValueChange={(value) => setColor(value as CalendarColor)}
              options={colorOptions}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor={urlId} className="text-ui-sm font-medium text-muted">
            Geheime Adresse im iCal-Format
          </label>
          <input
            id={urlId}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            maxLength={2048}
            onChange={(event) => {
              setUrl(event.target.value);
              probe.reset();
            }}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            className={cn(controlClasses, "mt-1 h-11 font-mono text-ui-sm md:h-9")}
          />
        </div>
        <Button
          variant="secondary"
          size="md"
          disabled={!url.trim() || probe.state.kind === "busy"}
          onClick={() =>
            void probe.run(url).then((result) => {
              if (result?.ok && result.calendarName && !name.trim()) setName(result.calendarName);
            })
          }
        >
          <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
          Prüfen
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim() || !url.trim()}>
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          Kalender hinzufügen
        </Button>
      </div>
      <ProbeLine state={probe.state} />
    </form>
  );
}
