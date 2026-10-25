"use client";

/**
 * Termin bearbeiten im Termin-Fenster (#64, N1c) – nur für änderbare Google-Termine: Titel, Ort und
 * Beschreibung direkt ändern (gespeichert beim Verlassen des Feldes bzw. mit Enter; Esc schließt das Fenster, ohne ein getipptes,
 * noch nicht verlassenes Feld zu speichern;
 * jede Änderung mit Rückgängig), Kalender wechseln und Löschen. Gäste und Videokonferenz bleiben
 * in Google. Zu lang gekürzt gelesene Texte sind gesperrt („in Google ändern“), damit beim
 * Speichern nichts verloren geht.
 */
import { MapPin, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, quietControlClasses, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { type EventTexts, lockedTexts, MAX_LOCATION } from "../event-create";
import type { CalendarEvent } from "../types";
import { useCalendar } from "./calendar-context";
import { CalendarDot } from "./calendar-dot";

const FIELD = cn(quietControlClasses, "w-full border-border/0 hover:border-border");

/**
 * Feld, das beim Verlassen (und bei Enter, außer im mehrzeiligen) speichert; solange man tippt,
 * gilt der eigene Text, sonst der Wert aus der Ansicht (der nach dem Speichern sofort nachzieht).
 */
function CommitField({
  value,
  label,
  multiline,
  disabled,
  maxLength,
  onCommit,
  className,
}: {
  value: string;
  label: string;
  multiline?: boolean;
  disabled?: boolean;
  maxLength?: number;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  // der Text im Eingabefeld, bis er gespeichert oder verworfen ist – ein zweites Verlassen des
  // Feldes (Enter, dann Fokuswechsel des Fensters) speichert nie doppelt
  const pending = useRef<string | null>(null);
  const commit = () => {
    const text = pending.current;
    pending.current = null;
    if (text !== null && text !== value) onCommit(text);
  };
  const common = {
    value: shown,
    "aria-label": label,
    disabled,
    maxLength,
    onFocus: () => setDraft((d) => d ?? value),
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      pending.current = e.target.value;
      setDraft(e.target.value);
    },
    onBlur: () => {
      commit();
      setDraft(null);
    },
  };
  if (multiline) {
    return (
      <Textarea
        {...common}
        rows={3}
        placeholder={label}
        className={cn(FIELD, "min-h-16 max-h-40 py-1.5 text-ui-sm", className)}
      />
    );
  }
  return (
    <Input
      {...common}
      placeholder={label}
      autoComplete="off"
      className={cn(FIELD, className)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          setDraft(null);
          e.currentTarget.blur();
        } else if (e.key === "Escape" && draft !== null) {
          // nur das Feld zurücksetzen, das Fenster bleibt offen
          e.stopPropagation();
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function EventEditFields({ event }: { event: CalendarEvent }) {
  const { eventEdit, calendars } = useCalendar();
  const locked = lockedTexts(event);
  const series = event.google?.recurringEventId !== null;
  const save = (next: Partial<EventTexts>) => eventEdit.updateTexts(event, next);
  const current = calendars.find((c) => c.sourceId === event.sourceId);
  const choices = calendars.filter((c) => c.sourceId !== event.sourceId);

  return (
    <div className="flex flex-col gap-2" data-testid="event-edit">
      <div className="flex items-center gap-2">
        <CalendarDot color={event.color} className="shrink-0" />
        <CommitField
          label="Titel"
          value={event.title}
          maxLength={300}
          disabled={locked.includes("summary")}
          onCommit={(summary) => save({ summary })}
          className="heading text-body-lg/snug font-medium"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <MapPin size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
        <CommitField
          label="Ort"
          value={event.location ?? ""}
          maxLength={MAX_LOCATION}
          disabled={locked.includes("location")}
          onCommit={(location) => save({ location })}
          className="text-ui-sm"
        />
      </div>
      <CommitField
        label="Beschreibung"
        multiline
        value={event.description ?? ""}
        disabled={locked.includes("description")}
        onCommit={(description) => save({ description })}
      />
      {locked.length > 0 ? (
        <p className="text-meta text-faint">
          Sehr lange Texte lassen sich nur in Google ändern („In Google öffnen“).
        </p>
      ) : null}

      {!series && current && choices.length > 0 ? (
        <div className="flex flex-col gap-1 text-meta text-faint">
          Kalender
          <Select
            aria-label="Kalender wechseln"
            value={current.sourceId}
            onValueChange={(sourceId) => {
              const to = calendars.find((c) => c.sourceId === sourceId);
              if (to) eventEdit.changeCalendar(event, to);
            }}
            options={calendars.map((c) => ({ value: c.sourceId, label: c.name }))}
          />
        </div>
      ) : null}
      {series ? (
        <p className="text-meta text-faint">
          Wiederholt sich – Änderungen und Löschen betreffen nur diesen Termin; den Kalender einer
          Serie wechselst du in Google.
        </p>
      ) : null}
    </div>
  );
}

/** „Löschen“ im Termin-Fenster (bei Serien nur diese Instanz – der Text sagt es); Rückgängig im Toast. */
export function EventDeleteButton({ event }: { event: CalendarEvent }) {
  const { eventEdit } = useCalendar();
  const series = event.google?.recurringEventId !== null;
  return (
    <Button
      variant="danger"
      size="sm"
      className="self-start"
      data-testid="event-delete"
      onClick={() => eventEdit.remove(event)}
    >
      <Trash2 size={14} strokeWidth={1.5} aria-hidden />
      {series ? "Nur diesen Termin löschen" : "Löschen"}
    </Button>
  );
}
