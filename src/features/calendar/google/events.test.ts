import { describe, expect, it } from "vitest";
import { isGoogleEventEditable, normalizeGoogleEvent, normalizeGoogleEvents } from "./events";

const SOURCE = {
  id: "src-1",
  name: "Hauptkalender",
  color: "lila" as const,
  calendarId: "alex@example.com",
  accessRole: "owner" as const,
};

const base = {
  id: "abc123",
  etag: '"3400000000000000"',
  status: "confirmed",
  summary: "Teamrunde",
  start: { dateTime: "2026-10-21T09:00:00+02:00", timeZone: "Europe/Berlin" },
  end: { dateTime: "2026-10-21T10:30:00+02:00", timeZone: "Europe/Berlin" },
  htmlLink: "https://www.google.com/calendar/event?eid=abc",
};

describe("Google-Termin → CalendarEvent", () => {
  it("Termin mit Uhrzeit: Berliner Tag und Minuten, Quelle, Verweis", () => {
    const e = normalizeGoogleEvent(base, SOURCE);
    expect(e).toMatchObject({
      id: "src-1:abc123:2026-10-21T07:00:00.000Z",
      sourceId: "src-1",
      sourceName: "Hauptkalender",
      color: "lila",
      title: "Teamrunde",
      allDay: false,
      date: "2026-10-21",
      endDate: "2026-10-21",
      startMinutes: 540,
      endMinutes: 630,
      busy: true,
      recurring: false,
      link: "https://www.google.com/calendar/event?eid=abc",
      google: {
        calendarId: "alex@example.com",
        eventId: "abc123",
        etag: '"3400000000000000"',
        editable: true,
        recurringEventId: null,
        timeZone: "Europe/Berlin",
      },
    });
  });

  it("andere Zone im Termin: angezeigt in Europe/Berlin, Zone bleibt im Verweis", () => {
    const e = normalizeGoogleEvent(
      {
        ...base,
        start: { dateTime: "2026-10-21T09:00:00-04:00", timeZone: "America/New_York" },
        end: { dateTime: "2026-10-21T10:00:00-04:00", timeZone: "America/New_York" },
      },
      SOURCE,
    );
    expect(e?.startMinutes).toBe(15 * 60);
    expect(e?.google?.timeZone).toBe("America/New_York");
  });

  it("ganztägig: Ende exklusiv, mehrere Tage, ohne Minuten", () => {
    const one = normalizeGoogleEvent(
      {
        id: "g1",
        etag: "e",
        summary: "Urlaub",
        start: { date: "2026-10-22" },
        end: { date: "2026-10-23" },
      },
      SOURCE,
    );
    expect(one).toMatchObject({
      allDay: true,
      date: "2026-10-22",
      endDate: "2026-10-22",
      startMinutes: null,
      endMinutes: null,
    });
    expect(one?.google?.timeZone).toBeNull();
    const three = normalizeGoogleEvent(
      { id: "g2", etag: "e", start: { date: "2026-10-24" }, end: { date: "2026-10-27" } },
      SOURCE,
    );
    expect(three).toMatchObject({ date: "2026-10-24", endDate: "2026-10-26", title: "Ohne Titel" });
    // über die Zeitumstellung (25.10.): trotzdem ganze Tage
    expect(three?.end).toBe("2026-10-26T23:00:00.000Z");
  });

  it("Instanz einer Serie: wiederkehrend, Serien-ID im Verweis, eigene Instanz-ID", () => {
    const e = normalizeGoogleEvent(
      { ...base, id: "serie_20261021T070000Z", recurringEventId: "serie" },
      SOURCE,
    );
    expect(e).toMatchObject({
      recurring: true,
      uid: "serie_20261021T070000Z",
      google: { eventId: "serie_20261021T070000Z", recurringEventId: "serie" },
    });
  });

  it("frei markiert, abgesagt, abgelehnt, unlesbar, fremder Link", () => {
    expect(normalizeGoogleEvent({ ...base, transparency: "transparent" }, SOURCE)?.busy).toBe(
      false,
    );
    expect(normalizeGoogleEvent({ ...base, status: "cancelled" }, SOURCE)).toBeNull();
    expect(
      normalizeGoogleEvent(
        { ...base, attendees: [{ self: true, responseStatus: "declined" }] },
        SOURCE,
      ),
    ).toBeNull();
    expect(normalizeGoogleEvent({ id: "x" }, SOURCE)).toBeNull();
    expect(normalizeGoogleEvent({ ...base, start: { dateTime: "kaputt" } }, SOURCE)).toBeNull();
    expect(
      normalizeGoogleEvent({ ...base, htmlLink: "https://evil.example/calendar/event" }, SOURCE)
        ?.link,
    ).toBeNull();
    expect(normalizeGoogleEvents([base, { id: "x" }, null], SOURCE)).toHaveLength(1);
  });

  it("lange Texte werden gekürzt", () => {
    const e = normalizeGoogleEvent(
      { ...base, summary: "T".repeat(400), description: "D".repeat(3000) },
      SOURCE,
    );
    expect(e?.title).toHaveLength(300);
    expect(e?.description).toHaveLength(2000);
  });
});

describe("editierbar (Schreibrecht, Einladungen)", () => {
  const raw = (extra: object = {}) => normalizeGoogleEvent({ ...base, ...extra }, SOURCE)?.google;

  it("ohne Gäste: ja – mit Schreibrecht owner/writer, sonst nie", () => {
    expect(raw()?.editable).toBe(true);
    for (const role of ["reader", "freeBusyReader"] as const) {
      expect(normalizeGoogleEvent(base, { ...SOURCE, accessRole: role })?.google?.editable).toBe(
        false,
      );
    }
    expect(normalizeGoogleEvent(base, { ...SOURCE, accessRole: "writer" })?.google?.editable).toBe(
      true,
    );
  });

  it("Einladung: nur als Organisator oder wenn Gäste ändern dürfen", () => {
    const guests = [{ self: true, responseStatus: "accepted" }, { responseStatus: "accepted" }];
    expect(raw({ attendees: guests, organizer: { self: true } })?.editable).toBe(true);
    expect(raw({ attendees: guests, organizer: { self: false } })?.editable).toBe(false);
    expect(raw({ attendees: guests })?.editable).toBe(false);
    expect(raw({ attendees: guests, guestsCanModify: true })?.editable).toBe(true);
    // nur man selbst als Teilnehmer zählt nicht als Einladung
    expect(raw({ attendees: [{ self: true }] })?.editable).toBe(true);
  });

  it("gesperrt und feste Terminarten nie", () => {
    expect(raw({ locked: true })?.editable).toBe(false);
    for (const eventType of ["birthday", "fromGmail", "workingLocation"]) {
      expect(raw({ eventType })?.editable, eventType).toBe(false);
    }
    expect(raw({ eventType: "default" })?.editable).toBe(true);
  });

  it("isGoogleEventEditable direkt", () => {
    expect(
      isGoogleEventEditable({ ...base, id: "a", etag: "e", start: {}, end: {} }, "reader"),
    ).toBe(false);
  });
});
