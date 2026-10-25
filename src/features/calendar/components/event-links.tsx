"use client";

/**
 * Termine mit Aufgaben und Notizen verknüpfen (#68, Stück 1):
 * - `EventLinksSection` im Termin-Fenster: „Verknüpft“ mit Notizen/Aufgaben, „＋ Notiz zum Termin“
 *   (Typ Protokoll mit seiner Vorlage, Bereich aus der Kalenderfarbe), „＋ Aufgabe“, „Vorhandenes
 *   verknüpfen …“, bei Serien „nur dieses Mal“ ↔ „ganze Serie“ und frühere Protokolle der Serie.
 * - `LinkedEvents` oben in Notiz und Aufgabe: „Termin: Mi, 21.10. 19:00–21:00 · Übungsdienst“, live
 *   aus Google (gelöscht → gestrichelt mit „war: …“), sonst der Schnappschuss; „Lösen“ mit Rückgängig.
 * Lösen entfernt nur die Verknüpfung, nie die Notiz oder Aufgabe.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Circle, FileText, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { AreaColor } from "@/components/ui/pill";
import { type PickerItem, SearchPicker } from "@/components/ui/search-picker";
import { useAreas } from "@/features/areas/api";
import { useNoteActions, useNotes } from "@/features/notes/api";
import { useNoteTypes } from "@/features/notes/note-types";
import { DEFAULT_NOTE_TYPE, noteTitle } from "@/features/notes/types";
import { useTaskActions, useTasks } from "@/features/tasks/api";
import { useTaskPeek } from "@/features/tasks/peek";
import { taskTitle } from "@/features/tasks/types";
import { rememberNoteTemplateOfType } from "@/features/templates/api";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinDate, formatDayShort } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import {
  type EventLinkRow,
  eventWhenLabel,
  type LinkableEvent,
  linkableEvent,
  linksOfEvent,
  linksOfTarget,
  protocolTitle,
} from "../links";
import { type LinkTarget, useEventLinkActions, useEventLinks } from "../links-api";
import type { CalendarColor, CalendarEvent } from "../types";

/** Typ und Vorlage der Notiz zum Termin (Rückmeldung 20.10.: „Protokoll mit Vorlage“) */
const PROTOCOL_TYPE = "protokoll";

/** Kalenderfarbe → Bereich mit derselben Farbe (orange = Beruf, blau = Privat). */
const AREA_COLOR_OF: Partial<Record<CalendarColor, AreaColor>> = { orange: "orange", blau: "blue" };

/** Verknüpfte Notizen und Aufgaben auflösen; was im Papierkorb liegt, fällt weg. */
function useLinkTargets() {
  const notes = useNotes().data ?? [];
  const tasks = useTasks().data ?? [];
  return {
    note: (id: string | null) => (id ? notes.find((n) => n.id === id) : undefined),
    task: (id: string | null) => (id ? tasks.find((t) => t.id === id) : undefined),
    notes,
    tasks,
  };
}

/* ------------------------------------------------------------------ */
/* Zeichen am Termin (Heute, Kalender)                                 */
/* ------------------------------------------------------------------ */

export interface EventLinkCounts {
  notes: number;
  tasks: number;
}

/** Wie viele Notizen und Aufgaben hängen am Termin (ohne Papierkorb)? */
export function useEventLinkCounts(event: CalendarEvent): EventLinkCounts {
  const links = useEventLinks().data ?? [];
  const targets = useLinkTargets();
  const linkable = linkableEvent(event);
  if (!linkable || links.length === 0) return { notes: 0, tasks: 0 };
  const hanging = linksOfEvent(links, linkable);
  return {
    notes: hanging.filter((l) => targets.note(l.note_id)).length,
    tasks: hanging.filter((l) => targets.task(l.task_id)).length,
  };
}

