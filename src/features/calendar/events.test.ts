import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  berlinMidnight,
  busyMinutes,
  eventsOnDay,
  expandCalendar,
  googleEventLink,
  isValidTimeZone,
  splitByDay,
} from "./events";
import { parseIcs } from "./ics";
import type { CalendarEvent } from "./types";

const calendar = parseIcs(readFileSync(path.join(__dirname, "__fixtures__", "probe.ics"), "utf8"));
const source = {
  id: "quelle-1",
  name: "Beruf",
  color: "orange" as const,
  calendarId: "alex@example.com",
};
const expand = (start: string, end: string) => expandCalendar(calendar, { start, end }, source);
const titles = (events: CalendarEvent[]) =>
  events.map((e) => `${e.date} ${e.allDay ? "ganztägig" : minutes(e.startMinutes)} ${e.title}`);
const minutes = (m: number | null) =>
  m === null
    ? "–"
    : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

describe("Termine ausrollen und auf Europe/Berlin normalisieren (S2a)", () => {
  it("Wöchentliche Serie: Ausnahme (EXDATE) fehlt, verschobene Instanz ersetzt, abgesagte fällt weg, UNTIL endet", () => {
    const events = expand("2026-10-01", "2026-12-31").filter(
      (e) => e.uid === "dienstbesprechung123@google.com",
    );
    expect(titles(events)).toEqual([
      "2026-10-05 10:00 Dienstbesprechung",
      "2026-10-12 10:00 Dienstbesprechung",
      // 19.10. EXDATE
      "2026-10-26 10:00 Dienstbesprechung",
      // 02.11. verschoben auf Dienstag 14:00
      "2026-11-03 14:00 Dienstbesprechung (verschoben)",
      // 09.11. abgesagt
      "2026-11-16 10:00 Dienstbesprechung",
      "2026-11-23 10:00 Dienstbesprechung",
      "2026-11-30 10:00 Dienstbesprechung",
    ]);
    // Zeitumstellung 25.10.: 10 Uhr Wanduhrzeit bleibt – vorher 08:00Z, danach 09:00Z
    const [, oct12, oct26] = events;
    expect(oct12?.start).toBe("2026-10-12T08:00:00.000Z");
    expect(oct26?.start).toBe("2026-10-26T09:00:00.000Z");
    expect(oct26).toMatchObject({
      endMinutes: 660,
      endDate: "2026-10-26",
      recurring: true,
      busy: true,
      location: "Gerätehaus, Hauptstraße 1",
      link: "https://calendar.google.com/calendar/event?eid=ZGllbnN0YmVzcHJlY2h1bmcxMjMgYWxleEBleGFtcGxlLmNvbQ",
    });
    expect(events.find((e) => e.title.includes("verschoben"))?.recurring).toBe(true);
  });

  it("Tägliche Serie über die Zeitumstellung (25.10.2026): jeden Tag 08:00 Wanduhrzeit", () => {
    const runs = expand("2026-10-20", "2026-10-31").filter(
      (e) => e.uid === "morgenlauf@google.com",
    );
    expect(runs.map((e) => `${e.date} ${e.start}`)).toEqual([
      "2026-10-23 2026-10-23T06:00:00.000Z",
      "2026-10-24 2026-10-24T06:00:00.000Z",
      "2026-10-25 2026-10-25T07:00:00.000Z",
      "2026-10-26 2026-10-26T07:00:00.000Z",
      "2026-10-27 2026-10-27T07:00:00.000Z",
    ]);
    expect(runs.every((e) => e.startMinutes === 480 && e.endMinutes === 510)).toBe(true);
  });

  it("Ganztägig: ein Tag und mehrere Tage, Ende exklusiv; „frei“ zählt nicht als belegt", () => {
    const events = expand("2026-10-24", "2026-10-28");
    expect(eventsOnDay(events, "2026-10-24").map((e) => e.title)).toEqual([
      "Herbstfest",
      "Morgenlauf",
    ]);
    const fest = events.find((e) => e.uid === "herbstfest@google.com");
    expect(fest).toMatchObject({
      allDay: true,
      date: "2026-10-24",
      endDate: "2026-10-24",
      startMinutes: null,
      endMinutes: null,
      busy: false,
      start: "2026-10-23T22:00:00.000Z",
      end: "2026-10-24T22:00:00.000Z",
    });
    const lehrgang = events.find((e) => e.uid === "lehrgang@google.com");
    expect(lehrgang).toMatchObject({ allDay: true, date: "2026-10-26", endDate: "2026-10-28" });
    expect(eventsOnDay(events, "2026-10-28").map((e) => e.title)).toContain("Lehrgang Atemschutz");
    // Zeitraum nur am Rand berührt: 28.10. zeigt den Lehrgang, 29.10. nicht mehr
    expect(expand("2026-10-28", "2026-10-28").map((e) => e.title)).toEqual(["Lehrgang Atemschutz"]);
    expect(expand("2026-10-29", "2026-10-29")).toEqual([]);
  });

  it("Zeitzonen: New York 10:00 = 16:00 Berlin, UTC 07:00 = 09:00, schwebend = Berlin, DURATION", () => {
    const events = expand("2026-10-20", "2026-10-22");
    expect(titles(events)).toEqual([
      "2026-10-20 16:00 Call New York",
      "2026-10-21 09:00 Online-Schulung",
      "2026-10-22 18:30 Übung",
    ]);
    expect(events[1]).toMatchObject({ busy: false, endMinutes: 600 });
    expect(events[2]).toMatchObject({ endMinutes: 20 * 60, start: "2026-10-22T16:30:00.000Z" });
  });

  it("Über Mitternacht: Nachtschicht 22–02 Uhr; Ende genau um Mitternacht gehört zum Vortag", () => {
    const night = expand("2026-10-30", "2026-10-31").find(
      (e) => e.uid === "nachtschicht@google.com",
    );
    expect(night).toMatchObject({
      date: "2026-10-30",
      endDate: "2026-10-31",
      startMinutes: 22 * 60,
      endMinutes: 2 * 60,
    });
    // am 31.10. (nur dieser Tag) erscheint sie ebenfalls
    expect(expand("2026-10-31", "2026-10-31").map((e) => e.title)).toEqual(["Nachtschicht"]);
    const evening = expand("2026-11-04", "2026-11-05").find((e) => e.uid === "abend@google.com");
    expect(evening).toMatchObject({ date: "2026-11-04", endDate: "2026-11-04", endMinutes: 1440 });
    expect(expand("2026-11-05", "2026-11-05").map((e) => e.title)).toEqual([]);
  });

  it("Abgesagte Serie/Termine fehlen, RDATE ergänzt, Termin ohne Ende hat Dauer 0", () => {
    const events = expand("2026-11-06", "2026-11-18");
    expect(titles(events)).toEqual([
      "2026-11-12 09:00 Zusatztermin",
      "2026-11-13 09:00 Zusatztermin",
      "2026-11-16 10:00 Dienstbesprechung",
      "2026-11-18 12:00 Erinnerung ohne Ende",
    ]);
    const reminder = events[3];
    expect(reminder).toMatchObject({ startMinutes: 720, endMinutes: 720, endDate: "2026-11-18" });
    expect(reminder?.start).toBe(reminder?.end);
    // Einzeltermin genau am Tagesanfang des Zeitraums zählt
    expect(expand("2026-11-18", "2026-11-18").map((e) => e.title)).toEqual([
      "Erinnerung ohne Ende",
    ]);
  });

  it("Tagesabschnitte, belegte Minuten (Überlappung einmal, ganztägig und frei nicht)", () => {
    const range = { start: "2026-10-30", end: "2026-10-31" };
    const segments = splitByDay(expand(range.start, range.end), range);
    expect(
      segments.map(
        (s) =>
          `${s.date} ${s.from}-${s.to} ${s.event.title}${s.continuesAfter ? " →" : ""}${s.continuesBefore ? " ←" : ""}`,
      ),
    ).toEqual(["2026-10-30 1320-1440 Nachtschicht →", "2026-10-31 0-120 Nachtschicht ←"]);
    const day = expand("2026-10-26", "2026-10-26");
    const monday = splitByDay(day, { start: "2026-10-26", end: "2026-10-26" });
    // Lehrgang (ganztägig), Morgenlauf 08:00–08:30, Dienstbesprechung 10:00–11:00
    expect(monday.map((s) => s.event.title)).toEqual([
      "Lehrgang Atemschutz",
      "Morgenlauf",
      "Dienstbesprechung",
    ]);
    expect(busyMinutes(monday)).toBe(90);
    const overlapping = [
      { from: 600, to: 720, event: { busy: true, allDay: false } },
      { from: 660, to: 780, event: { busy: true, allDay: false } },
      { from: 900, to: 960, event: { busy: false, allDay: false } },
      { from: 0, to: 1440, event: { busy: true, allDay: true } },
    ] as never;
    expect(busyMinutes(overlapping)).toBe(180);
  });

  it("Hilfen: Google-Link nur für Google-IDs, Zonen prüfen, Berliner Mitternacht", () => {
    expect(googleEventLink("abc_20261005T080000Z@google.com", "a@b.de")).toMatch(/\?eid=/);
    expect(googleEventLink("x", null)).toBeNull();
    expect(googleEventLink("mit leerzeichen@google.com", "a@b.de")).toBeNull();
    expect(googleEventLink("abc@google.com", "kein mail")).toBeNull();
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Nirgendwo/Stadt")).toBe(false);
    expect(new Date(berlinMidnight("2026-10-25")).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(new Date(berlinMidnight("2026-10-26")).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("unbekannte Zeitzone gilt als Berlin, kaputte RRULE ergibt den Einzeltermin, Höchstzahl greift", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:a",
      "SUMMARY:Fremde Zone",
      "DTSTART;TZID=Mars/Olympus:20261010T120000",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:b",
      "SUMMARY:Kaputt",
      "DTSTART:20261010T130000Z",
      "RRULE:FREQ=NIE",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:c",
      "SUMMARY:Minütlich",
      "DTSTART:20261010T000000Z",
      "RRULE:FREQ=MINUTELY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const events = expandCalendar(
      parseIcs(text),
      { start: "2026-10-10", end: "2026-10-10" },
      source,
    );
    expect(events.find((e) => e.uid === "a")?.start).toBe("2026-10-10T10:00:00.000Z");
    expect(events.filter((e) => e.uid === "b").map((e) => e.startMinutes)).toEqual([15 * 60]);
    expect(events.filter((e) => e.uid === "c").length).toBeLessThanOrEqual(2000);
  });
});
