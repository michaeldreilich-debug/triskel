import { describe, expect, it } from "vitest";
import {
  parseCreateInput,
  parseDeleteInput,
  parseMoveCalendarInput,
  parseRestoreInput,
} from "./event-input";

const SOURCE = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const timed = {
  allDay: false,
  start: "2026-12-09T08:00:00.000Z",
  end: "2026-12-09T09:00:00.000Z",
};

describe("Anlegen (POST /api/kalender/termin)", () => {
  it("Termin mit Uhrzeit: Titel getrimmt, Zone Europe/Berlin als Standard, leere Felder null", () => {
    const result = parseCreateInput({ sourceId: SOURCE, summary: "  Zahnarzt ", ...timed });
    expect(result).toEqual({
      ok: true,
      value: {
        sourceId: SOURCE,
        event: {
          summary: "Zahnarzt",
          location: null,
          description: null,
          times: {
            start: { dateTime: "2026-12-09T08:00:00.000Z", timeZone: "Europe/Berlin" },
            end: { dateTime: "2026-12-09T09:00:00.000Z", timeZone: "Europe/Berlin" },
          },
        },
      },
    });
  });

  it("mit Ort und Beschreibung; eine ungültige Zone entfällt", () => {
    const result = parseCreateInput({
      sourceId: SOURCE,
      summary: "Treffen",
      location: " Rathaus ",
      description: "Unterlagen mitbringen",
      timeZone: "Nirgendwo/Land",
      ...timed,
    });
    expect(result.ok && result.value.event).toMatchObject({
      location: "Rathaus",
      description: "Unterlagen mitbringen",
      times: { start: { dateTime: "2026-12-09T08:00:00.000Z" } },
    });
    expect(result.ok && result.value.event.times.start).not.toHaveProperty("timeZone");
  });

  it("ganztägig: nur Tage, Ende exklusiv und nach dem Beginn", () => {
    expect(
      parseCreateInput({
        sourceId: SOURCE,
        summary: "Urlaub",
        allDay: true,
        start: "2026-12-24",
        end: "2026-12-27",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        event: { times: { start: { date: "2026-12-24" }, end: { date: "2026-12-27" } } },
      },
    });
    for (const [start, end] of [
      ["2026-12-24", "2026-12-24"],
      ["2026-12-24T10:00:00Z", "2026-12-25"],
      ["2026-13-45", "2026-14-01"],
    ]) {
      expect(
        parseCreateInput({ sourceId: SOURCE, summary: "x", allDay: true, start, end }).ok,
      ).toBe(false);
    }
  });

  it("Titel Pflicht (nicht nur Leerzeichen), höchstens 300 Zeichen", () => {
    expect(parseCreateInput({ sourceId: SOURCE, summary: "  ", ...timed })).toEqual({
      ok: false,
      error: "Bitte einen Titel eingeben.",
    });
    expect(parseCreateInput({ sourceId: SOURCE, ...timed }).ok).toBe(false);
    expect(parseCreateInput({ sourceId: SOURCE, summary: "x".repeat(300), ...timed }).ok).toBe(
      true,
    );
    expect(parseCreateInput({ sourceId: SOURCE, summary: "x".repeat(301), ...timed }).ok).toBe(
      false,
    );
  });

  it("lehnt Ende vor Beginn, Unsinn-Zeiten und fremde Kalender-IDs ab", () => {
    expect(
      parseCreateInput({ sourceId: SOURCE, summary: "x", ...timed, end: timed.start }).ok,
    ).toBe(false);
    expect(
      parseCreateInput({ sourceId: SOURCE, summary: "x", ...timed, start: "gestern" }).ok,
    ).toBe(false);
    expect(parseCreateInput({ sourceId: "primary", summary: "x", ...timed }).ok).toBe(false);
    expect(parseCreateInput({ sourceId: "../calendarList", summary: "x", ...timed }).ok).toBe(
      false,
    );
    expect(parseCreateInput(null).ok).toBe(false);
  });

  it("Gäste, Videokonferenz und andere Felder kommen nie durch", () => {
    const result = parseCreateInput({
      sourceId: SOURCE,
      summary: "x",
      ...timed,
      attendees: [{ email: "gast@example.com" }],
      conferenceData: { createRequest: {} },
      recurrence: ["RRULE:FREQ=DAILY"],
    });
    expect(result.ok && Object.keys(result.value.event).sort()).toEqual([
      "description",
      "location",
      "summary",
      "times",
    ]);
    expect(JSON.stringify(result)).not.toContain("gast@example.com");
    expect(JSON.stringify(result)).not.toContain("RRULE");
  });
});

