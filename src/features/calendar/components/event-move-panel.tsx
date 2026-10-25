"use client";

/**
 * „Verschieben auf …“ im Termin-Fenster (#64, N1b) – der Weg ohne Maus und am Handy: Tag (heute,
 * morgen, nächster Montag, in einer Woche, Datum wählen) sowie Uhrzeit und Dauer, jeweils mit
 * Rückgängig (`eventMove`). Für Termine, die man nicht ändern darf, steht hier der Grund.
 */
import { Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { controlClasses } from "@/components/ui/input";
import { appPath } from "@/lib/app-links";
import { berlinTime, type IsoDate } from "@/lib/dates";
import { moveTargets } from "../hooks";
import { formatMinutes } from "../layout";
import { eventDurationMin, isMovable } from "../move";
import type { CalendarEvent } from "../types";
import { useCalendar } from "./calendar-context";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const TARGET_LABELS: Record<string, string> = {
  heute: "Heute",
  morgen: "Morgen",
  montag: "Nächster Montag",
  woche: "In einer Woche",
};

/** Hinweis, warum ein Termin fest bleibt – leer, wenn er sich ändern lässt. */
export function eventFixedReason(event: CalendarEvent): string | null {
  if (!event.google) {
    return "Über die iCal-Adresse nur lesbar. Zum Verschieben Google verbinden (Einstellungen › Kalender).";
  }
  if (!event.google.editable) return "In Google nur lesbar.";
  if (!isMovable(event)) {
    return "Termine über mehrere Tage mit Uhrzeit lassen sich nur in Google verschieben.";
  }
  return null;
}

export function EventMovePanel({ event }: { event: CalendarEvent }) {
  const { today, eventMove } = useCalendar();
  const reason = eventFixedReason(event);
  const minutes = eventDurationMin(event);
  const [time, setTime] = useState(event.allDay ? "" : berlinTime(event.start));
  const [duration, setDuration] = useState(minutes ?? 60);

  if (reason) {
    return (
      <p
        data-testid="event-fixed"
        className="flex items-start gap-1.5 border-t border-border pt-2 text-meta text-faint"
      >
        <Lock size={12} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />
        <span>
          {reason}
          {!event.google ? (
            <>
              {" "}
              <Link href={appPath.settings("kalender")} className="text-link hover:underline">
                Zu den Einstellungen
              </Link>
            </>
          ) : null}
        </span>
      </p>
    );
  }

  const targets = moveTargets(today).filter((t) => t.date !== event.date);
  const durations = [...new Set([...DURATIONS, duration])].sort((a, b) => a - b);
  const changed = !event.allDay && (time !== berlinTime(event.start) || duration !== minutes);
  const move = (date: IsoDate) => eventMove.moveToDay(event, date);

  return (
    <section
      aria-label="Termin verschieben"
      data-testid="event-move"
      className="flex flex-col gap-2 border-t border-border pt-2"
    >
      <h4 className="text-meta uppercase tracking-widest text-faint">Verschieben auf …</h4>
      <div className="flex flex-wrap gap-1.5">
        {targets.map((t) => (
          <Button key={t.id} variant="secondary" size="sm" onClick={() => move(t.date)}>
            {TARGET_LABELS[t.id] ?? t.label}
          </Button>
        ))}
      </div>
      <DatePicker
        value={event.date}
        onChange={(date) => date && date !== event.date && move(date)}
        aria-label="Anderes Datum wählen"
        placeholder="Datum wählen"
      />
      {!event.allDay ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-meta text-faint">
              Beginn
              <input
                type="time"
                step={900}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-label="Beginn (Uhrzeit)"
                className={`${controlClasses} h-11 tabular-nums md:h-9`}
              />
            </label>
            <label className="flex flex-col gap-1 text-meta text-faint">
              Dauer
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                aria-label="Dauer"
                className={`${controlClasses} h-11 md:h-9`}
              >
                {durations.map((m) => (
                  <option key={m} value={m}>
                    {formatMinutes(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={!changed || !time}
            onClick={() => eventMove.setSchedule(event, time, duration)}
          >
            Uhrzeit übernehmen
          </Button>
        </div>
      ) : null}
      {event.google?.recurringEventId ? (
        <p className="text-meta text-faint">Wiederholt sich – verschoben wird nur dieser Termin.</p>
      ) : null}
    </section>
  );
}
