"use client";

/**
 * Gemeinsamer Zustand der Kalender-Bausteine (S2b): Aufgaben-Kontext, heutiger Tag, Verschieben
 * mit Rückgängig, „Datum wählen …“ und Anlegen in einen Tag. Heute (S2c) und die Datenbank-Ansicht
 * legen denselben Provider um ihre Bausteine.
 */
import { CalendarDays, CalendarX2, Clock3, MoveRight } from "lucide-react";
import { Dialog } from "radix-ui";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from "@/components/ui/menu";
import { useTaskActions } from "@/features/tasks/api";
import type { TaskContext } from "@/features/tasks/components/task-item";
import { type TaskRow, taskTitle } from "@/features/tasks/types";
import { berlinDateTime, berlinMinutes, type IsoDate } from "@/lib/dates";
import {
  dayDraft,
  defaultCalendar,
  type EventDraft,
  gridDraft,
  type WritableCalendar,
} from "../event-create";
import { type CalendarEventEdit, useCalendarEventEdit } from "../event-edit";
import { type CalendarEventMove, useCalendarEventMove } from "../event-move";
import { type CalendarMove, moveTargets, useCalendarMove } from "../hooks";
import { minutesToTime } from "../layout";
import { NewEventDialog } from "./new-event-dialog";

/** Zuletzt benutzter Kalender für neue Termine – je Gerät, nur Bequemlichkeit. */
const LAST_CALENDAR_KEY = "sz:termin-kalender";
function readLastCalendar(): string | null {
  try {
    return window.localStorage.getItem(LAST_CALENDAR_KEY);
  } catch {
    return null;
  }
}
function rememberCalendar(sourceId: string) {
  try {
    window.localStorage.setItem(LAST_CALENDAR_KEY, sourceId);
  } catch {
    // nur Bequemlichkeit
  }
}

/** Was „Neuer Termin“ vorbelegt: ein Tag, optional Raster-Zeile(n) (Klick bzw. Ziehen in Minuten). */
export interface NewEventRequest {
  date: IsoDate;
  /** Klick/Drücken im Raster (Minuten seit Mitternacht); ohne: nächste volle Stunde bzw. 9 Uhr */
  press?: number;
  /** Loslassen nach dem Ziehen; null/fehlt = Klick (1 h) */
  release?: number | null;
}

export interface CalendarContextValue {
  ctx: TaskContext;
  today: IsoDate;
  move: CalendarMove;
  /** Google-Termine verschieben und verlängern (N1b), immer mit Rückgängig */
  eventMove: CalendarEventMove;
  /** „Datum wählen …“ für eine Aufgabe öffnen */
  pickDate: (task: TaskRow) => void;
  /** Aufgabe für einen Tag (und ggf. eine Uhrzeit) anlegen; liefert die neue Aufgabe */
  createOn: (date: IsoDate, minutes?: number | null, title?: string) => TaskRow;
  /** Termine in Google anlegen, Texte ändern, Kalender wechseln, löschen (N1c), immer mit Rückgängig */
  eventEdit: CalendarEventEdit;
  /** Kalender mit Schreibrecht – leer: Termine lassen sich hier nicht anlegen */
  calendars: WritableCalendar[];
  /** „Neuer Termin“ öffnen (nur sinnvoll, wenn `calendars` nicht leer ist) */
  openNewEvent: (request: NewEventRequest) => void;
  /** gewählter Bereich (für neue Aufgaben) */
  area: string | null;
  /** gewähltes Projekt (Filter; neue Aufgaben gehören dann dazu) */
  projectId: string | null;
}

const NO_CALENDARS: WritableCalendar[] = [];

const Ctx = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useCalendar außerhalb von CalendarProvider");
  return value;
}

