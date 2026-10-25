import { describe, expect, it } from "vitest";
import { parsePatchInput } from "./patch-input";

const ok = {
  sourceId: "00000000-0000-4000-8000-000000000001",
  eventId: "abc_20261021T070000Z",
  etag: '"123"',
};

describe("Eingabe für PATCH /api/kalender/termin", () => {
  it("Termin mit Uhrzeit: Zeitpunkte als UTC, Zone wird mitgegeben", () => {
    const result = parsePatchInput({
      ...ok,
      allDay: false,
      start: "2026-10-21T08:15:00.000Z",
      end: "2026-10-21T09:15:00Z",
      timeZone: "Europe/Berlin",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        ...ok,
        times: {
          start: { dateTime: "2026-10-21T08:15:00.000Z", timeZone: "Europe/Berlin" },
          end: { dateTime: "2026-10-21T09:15:00.000Z", timeZone: "Europe/Berlin" },
        },
      },
    });
  });

  it("ohne oder mit ungültiger Zone: ohne timeZone", () => {
    for (const timeZone of [undefined, null, "Nirgendwo/Land"]) {
      const result = parsePatchInput({
        ...ok,
        allDay: false,
        start: "2026-10-21T08:00:00Z",
        end: "2026-10-21T09:00:00Z",
        timeZone,
      });
      expect(result.ok && result.value.times?.start).toEqual({
        dateTime: "2026-10-21T08:00:00.000Z",
      });
    }
  });

  it("ganztägig: nur Tage, Ende exklusiv und nach dem Beginn", () => {
    expect(
      parsePatchInput({ ...ok, allDay: true, start: "2026-10-22", end: "2026-10-23" }),
    ).toMatchObject({
      ok: true,
      value: { times: { start: { date: "2026-10-22" }, end: { date: "2026-10-23" } } },
    });
    expect(
      parsePatchInput({ ...ok, allDay: true, start: "2026-10-22", end: "2026-10-22" }).ok,
    ).toBe(false);
    expect(
      parsePatchInput({ ...ok, allDay: true, start: "2026-10-22T10:00:00Z", end: "2026-10-23" }).ok,
    ).toBe(false);
    expect(
      parsePatchInput({ ...ok, allDay: true, start: "2026-13-45", end: "2026-14-01" }).ok,
    ).toBe(false);
  });

  it("lehnt Unsinn ab: Ende vor Beginn, fremde Felder, Pfad-Tricks, fehlende Angaben", () => {
    const time = { allDay: false, start: "2026-10-21T08:00:00Z", end: "2026-10-21T09:00:00Z" };
    expect(parsePatchInput({ ...ok, ...time, end: "2026-10-21T07:00:00Z" }).ok).toBe(false);
    expect(parsePatchInput({ ...ok, ...time, start: "gestern" }).ok).toBe(false);
    expect(parsePatchInput({ ...ok, ...time, eventId: "../../calendarList" }).ok).toBe(false);
    expect(parsePatchInput({ ...ok, ...time, sourceId: "nein" }).ok).toBe(false);
    expect(parsePatchInput({ ...ok, ...time, etag: "" }).ok).toBe(false);
    expect(parsePatchInput(null).ok).toBe(false);
    // Gäste, Videokonferenz & Co. kommen nie durch – nur Titel, Ort, Beschreibung und Zeiten
    const extra = parsePatchInput({
      ...ok,
      ...time,
      summary: "Neu",
      attendees: [{ email: "x@example.com" }],
      conferenceData: {},
    });
    expect(extra.ok && Object.keys(extra.value).sort()).toEqual([
      "etag",
      "eventId",
      "sourceId",
      "text",
      "times",
    ]);
    expect(JSON.stringify(extra)).not.toContain("x@example.com");
  });

  it("Titel, Ort, Beschreibung ohne Zeiten: getrimmt, leer leert Ort und Beschreibung", () => {
    const result = parsePatchInput({
      ...ok,
      summary: "  Neuer Titel ",
      location: "  ",
      description: "Zeile 1\nZeile 2\n\n",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        ...ok,
        text: { summary: "Neuer Titel", location: null, description: "Zeile 1\nZeile 2" },
      },
    });
    const onlyLocation = parsePatchInput({ ...ok, location: "Rathaus" });
    expect(onlyLocation.ok && onlyLocation.value.text).toEqual({ location: "Rathaus" });
    expect(onlyLocation.ok && onlyLocation.value.times).toBeUndefined();
  });

  it("Titel darf nicht leer oder zu lang werden, Ort/Beschreibung nicht zu lang", () => {
    expect(parsePatchInput({ ...ok, summary: "   " })).toEqual({
      ok: false,
      error: "Bitte einen Titel eingeben.",
    });
    expect(parsePatchInput({ ...ok, summary: "x".repeat(300) }).ok).toBe(true);
    expect(parsePatchInput({ ...ok, summary: "x".repeat(301) }).ok).toBe(false);
    expect(parsePatchInput({ ...ok, location: "x".repeat(301) }).ok).toBe(false);
    expect(parsePatchInput({ ...ok, description: "x".repeat(8001) }).ok).toBe(false);
  });

  it("verlangt Zeiten ganz oder gar nicht, und mindestens eine Änderung", () => {
    expect(parsePatchInput({ ...ok }).ok).toBe(false);
    expect(parsePatchInput({ ...ok, allDay: false, start: "2026-10-21T08:00:00Z" }).ok).toBe(false);
    expect(parsePatchInput({ ...ok, summary: "x", allDay: false }).ok).toBe(false);
  });
});
