/**
 * Eingabe von PATCH /api/kalender/termin (#64, N1b/N1c) prüfen und in Googles Felder übersetzen.
 * Rein: Route und Tests nutzen dasselbe. Geändert werden Zeitfelder (N1b) und Titel, Ort und
 * Beschreibung (N1c) – Gäste, Videokonferenz und alles andere gehören nicht in diese Eingabe.
 */
import { z } from "zod";
import { isValidTimeZone } from "../events";
import type { GoogleTimeField, PatchTimes } from "./events-api";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Längen wie in `normalizeGoogleEvent` (Titel, Ort 300) bzw. großzügig (Beschreibung). */
export const MAX_TITLE_LENGTH = 300;
export const MAX_LOCATION_LENGTH = 300;
export const MAX_DESCRIPTION_LENGTH = 8000;

/** Termin-ID aus Google (auch Serien-Instanzen `…_20261021T070000Z`); nie nur „.“/„..“ (G-3). */
export const EVENT_ID = /^(?!\.{1,2}$)[A-Za-z0-9_.@-]+$/;

export const eventIdSchema = z.string().min(1).max(1024).regex(EVENT_ID);

const BodySchema = z.object({
  sourceId: z.string().uuid(),
  eventId: eventIdSchema,
  etag: z.string().min(1).max(200),
  allDay: z.boolean().optional(),
  /** ganztägig `JJJJ-MM-TT` (Ende exklusiv), sonst Zeitpunkt (ISO) */
  start: z.string().min(8).max(40).optional(),
  end: z.string().min(8).max(40).optional(),
  timeZone: z.string().max(80).nullish(),
  summary: z.string().max(20_000).optional(),
  location: z.string().max(20_000).optional(),
  description: z.string().max(100_000).optional(),
});

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const bad = <T>(error: string): ParseResult<T> => ({ ok: false, error });

/**
 * Zeiten prüfen und in Googles Form bringen. Mit Uhrzeit: UTC-Zeitpunkt, dazu die Zone, wenn sie
 * gültig ist (sonst ohne); ganztägig: nur Tage, Ende exklusiv und nach dem Beginn.
 */
export function parseTimes(
  allDay: boolean,
  start: string,
  end: string,
  timeZone?: string | null,
): ParseResult<PatchTimes> {
  if (allDay) {
    if (!validDate(start) || !validDate(end)) return bad("Datum ungültig.");
    if (end <= start) return bad("Das Ende muss nach dem Beginn liegen.");
    return { ok: true, value: { start: { date: start }, end: { date: end } } };
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return bad("Uhrzeit ungültig.");
  if (endMs <= startMs) return bad("Das Ende muss nach dem Beginn liegen.");
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : undefined;
  const field = (ms: number): GoogleTimeField => ({
    dateTime: new Date(ms).toISOString(),
    ...(zone ? { timeZone: zone } : {}),
  });
  return { ok: true, value: { start: field(startMs), end: field(endMs) } };
}

/** Titel, Ort, Beschreibung: getrimmt (Titel) und gekürzt geprüft; leer = null (Feld leeren). */
export interface TextChanges {
  summary?: string;
  location?: string | null;
  description?: string | null;
}

/** Texte prüfen; `titleRequired`: ein Titel muss da sein (Anlegen) bzw. darf nicht leer werden. */
export function parseTexts(
  input: { summary?: string; location?: string; description?: string },
  titleRequired: boolean,
): ParseResult<TextChanges> {
  const out: TextChanges = {};
  if (input.summary !== undefined || titleRequired) {
    const summary = (input.summary ?? "").trim();
    if (!summary) return bad("Bitte einen Titel eingeben.");
    if (summary.length > MAX_TITLE_LENGTH) {
      return bad(`Der Titel ist zu lang (höchstens ${MAX_TITLE_LENGTH} Zeichen).`);
    }
    out.summary = summary;
  }
  if (input.location !== undefined) {
    const location = input.location.trim();
    if (location.length > MAX_LOCATION_LENGTH) {
      return bad(`Der Ort ist zu lang (höchstens ${MAX_LOCATION_LENGTH} Zeichen).`);
    }
    out.location = location || null;
  }
  if (input.description !== undefined) {
    const description = input.description.replace(/\s+$/u, "");
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return bad(`Die Beschreibung ist zu lang (höchstens ${MAX_DESCRIPTION_LENGTH} Zeichen).`);
    }
    out.description = description.trim() ? description : null;
  }
  return { ok: true, value: out };
}

export interface PatchInput {
  sourceId: string;
  eventId: string;
  etag: string;
  /** neue Zeiten (Verschieben, Dauer) – fehlt, wenn nur Texte geändert werden */
  times?: PatchTimes;
  /** neue Texte – fehlt, wenn nur Zeiten geändert werden */
  text?: TextChanges;
}

export type PatchParse = ParseResult<PatchInput>;

export function parsePatchInput(body: unknown): PatchParse {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return bad("Eingabe unvollständig oder ungültig.");
  const { sourceId, eventId, etag, allDay, start, end, timeZone, ...texts } = parsed.data;
  const value: PatchInput = { sourceId, eventId, etag };

  const anyTime = allDay !== undefined || start !== undefined || end !== undefined;
  if (anyTime) {
    if (allDay === undefined || start === undefined || end === undefined) {
      return bad("Eingabe unvollständig oder ungültig.");
    }
    const times = parseTimes(allDay, start, end, timeZone);
    if (!times.ok) return times;
    value.times = times.value;
  }
  const anyText =
    texts.summary !== undefined || texts.location !== undefined || texts.description !== undefined;
  if (anyText) {
    const text = parseTexts(texts, false);
    if (!text.ok) return text;
    value.text = text.value;
  }
  if (!value.times && !value.text) return bad("Eingabe unvollständig oder ungültig.");
  return { ok: true, value };
}
