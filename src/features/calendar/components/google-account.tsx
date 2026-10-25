"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, LogIn, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldHint } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { type CalendarSourceActions, calendarEventsKey } from "../api";
import {
  disconnectGoogle,
  GOOGLE_START_PATH,
  GoogleRequestError,
  googleCalendarsKey,
  googleKey,
  useGoogleCalendars,
} from "../google/client";
import {
  GOOGLE_RETURN_MESSAGES,
  type GoogleCalendarEntry,
  type GoogleReturnCode,
  type GoogleStatus,
  parseGoogleReturnCode,
} from "../google/types";
import {
  CALENDAR_COLOR_LABELS,
  CALENDAR_COLORS,
  type CalendarColor,
  type CalendarSourceRow,
} from "../types";
import { CalendarDot } from "./calendar-dot";

const colorOptions = CALENDAR_COLORS.map((color) => ({
  value: color,
  label: CALENDAR_COLOR_LABELS[color],
  icon: <CalendarDot color={color} />,
}));

/**
 * Rückmeldung nach der Rückkehr von Google (`?google=<code>`): einmal zeigen, dann aus der
 * Adresse nehmen (Neuladen zeigt sie nicht noch einmal; `#kalender` bleibt).
 */
function useReturnNotice() {
  const [code, setCode] = useState<GoogleReturnCode | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const found = parseGoogleReturnCode(url.searchParams.get("google"));
    if (!url.searchParams.has("google")) return;
    url.searchParams.delete("google");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setCode(found);
  }, []);
  return { code, dismiss: () => setCode(null) };
}

function ReturnNotice({ code, onDismiss }: { code: GoogleReturnCode; onDismiss: () => void }) {
  const ok = code === "verbunden";
  return (
    <div
      role={ok ? "status" : "alert"}
      data-testid="google-return"
      className="flex items-start gap-2 text-ui-sm"
    >
      {ok ? (
        <Check size={16} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0 text-success" />
      ) : (
        <AlertTriangle
          size={16}
          strokeWidth={1.5}
          aria-hidden
          className="mt-0.5 shrink-0 text-warning"
        />
      )}
      <span className={cn("min-w-0 flex-1", ok ? "text-fg" : "text-warning")}>
        {GOOGLE_RETURN_MESSAGES[code]}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Hinweis schließen"
        onClick={onDismiss}
        className="-my-2"
      >
        <X size={16} strokeWidth={1.5} aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Einstellungen › Kalender › Google-Konto (#64, N1a): verbinden (nur mit zweitem Faktor, über
 * /api/google/start), „Verbunden als …“ mit Trennen (Rückfrage inline), Hinweis, wenn die Werte
 * in Vercel fehlen. Verbunden: die Kalender aus Googles Kalenderliste an/aus und mit Farbe –
 * als Zeilen `kind = google` in calendar_sources (Speicher-Warteschlange wie die iCal-Quellen).
 */
export function GoogleAccount({
  status,
  statusError,
  sources,
  replacedColor,
  actions,
}: {
  status: GoogleStatus | undefined;
  statusError: boolean;
  sources: CalendarSourceRow[];
  /** Farbe einer iCal-Quelle, die denselben Google-Kalender meint (Vorgabe beim Einschalten) */
  replacedColor: (calendarId: string) => CalendarColor | null;
  actions: CalendarSourceActions;
}) {
  const notice = useReturnNotice();
  const queryClient = useQueryClient();
  const connected = status?.connected === true;
  const calendars = useGoogleCalendars(connected);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const disconnect = async () => {
    setBusy(true);
    try {
      const result = await disconnectGoogle();
      toast(
        result.revoked
          ? "Google getrennt – die App liest wieder über die iCal-Adressen."
          : "Google getrennt. Google hat den Widerruf nicht bestätigt – im Google-Konto unter Sicherheit › Drittanbieter-Zugriff „Triskel“ (früher „Schaltzentrale“) entfernen.",
      );
      queryClient.removeQueries({ queryKey: googleCalendarsKey });
      await queryClient.invalidateQueries({ queryKey: googleKey });
      // Kalender liest danach wieder über iCal (G-5)
      void queryClient.invalidateQueries({ queryKey: calendarEventsKey });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Trennen fehlgeschlagen.");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const reconnect =
    calendars.error instanceof GoogleRequestError && calendars.error.state === "reconnect"
      ? calendars.error
      : null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-ui font-medium">Google-Konto</h3>
      {notice.code ? <ReturnNotice code={notice.code} onDismiss={notice.dismiss} /> : null}
      {status === undefined && !statusError ? (
        <Skeleton className="h-11 w-full rounded-card" />
      ) : statusError ? (
        <FieldHint>Der Stand der Google-Verbindung ließ sich gerade nicht laden.</FieldHint>
      ) : !status?.configured ? (
        <p data-testid="google-not-configured" className="text-ui-sm text-warning">
          {status?.configError ?? "Google-Zugang in Vercel fehlt."} Einrichten: README ›
          „Google-Kalender bearbeiten einrichten“.
        </p>
      ) : !connected ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ui-sm text-muted">
            Verbunden liest die App deine Google-Kalender direkt und kann Termine dort anlegen,
            verschieben und ändern. Google fragt einmal nach der Erlaubnis (Termine, Liste der
            Kalender).
          </p>
          {/* ein Link (volle Seite), kein Formular: die CSP erlaubt Formulare nur zur eigenen Seite */}
          <a href={GOOGLE_START_PATH} className={buttonClasses("primary", "md")}>
            <LogIn size={16} strokeWidth={1.5} aria-hidden />
            Mit Google verbinden
          </a>
        </div>
      ) : (
        <>
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 md:min-h-9">
            <p className="min-w-0 flex-1 basis-56 text-ui-sm" data-testid="google-connected">
              <span className="text-muted">Verbunden als </span>
              <span className="break-all font-medium">{status.email}</span>
            </p>
            {confirm ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-ui-sm text-muted">Google wirklich trennen?</span>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  Trennen
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
                  Abbrechen
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirm(true)}
                aria-label="Google-Konto trennen"
              >
                Trennen
              </Button>
            )}
          </div>
          {calendars.isPending ? (
            <Skeleton className="h-24 w-full rounded-card" />
          ) : reconnect ? (
            <div className="flex flex-col items-start gap-2" data-testid="google-reconnect">
              <p role="alert" className="text-ui-sm text-warning">
                {reconnect.message} Bis dahin liest die App über die iCal-Adressen.
              </p>
              <a href={GOOGLE_START_PATH} className={buttonClasses("secondary", "md")}>
                <LogIn size={16} strokeWidth={1.5} aria-hidden />
                Neu verbinden
              </a>
            </div>
          ) : calendars.isError ? (
            <div className="flex flex-wrap items-center gap-2">
              <FieldHint className="min-w-0 flex-1">{calendars.error.message}</FieldHint>
              <Button size="sm" variant="secondary" onClick={() => void calendars.refetch()}>
                <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
                Noch einmal
              </Button>
            </div>
          ) : (
            <GoogleCalendarList
              calendars={calendars.data}
              sources={sources}
              replacedColor={replacedColor}
              actions={actions}
            />
          )}
        </>
      )}
    </div>
  );
}

