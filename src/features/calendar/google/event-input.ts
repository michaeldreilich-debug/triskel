/**
 * Eingaben der Termin-Routen (#64, N1c): Anlegen (POST), Löschen (DELETE), Kalender wechseln
 * (POST …/verschieben-kalender) und Wiederherstellen (POST …/wiederherstellen). Das Ändern steht in
 * `patch-input.ts`. Rein – Routen, Tests und später die KI-Werkzeuge (N1d) nutzen dasselbe.
 */
import { z } from "zod";
import type { PatchTimes } from "./events-api";
import {
  bad,
  eventIdSchema,
  type ParseResult,
  parseTexts,
  parseTimes,
  type TextChanges,
} from "./patch-input";

/** Zone neuer Termine (Europe/Berlin). */
export const DEFAULT_TIME_ZONE = "Europe/Berlin";

const TimesFields = {
  allDay: z.boolean(),
  /** ganztägig `JJJJ-MM-TT` (Ende exklusiv), sonst Zeitpunkt (ISO) */
  start: z.string().min(8).max(40),
  end: z.string().min(8).max(40),
  timeZone: z.string().max(80).nullish(),
};
const TextFields = {
  summary: z.string().max(20_000),
  location: z.string().max(20_000).optional(),
  description: z.string().max(100_000).optional(),
};

/** Alles, was zum Anlegen eines Termins in Google gehört. */
export interface NewGoogleEvent {
  summary: string;
  location: string | null;
  description: string | null;
  times: PatchTimes;
}

function parseEvent(input: {
  allDay: boolean;
  start: string;
  end: string;
  timeZone?: string | null;
  summary: string;
  location?: string;
  description?: string;
}): ParseResult<NewGoogleEvent> {
  const texts = parseTexts(input, true);
  if (!texts.ok) return texts;
  const times = parseTimes(
    input.allDay,
    input.start,
    input.end,
    input.timeZone === undefined ? DEFAULT_TIME_ZONE : input.timeZone,
  );
  if (!times.ok) return times;
  const text = texts.value as Required<Pick<TextChanges, "summary">> & TextChanges;
  return {
    ok: true,
    value: {
      summary: text.summary,
      location: text.location ?? null,
      description: text.description ?? null,
      times: times.value,
    },
  };
}

/* ------------------------------------------------------------------ */

const CreateSchema = z.object({ sourceId: z.string().uuid(), ...TimesFields, ...TextFields });

export interface CreateInput {
  sourceId: string;
  event: NewGoogleEvent;
}

export function parseCreateInput(body: unknown): ParseResult<CreateInput> {
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return bad("Eingabe unvollständig oder ungültig.");
  const { sourceId, ...rest } = parsed.data;
  const event = parseEvent(rest);
  if (!event.ok) return event;
  return { ok: true, value: { sourceId, event: event.value } };
}

/* ------------------------------------------------------------------ */

const DeleteSchema = z.object({
  sourceId: z.string().uuid(),
  eventId: eventIdSchema,
  /** wenn gegeben: nur löschen, solange der Termin unverändert ist (If-Match) */
  etag: z.string().min(1).max(200).optional(),
});

export interface DeleteInput {
  sourceId: string;
  eventId: string;
  etag?: string;
}

export function parseDeleteInput(body: unknown): ParseResult<DeleteInput> {
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) return bad("Eingabe unvollständig oder ungültig.");
  return { ok: true, value: parsed.data };
}

/* ------------------------------------------------------------------ */

const MoveCalendarSchema = z.object({
  sourceId: z.string().uuid(),
  destinationSourceId: z.string().uuid(),
  eventId: eventIdSchema,
  etag: z.string().min(1).max(200),
});

export interface MoveCalendarInput {
  sourceId: string;
  destinationSourceId: string;
  eventId: string;
  etag: string;
}

export function parseMoveCalendarInput(body: unknown): ParseResult<MoveCalendarInput> {
  const parsed = MoveCalendarSchema.safeParse(body);
  if (!parsed.success) return bad("Eingabe unvollständig oder ungültig.");
  if (parsed.data.sourceId === parsed.data.destinationSourceId) {
    return bad("Der Termin liegt schon in diesem Kalender.");
  }
  return { ok: true, value: parsed.data };
}

/* ------------------------------------------------------------------ */

const RestoreSchema = z.object({
  sourceId: z.string().uuid(),
  eventId: eventIdSchema,
  ...TimesFields,
  ...TextFields,
});

export interface RestoreInput {
  sourceId: string;
  /** ID des gelöschten Termins – zuerst wird dieser wiederhergestellt */
  eventId: string;
  /** alle gespeicherten Angaben – für den Fall, dass Google ihn nicht mehr hat: neu anlegen */
  event: NewGoogleEvent;
}

export function parseRestoreInput(body: unknown): ParseResult<RestoreInput> {
  const parsed = RestoreSchema.safeParse(body);
  if (!parsed.success) return bad("Eingabe unvollständig oder ungültig.");
  const { sourceId, eventId, ...rest } = parsed.data;
  const event = parseEvent(rest);
  if (!event.ok) return event;
  return { ok: true, value: { sourceId, eventId, event: event.value } };
}
