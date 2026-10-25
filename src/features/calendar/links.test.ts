import { describe, expect, it } from "vitest";
import {
  alreadyLinked,
  type EventLinkRow,
  eventWhenLabel,
  type LinkableEvent,
  linksOfEvent,
  linksOfTarget,
  protocolTitle,
  sameLink,
  snapshotStale,
  toEventLink,
} from "./links";

const event = (extra: Partial<LinkableEvent> = {}): LinkableEvent => ({
  calendarId: "fw@group.calendar.google.com",
  eventId: "ev1_20261021T170000Z",
  recurringEventId: "ev1",
  title: "Übungsdienst",
  start: "2026-10-21T17:00:00.000Z",
  end: "2026-10-21T19:00:00.000Z",
  allDay: false,
  ...extra,
});

const link = (id: string, extra: Partial<EventLinkRow> = {}): EventLinkRow =>
  toEventLink({
    id,
    google_calendar_id: "fw@group.calendar.google.com",
    event_id: "ev1_20261021T170000Z",
    recurring_event_id: "ev1",
    scope: "occurrence",
    task_id: null,
    note_id: "n1",
    event_title: "Übungsdienst",
    event_start: "2026-10-21T17:00:00.000Z",
    event_end: "2026-10-21T19:00:00.000Z",
    created_at: "2026-10-20T10:00:00Z",
    ...extra,
  });

describe("Termin-Verknüpfungen (#68)", () => {
  it("nur dieses Mal trifft das Vorkommen, ganze Serie jedes Vorkommen", () => {
    const links = [
      link("once"),
      link("series", { scope: "series", note_id: null, task_id: "t1" }),
      link("gelöst", { deleted_at: "2026-10-20T11:00:00Z" }),
      link("anders", { event_id: "ev9", recurring_event_id: null }),
    ];
    expect(linksOfEvent(links, event()).map((l) => l.id)).toEqual(["once", "series"]);
    const next = event({ eventId: "ev1_20261028T170000Z", start: "2026-10-28T17:00:00.000Z" });
    expect(linksOfEvent(links, next).map((l) => l.id)).toEqual(["series"]);
    // Einzeltermin ohne Serie: eine Serien-Verknüpfung ohne ID trifft nie
    expect(
      linksOfEvent([link("x", { scope: "series", recurring_event_id: null })], event()),
    ).toEqual([]);
  });

  it("Ziel: Aufgabe bzw. Notiz, gelöste nicht; doppelt erkennen", () => {
    const links = [
      link("b", { event_start: "2026-10-28T17:00:00.000Z" }),
      link("a"),
      link("t", { note_id: null, task_id: "t1" }),
    ];
    expect(linksOfTarget(links, { noteId: "n1" }).map((l) => l.id)).toEqual(["a", "b"]);
    expect(linksOfTarget(links, { taskId: "t1" }).map((l) => l.id)).toEqual(["t"]);
    expect(alreadyLinked(links, event(), { noteId: "n1" })).toBe(true);
    expect(alreadyLinked(links, event(), { noteId: "n2" })).toBe(false);
    // dieselbe Verknüpfung wie der Index event_links_unique (Zurückholen gewinnt, M-4)
    expect(sameLink(link("a"), link("b"))).toBe(true);
    expect(sameLink(link("a"), link("t", { note_id: null, task_id: "t1" }))).toBe(false);
    expect(sameLink(link("a"), link("c", { event_id: "ev1_20261028T170000Z" }))).toBe(false);
    expect(
      sameLink(
        link("s1", { scope: "series", event_id: "ev1_20261021T170000Z" }),
        link("s2", { scope: "series", event_id: "ev1_20261028T170000Z" }),
      ),
    ).toBe(true);
  });

  it("Schnappschuss veraltet, wenn Titel oder Zeit sich ändern (Serie: nur das eigene Vorkommen)", () => {
    expect(snapshotStale(link("a"), event())).toBe(false);
    expect(snapshotStale(link("a"), event({ title: "Übungsdienst Atemschutz" }))).toBe(true);
    expect(snapshotStale(link("a"), event({ end: "2026-10-21T19:30:00.000Z" }))).toBe(true);
    // gleicher Zeitpunkt, andere Schreibweise
    expect(snapshotStale(link("a", { event_start: "2026-10-21T17:00:00+00:00" }), event())).toBe(
      false,
    );
    const series = link("s", { scope: "series" });
    expect(snapshotStale(series, event({ eventId: "ev1_20261028T170000Z", title: "Anders" }))).toBe(
      false,
    );
  });

  it("Beschriftung und Titel der Notiz zum Termin (Europe/Berlin)", () => {
    expect(eventWhenLabel("2026-10-21T17:00:00.000Z", "2026-10-21T19:00:00.000Z", false)).toBe(
      "Mi, 21.10. 19:00–21:00",
    );
    expect(eventWhenLabel("2026-10-20T22:00:00.000Z", "2026-10-21T22:00:00.000Z", true)).toBe(
      "Mi, 21.10. · ganztägig",
    );
    expect(protocolTitle(event())).toBe("Übungsdienst 21.10. – Protokoll");
    expect(protocolTitle(event({ title: "  " }))).toBe("Termin 21.10. – Protokoll");
  });
});