describe("Löschen (DELETE /api/kalender/termin)", () => {
  it("Quelle und Termin-ID, etag optional", () => {
    expect(parseDeleteInput({ sourceId: SOURCE, eventId: "abc_20261021T070000Z" })).toEqual({
      ok: true,
      value: { sourceId: SOURCE, eventId: "abc_20261021T070000Z" },
    });
    expect(parseDeleteInput({ sourceId: SOURCE, eventId: "abc", etag: '"1"' }).ok).toBe(true);
  });

  it("lehnt Pfad-Tricks und fehlende Angaben ab", () => {
    expect(parseDeleteInput({ sourceId: SOURCE, eventId: "../x" }).ok).toBe(false);
    expect(parseDeleteInput({ sourceId: SOURCE, eventId: "a/b" }).ok).toBe(false);
    expect(parseDeleteInput({ sourceId: SOURCE }).ok).toBe(false);
    expect(parseDeleteInput({ eventId: "abc" }).ok).toBe(false);
    expect(parseDeleteInput({ sourceId: SOURCE, eventId: "abc", etag: "" }).ok).toBe(false);
  });
});

describe("Kalender wechseln", () => {
  const ok = { sourceId: SOURCE, destinationSourceId: OTHER, eventId: "abc", etag: '"1"' };
  it("beide Quellen, Termin und etag", () => {
    expect(parseMoveCalendarInput(ok)).toEqual({ ok: true, value: ok });
  });
  it("derselbe Kalender, fehlendes etag, keine UUID: abgelehnt", () => {
    expect(parseMoveCalendarInput({ ...ok, destinationSourceId: SOURCE }).ok).toBe(false);
    expect(parseMoveCalendarInput({ ...ok, etag: undefined }).ok).toBe(false);
    expect(parseMoveCalendarInput({ ...ok, destinationSourceId: "primary" }).ok).toBe(false);
    expect(parseMoveCalendarInput({ ...ok, eventId: "a b" }).ok).toBe(false);
  });
});

describe("Wiederherstellen", () => {
  it("alle Angaben für den Neuanlegen-Fall: Titel, Ort, Beschreibung, Zeiten, Zone", () => {
    const result = parseRestoreInput({
      sourceId: SOURCE,
      eventId: "abc123",
      summary: "Zahnarzt",
      location: "Praxis",
      description: "Kärtchen mitnehmen",
      timeZone: "Europe/Berlin",
      ...timed,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        sourceId: SOURCE,
        eventId: "abc123",
        event: {
          summary: "Zahnarzt",
          location: "Praxis",
          description: "Kärtchen mitnehmen",
          times: {
            start: { dateTime: "2026-12-09T08:00:00.000Z", timeZone: "Europe/Berlin" },
            end: { dateTime: "2026-12-09T09:00:00.000Z", timeZone: "Europe/Berlin" },
          },
        },
      },
    });
  });
  it("ohne Titel oder mit ungültiger Zeit: abgelehnt", () => {
    expect(parseRestoreInput({ sourceId: SOURCE, eventId: "abc", summary: "", ...timed }).ok).toBe(
      false,
    );
    expect(
      parseRestoreInput({ sourceId: SOURCE, eventId: "abc", summary: "x", ...timed, end: "?" }).ok,
    ).toBe(false);
    expect(parseRestoreInput({ sourceId: SOURCE, summary: "x", ...timed }).ok).toBe(false);
  });
});