export function CalendarProvider({
  ctx,
  today,
  area,
  projectId,
  calendars = NO_CALENDARS,
  children,
}: {
  ctx: TaskContext;
  today: IsoDate;
  area: string | null;
  projectId: string | null;
  /** Kalender mit Schreibrecht (aus dem Status der Quellen); ohne: kein „Neuer Termin“ */
  calendars?: WritableCalendar[];
  children: React.ReactNode;
}) {
  const move = useCalendarMove();
  const eventMove = useCalendarEventMove();
  const eventEdit = useCalendarEventEdit();
  const [newEvent, setNewEvent] = useState<EventDraft | null>(null);
  const openNewEvent = useCallback(
    (request: NewEventRequest) => {
      const calendar = defaultCalendar(calendars, readLastCalendar());
      if (!calendar) return;
      setNewEvent(
        request.press === undefined
          ? dayDraft(calendar.sourceId, request.date, today, berlinMinutes())
          : gridDraft(calendar.sourceId, request.date, request.press, request.release ?? null),
      );
    },
    [calendars, today],
  );
  const actions = useTaskActions();
  const [picking, setPicking] = useState<TaskRow | null>(null);
  const [date, setDate] = useState<IsoDate | null>(null);
  const pickDate = useCallback(
    (task: TaskRow) => {
      setPicking(task);
      setDate(task.due_date ?? today);
    },
    [today],
  );
  const createOn = useCallback(
    (day: IsoDate, minutes?: number | null, title = "") =>
      actions.create({
        title,
        area_id: area,
        project_id: projectId,
        in_inbox: !area && !projectId,
        due_date: day,
        scheduled_at:
          minutes === null || minutes === undefined
            ? null
            : berlinDateTime(day, minutesToTime(minutes)),
      }),
    [actions, area, projectId],
  );
  const value = useMemo<CalendarContextValue>(
    () => ({
      ctx,
      today,
      move,
      eventMove,
      eventEdit,
      calendars,
      openNewEvent,
      pickDate,
      createOn,
      area,
      projectId,
    }),
    [
      ctx,
      today,
      move,
      eventMove,
      eventEdit,
      calendars,
      openNewEvent,
      pickDate,
      createOn,
      area,
      projectId,
    ],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <NewEventDialog
        draft={newEvent}
        calendars={calendars}
        onClose={() => setNewEvent(null)}
        onCreate={(draft, calendar) => {
          rememberCalendar(calendar.sourceId);
          eventEdit.create(draft, calendar);
        }}
      />
      <Dialog.Root open={picking !== null} onOpenChange={(open) => !open && setPicking(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in" />
          <Dialog.Content className="fixed inset-x-4 top-[20dvh] z-50 mx-auto flex max-w-sm flex-col gap-4 rounded-card border border-border bg-surface p-4 text-fg shadow-float outline-none data-[state=open]:animate-pop-in">
            <Dialog.Title className="heading text-heading">Verschieben auf …</Dialog.Title>
            <Dialog.Description className="text-ui-sm text-muted">
              {picking ? `„${taskTitle(picking)}“ bekommt dieses Datum als Fälligkeit.` : ""}
            </Dialog.Description>
            <DatePicker
              value={date}
              onChange={setDate}
              aria-label="Neues Datum"
              placeholder="Datum wählen"
            />
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">
                  Abbrechen
                </Button>
              </Dialog.Close>
              <Button
                variant="primary"
                size="sm"
                disabled={!date}
                onClick={() => {
                  if (picking && date) move.moveToDay(picking, date);
                  setPicking(null);
                }}
              >
                Verschieben
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}

/**
 * „Verschieben auf …“ für Rechtsklick (ContextMenu, als Untermenü) und den ⋯-Knopf (DropdownMenu,
 * flach – Untermenüs sind am Handy unzuverlässig): dieselben Ziele: heute, morgen, nächster Montag,
 * in einer Woche, Datum wählen, ohne Uhrzeit, ohne Datum.
 */
export function MoveMenu({ task, kind }: { task: TaskRow; kind: "context" | "dropdown" }) {
  const { today, move, pickDate } = useCalendar();
  const targets = moveTargets(today);
  const Item = kind === "context" ? ContextMenuItem : MenuItem;
  const Separator = kind === "context" ? ContextMenuSeparator : MenuSeparator;
  const items = (
    <>
      {targets.map((t) => (
        <Item key={t.id} onSelect={() => move.moveToDay(task, t.date)}>
          {kind === "dropdown" ? <MoveRight aria-hidden /> : null}
          {t.label}
        </Item>
      ))}
      <Item onSelect={() => pickDate(task)}>
        <CalendarDays aria-hidden />
        Datum wählen …
      </Item>
      <Separator />
      {task.scheduled_at ? (
        <Item onSelect={() => move.clearTime(task)}>
          <Clock3 aria-hidden />
          Ohne Uhrzeit
        </Item>
      ) : null}
      <Item onSelect={() => move.unschedule(task)}>
        <CalendarX2 aria-hidden />
        Datum entfernen
      </Item>
    </>
  );
  if (kind === "dropdown") {
    return (
      <>
        <MenuSeparator />
        <MenuLabel>Verschieben auf …</MenuLabel>
        {items}
        <MenuSeparator />
      </>
    );
  }
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <MoveRight aria-hidden />
        Verschieben auf …
      </ContextMenuSubTrigger>
      <ContextMenuSubContent aria-label="Verschieben auf">{items}</ContextMenuSubContent>
    </ContextMenuSub>
  );
}
