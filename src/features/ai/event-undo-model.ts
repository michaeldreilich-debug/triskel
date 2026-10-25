/**
 * Rückgängig-Daten der KI-Werkzeuge für Google-Termine (#64, N1d) – rein, ohne Server- und
 * Client-Abhängigkeiten: Die Werkzeuge schreiben sie ins KI-Protokoll (`ai_activity.undo`), die
 * App liest und führt sie aus (`event-undo.ts`). Kalender stehen als Google-Kalender-ID (die KI
 * kennt die Quellen der App nicht), die App ordnet sie über `calendar_sources` zu.
 * - `event_create`: Rückgängig = löschen – nur mit dem etag nach dem Anlegen (M-1/K-4: ohne etag
 *   könnte ein gefälschter Eintrag über die App-Route eine ganze Serie löschen; Einträge ohne
 *   etag lassen sich nicht zurückholen)
 * - `event_update`: Rückgängig = zurück in den alten Kalender (`moved_from`), dann die alten Werte
 *   (`before`) zurückschreiben; `etag` ist der Stand direkt nach der KI-Änderung – wurde der
 *   Termin seitdem in Google geändert, lehnt Google ab (Konflikt) statt Neueres zu überschreiben
 * - `event_delete`: Rückgängig = wiederherstellen (derselbe Termin aus Googles Papierkorb, sonst neu)
 */
import { z } from "zod";

const times = z.object({
  allDay: z.boolean(),
  /** ganztägig `JJJJ-MM-TT`, sonst ISO-Zeitpunkt */
  start: z.string().min(8).max(40),
  /** ganztägig `JJJJ-MM-TT` (exklusiv), sonst ISO-Zeitpunkt */
  end: z.string().min(8).max(40),
  timeZone: z.string().max(80).nullable(),
});

const before = z.object({
  summary: z.string().max(20_000).optional(),
  location: z.string().max(20_000).optional(),
  description: z.string().max(100_000).optional(),
  times: times.optional(),
});

const calendarId = z.string().min(1).max(1024);
const eventId = z.string().min(1).max(1024);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("event_create"),
    calendar_id: calendarId,
    event_id: eventId,
    /** Stand direkt nach dem Anlegen (G-7): seitdem geändert → nicht löschen, sondern melden */
    etag: z.string().min(1).max(200),
    date,
  }),
  z.object({
    kind: z.literal("event_update"),
    calendar_id: calendarId,
    event_id: eventId,
    etag: z.string().min(1).max(200),
    before,
    moved_from: calendarId.optional(),
    date,
  }),
  z.object({
    kind: z.literal("event_delete"),
    calendar_id: calendarId,
    event: z.object({
      event_id: eventId,
      summary: z.string().max(20_000),
      location: z.string().max(20_000),
      description: z.string().max(100_000),
      times,
    }),
    date,
  }),
]);

export type EventUndo = z.infer<typeof schema>;
export type EventBefore = z.infer<typeof before>;
export type EventTimesUndo = z.infer<typeof times>;

export const EVENT_UNDO_KINDS = ["event_create", "event_update", "event_delete"] as const;

export function parseEventUndo(value: unknown): EventUndo | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