/** „1 Notiz, 2 Aufgaben“ für Bildschirmleser; leer ohne Verknüpfung. */
export function eventLinkCountsLabel({ notes, tasks }: EventLinkCounts): string {
  return [
    notes ? `${notes} ${notes === 1 ? "Notiz" : "Notizen"}` : null,
    tasks ? `${tasks} ${tasks === 1 ? "Aufgabe" : "Aufgaben"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Zeichen am Termin: ausgeschrieben („Notiz · 1 · Aufgabe · 2“, Heute und Liste) oder knapp mit
 * Symbol („📄1 ○2“ als Icons, Zeitraster). Nichts, wenn nichts dranhängt.
 */
export function EventLinkMarks({
  counts,
  compact = false,
  className,
}: {
  counts: EventLinkCounts;
  compact?: boolean;
  className?: string;
}) {
  if (!counts.notes && !counts.tasks) return null;
  if (compact) {
    return (
      <span
        aria-hidden
        data-testid="event-link-marks"
        className={cn("inline-flex shrink-0 items-center gap-1 text-faint", className)}
      >
        {counts.notes ? (
          <span className="inline-flex items-center gap-0.5">
            <FileText size={11} strokeWidth={1.5} />
            {counts.notes}
          </span>
        ) : null}
        {counts.tasks ? (
          <span className="inline-flex items-center gap-0.5">
            <Circle size={10} strokeWidth={1.5} />
            {counts.tasks}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      data-testid="event-link-marks"
      className={cn("shrink-0 text-meta text-faint tabular-nums", className)}
    >
      {[
        counts.notes ? `Notiz · ${counts.notes}` : null,
        counts.tasks ? `Aufgabe · ${counts.tasks}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Im Termin-Fenster                                                   */
/* ------------------------------------------------------------------ */

export function EventLinksSection({ event }: { event: CalendarEvent }) {
  const linkable = linkableEvent(event);
  if (!linkable) return null;
  return <LinkedItems event={event} linkable={linkable} />;
}

function LinkedItems({ event, linkable }: { event: CalendarEvent; linkable: LinkableEvent }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const peek = useTaskPeek();
  const links = useEventLinks();
  const linkActions = useEventLinkActions();
  const noteActions = useNoteActions();
  const taskActions = useTaskActions();
  const noteTypes = useNoteTypes();
  const areas = useAreas().data ?? [];
  const activeArea = useUi((s) => s.area);
  const targets = useLinkTargets();
  const all = links.data ?? [];
  const series = linkable.recurringEventId !== null;

  // Schnappschuss nachziehen, wenn Google den Termin inzwischen anders liefert
  const linkCount = linksOfEvent(all, linkable).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur bei neuen Termindaten
  useEffect(() => {
    if (linkCount > 0) linkActions.refreshSnapshot(linkable);
  }, [linkCount, linkable.title, linkable.start, linkable.end, linkable.allDay]);

  const rows = linksOfEvent(all, linkable)
    .map((link) => ({ link, note: targets.note(link.note_id), task: targets.task(link.task_id) }))
    .filter((r) => r.note || r.task);
  const earlier = series
    ? all
        .filter(
          (l) =>
            !l.deleted_at &&
            l.scope === "occurrence" &&
            l.note_id &&
            l.recurring_event_id === linkable.recurringEventId &&
            l.event_id !== linkable.eventId &&
            l.event_start < linkable.start,
        )
        .sort((a, b) => b.event_start.localeCompare(a.event_start))
        .map((l) => ({ link: l, note: targets.note(l.note_id) }))
        .filter((r) => r.note)
        .slice(0, 3)
    : [];

  const areaId = () => {
    const color = AREA_COLOR_OF[event.color];
    return (
      (color ? areas.find((a) => a.color === color)?.id : undefined) ??
      (areas.some((a) => a.id === activeArea) ? activeArea : null) ??
      areas[0]?.id ??
      null
    );
  };

  const addNote = () => {
    const area = areaId();
    if (!area) return;
    const type = noteTypes.types.some((t) => t.key === PROTOCOL_TYPE)
      ? PROTOCOL_TYPE
      : DEFAULT_NOTE_TYPE;
    const note = noteActions.create({ title: protocolTitle(linkable), area_id: area, type });
    // die Vorlage des Typs greift, sobald die Notiz offen ist (auch wenn die Vorlagen noch laden)
    rememberNoteTemplateOfType(queryClient, note.id, type);
    linkActions.link(linkable, { noteId: note.id });
    router.push(appPath.note(note.id));
  };

  const addTask = () => {
    const area = areaId();
    const task = taskActions.create({ title: "", area_id: area, in_inbox: !area });
    linkActions.link(linkable, { taskId: task.id });
    peek.open(task.id);
  };

  const linkedIds = new Set(rows.map((r) => (r.note ? `n:${r.note.id}` : `t:${r.task?.id}`)));
  const pickerItems: PickerItem[] = [
    ...[...targets.notes]
      .sort((a, b) => b.edited_at.localeCompare(a.edited_at))
      .map((n) => ({
        id: `n:${n.id}`,
        label: noteTitle(n),
        meta: `Notiz · ${noteTypes.name(n.type)}`,
        icon: <FileText size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />,
      })),
    ...targets.tasks
      .filter((t) => t.status !== "erledigt")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((t) => ({
        id: `t:${t.id}`,
        label: taskTitle(t),
        meta: "Aufgabe",
        icon: <Circle size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />,
      })),
  ].filter((item) => !linkedIds.has(item.id));
  const linkExisting = (value: string) => {
    const [kind, id] = [value.slice(0, 1), value.slice(2)];
    linkActions.link(linkable, kind === "n" ? { noteId: id } : { taskId: id });
  };

  return (
    <section
      aria-label="Verknüpft"
      data-testid="event-links"
      className="flex flex-col gap-1.5 border-t border-border pt-2"
    >
      <h4 className="text-meta uppercase tracking-widest text-faint">Verknüpft</h4>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-0.5" aria-label="Verknüpfte Notizen und Aufgaben">
          {rows.map(({ link, note, task }) => {
            const label = note ? noteTitle(note) : taskTitle(task);
            return (
              <li key={link.id} className="flex min-h-9 items-center gap-1.5">
                {note ? (
                  <FileText
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden
                    className="shrink-0 text-faint"
                  />
                ) : task?.status === "erledigt" ? (
                  <CheckCircle2
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden
                    className="shrink-0 text-faint"
                  />
                ) : (
                  <Circle size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
                )}
                <Popover.Close asChild>
                  <Link
                    href={note ? appPath.note(note.id) : peek.hrefFor(task?.id ?? null)}
                    scroll={false}
                    className={cn(
                      "min-w-0 flex-1 truncate text-ui-sm hover:underline",
                      task?.status === "erledigt" && "text-faint line-through",
                    )}
                  >
                    {label}
                  </Link>
                </Popover.Close>
                {series ? (
                  <button
                    type="button"
                    aria-label={`Umfang für „${label}“: ${link.scope === "series" ? "ganze Serie" : "nur dieses Mal"} – umschalten`}
                    onClick={() =>
                      linkActions.setScope(link, link.scope === "series" ? "occurrence" : "series")
                    }
                    className="shrink-0 rounded-control px-1 text-meta text-faint hover:bg-surface-2 hover:text-fg"
                  >
                    {link.scope === "series" ? "ganze Serie" : "nur dieses Mal"}
                  </button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Verknüpfung mit „${label}“ lösen`}
                  title="Verknüpfung lösen (Notiz bzw. Aufgabe bleibt)"
                  onClick={() => linkActions.unlink(link, label)}
                >
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Popover.Close asChild>
          <Button variant="secondary" size="sm" onClick={addNote}>
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Notiz zum Termin
          </Button>
        </Popover.Close>
        <Popover.Close asChild>
          <Button variant="secondary" size="sm" onClick={addTask}>
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Aufgabe
          </Button>
        </Popover.Close>
        <SearchPicker
          variant="button"
          label="Vorhandenes verknüpfen …"
          aria-label="Vorhandene Notiz oder Aufgabe verknüpfen"
          items={pickerItems}
          onSelect={linkExisting}
          searchLabel="Notiz oder Aufgabe suchen"
          placeholder="Notiz oder Aufgabe suchen …"
          emptyText="Keine passende Notiz oder Aufgabe."
          align="end"
        />
      </div>
      {earlier.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <h5 className="text-meta text-faint">Frühere Protokolle dieser Serie</h5>
          {earlier.map(({ link, note }) => (
            <Popover.Close key={link.id} asChild>
              <Link
                href={appPath.note(note?.id ?? "")}
                className="flex min-w-0 items-center gap-1.5 text-ui-sm text-muted hover:underline"
              >
                <span className="shrink-0 tabular-nums text-faint">
                  {formatDayShort(berlinDate(link.event_start))}
                </span>
                <span className="truncate">{noteTitle(note)}</span>
              </Link>
            </Popover.Close>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Kopf in Notiz und Aufgabe                                           */
/* ------------------------------------------------------------------ */

type LinkedStatus =
  | { state: "ok"; event: CalendarEvent }
  | { state: "gone" }
  /** Google nicht verbunden oder nicht erreichbar: Schnappschuss zeigen */
  | { state: "unknown" };

async function fetchLinkedEvent(calendarId: string, eventId: string): Promise<LinkedStatus> {
  const params = new URLSearchParams({ kalender: calendarId, id: eventId });
  const response = await fetch(`/api/kalender/termin?${params}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as {
    event?: CalendarEvent;
    gone?: boolean;
  };
  if (response.ok && body.event) return { state: "ok", event: body.event };
  if (response.status === 404 && body.gone) return { state: "gone" };
  return { state: "unknown" };
}

/** Cache-Schlüssel des einzelnen Termins hinter einem Kopf „Termin: …“ */
export const linkedEventKey = (calendarId: string, eventId: string) =>
  ["termin", calendarId, eventId] as const;

/** Aktueller Stand des Termins aus Google (Serie: die Serie selbst). */
function useLinkedEvent(link: EventLinkRow) {
  const eventId =
    link.scope === "series" && link.recurring_event_id ? link.recurring_event_id : link.event_id;
  return useQuery({
    // nicht unter „calendar“: dessen Cache-Helfer erwarten dort nur Zeiträume mit `events`
    queryKey: linkedEventKey(link.google_calendar_id, eventId),
    queryFn: () => fetchLinkedEvent(link.google_calendar_id, eventId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function LinkedEvents({ target }: { target: LinkTarget }) {
  const links = useEventLinks();
  const list = linksOfTarget(links.data ?? [], target);
  if (list.length === 0) return null;
  return (
    <ul aria-label="Verknüpfte Termine" className="flex flex-col gap-1">
      {list.map((link) => (
        <LinkedEventRow key={link.id} link={link} />
      ))}
    </ul>
  );
}

function LinkedEventRow({ link }: { link: EventLinkRow }) {
  const actions = useEventLinkActions();
  const status = useLinkedEvent(link).data;
  const live = status?.state === "ok" && link.scope === "occurrence" ? status.event : null;
  const gone = status?.state === "gone";
  const liveLinkable = live ? linkableEvent(live) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: nur bei neuen Termindaten
  useEffect(() => {
    if (liveLinkable) actions.refreshSnapshot(liveLinkable);
  }, [liveLinkable?.title, liveLinkable?.start, liveLinkable?.end, liveLinkable?.allDay]);

  const title = live?.title ?? link.event_title ?? "Termin";
  const when = live
    ? eventWhenLabel(live.start, live.end, live.allDay)
    : eventWhenLabel(link.event_start, link.event_end, link.event_all_day);
  const day = berlinDate(live?.start ?? link.event_start);
  const href = `${appPath.calendar(day, "tag")}&termin=${encodeURIComponent(link.event_id)}`;
  const label = `${when} · ${title.trim() || "Termin"}`;

  return (
    <li
      data-testid="linked-event"
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-control border border-border px-2.5 py-1 text-ui-sm md:min-h-9",
        gone && "border-dashed text-faint",
      )}
    >
      <CalendarDays size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
      <span className="flex min-w-0 flex-1 flex-col">
        {gone ? (
          <>
            <span className="truncate">Termin in Google nicht mehr gefunden</span>
            <span className="truncate text-meta">war: {label}</span>
          </>
        ) : (
          <Link href={href} className="truncate hover:underline" title="Im Kalender öffnen">
            <span className="text-faint">Termin: </span>
            {label}
            {link.scope === "series" ? <span className="text-faint"> · ganze Serie</span> : null}
          </Link>
        )}
        {status?.state === "unknown" ? (
          <span className="truncate text-meta text-faint">
            Stand vom {formatDayShort(berlinDate(link.updated_at))} – Google gerade nicht erreichbar
          </span>
        ) : null}
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Verknüpfung mit Termin „${title}“ lösen`}
        onClick={() => actions.unlink(link, title)}
      >
        Lösen
      </Button>
    </li>
  );
}
