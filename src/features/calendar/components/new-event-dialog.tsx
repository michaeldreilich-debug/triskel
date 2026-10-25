"use client";

/**
 * „Neuer Termin“ (#64, N1c): kleines Fenster mit Titel (Fokus), Kalender, Tag, Beginn, Dauer,
 * ganztägig, Ort und Beschreibung. Enter legt an, Esc bricht ab. Am Desktop ein kleines Fenster in
 * der Mitte, am Handy ein Sheet von unten. Die Kalender-Auswahl bietet nur Kalender mit
 * Schreibrecht an. Angelegt wird über `eventEdit.create` (sofort sichtbar, Rückgängig).
 */
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { controlClasses, FieldError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { berlinTime } from "@/lib/dates";
import {
  draftIssue,
  draftTimes,
  type EventDraft,
  MAX_DESCRIPTION_INPUT,
  MAX_LOCATION,
  type WritableCalendar,
} from "../event-create";
import { formatMinutes, minutesToTime } from "../layout";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480];

export function NewEventDialog({
  draft: initial,
  calendars,
  onCreate,
  onClose,
}: {
  /** Vorbelegung; null = geschlossen */
  draft: EventDraft | null;
  calendars: WritableCalendar[];
  onCreate: (draft: EventDraft, calendar: WritableCalendar) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={initial !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in" />
        <Dialog.Content
          data-testid="new-event"
          className="fixed z-50 flex max-h-[90dvh] flex-col overflow-y-auto border-border bg-surface text-fg shadow-float outline-none max-md:inset-x-0 max-md:bottom-0 max-md:rounded-t-sheet max-md:border-t max-md:pb-[env(safe-area-inset-bottom)] md:inset-x-4 md:top-[8dvh] md:mx-auto md:max-w-md md:rounded-card md:border data-[state=open]:animate-pop-in"
        >
          {initial ? (
            <NewEventForm
              key={`${initial.date}|${initial.time}|${initial.durationMin}|${initial.sourceId}`}
              initial={initial}
              calendars={calendars}
              onCreate={onCreate}
              onClose={onClose}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NewEventForm({
  initial,
  calendars,
  onCreate,
  onClose,
}: {
  initial: EventDraft;
  calendars: WritableCalendar[];
  onCreate: (draft: EventDraft, calendar: WritableCalendar) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EventDraft>(initial);
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<EventDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const issue = draftIssue(draft);
  const calendar = calendars.find((c) => c.sourceId === draft.sourceId) ?? null;
  const durations = useMemo(
    () => [...new Set([...DURATIONS, initial.durationMin])].sort((a, b) => a - b),
    [initial.durationMin],
  );
  const times = draftTimes(draft);
  const endLabel = draft.allDay ? null : berlinTime(times.end);
  const nextDay = !draft.allDay && times.end.slice(0, 10) !== times.start.slice(0, 10);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (issue || !calendar) return;
    onCreate(draft, calendar);
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4" aria-label="Neuer Termin">
      <div className="flex items-center justify-between gap-2">
        <Dialog.Title className="heading text-heading">Neuer Termin</Dialog.Title>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Schließen" type="button">
            <X size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">
        Legt den Termin im gewählten Google-Kalender an.
      </Dialog.Description>

      <div className="flex flex-col gap-1 text-meta text-faint">
        <label htmlFor="new-event-title">Titel</label>
        <Input
          id="new-event-title"
          autoFocus
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Titel des Termins"
          aria-invalid={tried && issue !== null && draft.title.trim() === ""}
          className="text-ui"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-1 text-meta text-faint">
        Kalender
        <Select
          aria-label="Kalender"
          value={draft.sourceId}
          onValueChange={(sourceId) => set({ sourceId })}
          options={calendars.map((c) => ({ value: c.sourceId, label: c.name }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <div className="flex flex-col gap-1 text-meta text-faint">
          Tag
          <DatePicker
            value={draft.date}
            onChange={(date) =>
              date &&
              set({
                date,
                endDate: draft.endDate < date ? date : draft.endDate,
              })
            }
            aria-label="Tag"
            placeholder="Tag wählen"
          />
        </div>
        {draft.allDay ? (
          <div className="flex flex-col gap-1 text-meta text-faint">
            Bis (einschließlich)
            <DatePicker
              value={draft.endDate}
              onChange={(endDate) => endDate && set({ endDate })}
              aria-label="Bis"
              placeholder="Letzter Tag"
            />
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-meta text-faint">
            Beginn
            <input
              type="time"
              step={900}
              value={draft.time}
              onChange={(e) => set({ time: e.target.value })}
              aria-label="Beginn (Uhrzeit)"
              className={`${controlClasses} h-11 tabular-nums md:h-9`}
            />
          </label>
        )}
      </div>

      {!draft.allDay ? (
        <div className="flex flex-col gap-1 text-meta text-faint">
          Dauer
          <select
            value={draft.durationMin}
            onChange={(e) => set({ durationMin: Number(e.target.value) })}
            aria-label="Dauer"
            className={`${controlClasses} h-11 md:h-9`}
          >
            {durations.map((m) => (
              <option key={m} value={m}>
                {formatMinutes(m)}
              </option>
            ))}
          </select>
          <span data-testid="new-event-end" className="text-faint tabular-nums">
            Ende {endLabel}
            {nextDay ? " (am Folgetag)" : ""}
          </span>
        </div>
      ) : null}

      <Checkbox
        id="new-event-allday"
        label="Ganztägig"
        checked={draft.allDay}
        onCheckedChange={(v) =>
          set({
            allDay: v === true,
            endDate: v === true ? draft.date : draft.endDate,
            time: draft.time || minutesToTime(9 * 60),
          })
        }
      />

      <div className="flex flex-col gap-1 text-meta text-faint">
        <label htmlFor="new-event-location">Ort (optional)</label>
        <Input
          id="new-event-location"
          value={draft.location}
          onChange={(e) => set({ location: e.target.value })}
          maxLength={MAX_LOCATION}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-1 text-meta text-faint">
        <label htmlFor="new-event-description">Beschreibung (optional)</label>
        <Textarea
          id="new-event-description"
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={MAX_DESCRIPTION_INPUT}
          rows={3}
        />
      </div>

      {tried && issue ? <FieldError role="alert">{issue}</FieldError> : null}

      <div className="flex justify-end gap-2">
        <Dialog.Close asChild>
          <Button variant="ghost" size="sm" type="button">
            Abbrechen
          </Button>
        </Dialog.Close>
        <Button variant="primary" size="sm" type="submit" disabled={!calendar}>
          Anlegen
        </Button>
      </div>
    </form>
  );
}