function GoogleCalendarList({
  calendars,
  sources,
  replacedColor,
  actions,
}: {
  calendars: GoogleCalendarEntry[];
  sources: CalendarSourceRow[];
  replacedColor: (calendarId: string) => CalendarColor | null;
  actions: CalendarSourceActions;
}) {
  if (calendars.length === 0) {
    return <FieldHint>In der Google-Kalenderliste steht kein Kalender.</FieldHint>;
  }
  const rowOf = (id: string) =>
    sources.find((s) => s.kind === "google" && s.google_calendar_id === id);
  // gewählte Kalender, die Google nicht mehr nennt (gelöscht, abbestellt, ausgeblendet)
  const listed = new Set(calendars.map((c) => c.id));
  const gone = sources.filter(
    (s) => s.kind === "google" && s.google_calendar_id && !listed.has(s.google_calendar_id),
  );
  return (
    <>
      <ul aria-label="Google-Kalender" className="flex flex-col gap-2">
        {calendars.map((calendar) => (
          <GoogleCalendarRow
            key={calendar.id}
            calendar={calendar}
            row={rowOf(calendar.id)}
            defaultColor={replacedColor(calendar.id) ?? calendar.color}
            actions={actions}
          />
        ))}
      </ul>
      {gone.length > 0 ? (
        <ul aria-label="Nicht mehr in Google" className="flex flex-col gap-2">
          {gone.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 rounded-card border border-dashed border-border p-3"
            >
              <CalendarDot color={row.color} />
              <span className="min-w-0 flex-1 truncate text-ui-sm text-muted">
                „{row.name}“ steht nicht mehr in der Google-Kalenderliste
              </span>
              <Button size="sm" variant="ghost" onClick={() => actions.trash(row.id)}>
                In den Papierkorb
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function GoogleCalendarRow({
  calendar,
  row,
  defaultColor,
  actions,
}: {
  calendar: GoogleCalendarEntry;
  row: CalendarSourceRow | undefined;
  defaultColor: CalendarColor;
  actions: CalendarSourceActions;
}) {
  const enabledId = useId();
  const enabled = row?.enabled === true;
  return (
    <li
      data-google-calendar-id={calendar.id}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-border p-3",
        !enabled && "border-dashed",
      )}
    >
      <div className="w-36 shrink-0">
        {row ? (
          <Select
            aria-label={`Farbe von „${calendar.name}“`}
            variant="quiet"
            value={row.color}
            onValueChange={(color) => actions.update(row.id, { color: color as CalendarColor })}
            options={colorOptions}
          />
        ) : (
          <span className="flex h-11 items-center gap-2 px-2 text-ui-sm text-muted md:h-8">
            <CalendarDot color={defaultColor} />
            {CALENDAR_COLOR_LABELS[defaultColor]}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2">
        <span className={cn("min-w-0 break-words text-ui", !enabled && "text-muted")}>
          {calendar.name}
        </span>
        {calendar.primary ? <Pill>Hauptkalender</Pill> : null}
        {calendar.writable ? null : <Pill className="text-muted">In Google nur lesbar</Pill>}
      </div>
      <div className="flex min-h-11 items-center gap-2 md:min-h-9">
        <Checkbox
          id={enabledId}
          aria-label={`Google-Kalender „${calendar.name}“ anzeigen`}
          checked={enabled}
          onCheckedChange={(checked) =>
            actions.setGoogleCalendar(
              { id: calendar.id, name: calendar.name, color: row?.color ?? defaultColor },
              checked === true,
            )
          }
        />
        <label htmlFor={enabledId} className="text-ui-sm text-muted">
          anzeigen
        </label>
      </div>
    </li>
  );
}
