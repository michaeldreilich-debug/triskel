import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDuration, parseIcs, parseIcsTime, parseProperty, unfoldLines } from "./ics";

const fixture = readFileSync(path.join(__dirname, "__fixtures__", "probe.ics"), "utf8");

describe("ICS lesen (S2a)", () => {
  it("entfaltet Fortsetzungszeilen (CRLF und LF)", () => {
    expect(unfoldLines("A:1\r\n b\r\nB:2\n\tc\n")).toEqual(["A:1b", "B:2c"]);
  });

  it("liest Eigenschaften mit Parametern, auch Doppelpunkte in Anführungszeichen", () => {
    expect(parseProperty("DTSTART;TZID=Europe/Berlin:20261005T100000")).toEqual({
      name: "DTSTART",
      params: { TZID: "Europe/Berlin" },
      value: "20261005T100000",
    });
    expect(parseProperty('X-A;P="a:b";VALUE=DATE:20261005')).toEqual({
      name: "X-A",
      params: { P: "a:b", VALUE: "DATE" },
      value: "20261005",
    });
    expect(parseProperty("kein doppelpunkt")).toBeNull();
  });

  it("Zeitwerte: Datum, Wanduhrzeit mit TZID, UTC, schwebend", () => {
    expect(parseIcsTime("20261024", { VALUE: "DATE" })).toEqual({
      kind: "date",
      date: "2026-10-24",
    });
    expect(parseIcsTime("20261024")).toEqual({ kind: "date", date: "2026-10-24" });
    expect(parseIcsTime("20261005T100000", { TZID: "Europe/Berlin" })).toMatchObject({
      kind: "datetime",
      year: 2026,
      month: 10,
      day: 5,
      hour: 10,
      minute: 0,
      second: 0,
      tz: "Europe/Berlin",
    });
    expect(parseIcsTime("20261021T070000Z")).toMatchObject({ hour: 7, tz: "UTC" });
    expect(parseIcsTime("20261022T1830")).toMatchObject({ hour: 18, minute: 30, tz: null });
    expect(parseIcsTime("gestern")).toBeNull();
  });

  it("DURATION in Sekunden", () => {
    expect(parseDuration("PT90M")).toBe(5400);
    expect(parseDuration("P1DT2H")).toBe(93_600);
    expect(parseDuration("P2W")).toBe(14 * 86_400);
    expect(parseDuration("-PT15M")).toBe(-900);
    expect(parseDuration("1h")).toBeNull();
  });

  it("die Test-ICS: Name, Termine, Ausnahmen, Alarm wird übersprungen, Text entschärft", () => {
    const calendar = parseIcs(fixture);
    expect(calendar.name).toBe("Probe-Kalender");
    expect(calendar.events).toHaveLength(14);
    const master = calendar.events.find((e) => e.uid === "dienstbesprechung123@google.com");
    expect(master).toMatchObject({
      summary: "Dienstbesprechung",
      location: "Gerätehaus, Hauptstraße 1",
      rrule: "FREQ=WEEKLY;WKST=MO;UNTIL=20261130T225959Z;BYDAY=MO",
      transparent: false,
      cancelled: false,
      recurrenceId: null,
    });
    expect(master?.description).toBe(
      "Jeden Montag, Gerätehaus\nTagesordnung kommt per Mail – bitte Zettel mitbringen; Kaffee gibt es.",
    );
    expect(master?.exdates).toEqual([
      {
        kind: "datetime",
        year: 2026,
        month: 10,
        day: 19,
        hour: 10,
        minute: 0,
        second: 0,
        tz: "Europe/Berlin",
      },
    ]);
    const moved = calendar.events.find((e) => e.summary === "Dienstbesprechung (verschoben)");
    expect(moved?.recurrenceId).toMatchObject({ day: 2, hour: 10 });
    const cancelled = calendar.events.filter((e) => e.cancelled).map((e) => e.summary);
    expect(cancelled).toEqual(["Dienstbesprechung", "Abgesagt"]);
    expect(calendar.events.find((e) => e.uid === "uebung@google.com")).toMatchObject({
      durationSeconds: 5400,
      end: null,
    });
    expect(calendar.events.find((e) => e.uid === "zusatz@google.com")?.rdates).toHaveLength(1);
  });

  it("ohne UID oder DTSTART fällt ein Termin weg; leere Datei ergibt nichts", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Ohne UID",
      "DTSTART:20261001T100000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:x",
      "SUMMARY:Ohne Beginn",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcs(text).events).toEqual([]);
    expect(parseIcs("")).toEqual({ name: null, events: [] });
  });
});
