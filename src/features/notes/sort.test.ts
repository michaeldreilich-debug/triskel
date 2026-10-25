import { describe, expect, it } from "vitest";
import { laterTimestamp } from "./queries";
import { sortNotes } from "./sort";
import type { NoteRow } from "./types";

const note = (title: string, edited_at: string): NoteRow => ({
  id: title || "leer",
  title,
  type: "wissen",
  area_id: "a",
  topic_id: null,
  project_id: null,
  task_id: null,
  tags: [],
  reviewed_at: null,
  archived_at: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  deleted_at: null,
  edited_at,
  snippet: "",
});

const titles = (rows: NoteRow[]) => rows.map((n) => n.title);

describe("sortNotes", () => {
  const rows = [
    note("Zebra", "2026-10-11T09:00:00Z"),
    note("Äpfel", "2026-10-10T09:00:00Z"),
    note("", "2026-10-12T09:00:00Z"),
    note("Birne", "2026-10-11T09:00:00.000+00:00"),
  ];

  it("Neueste zuerst nach „zuletzt bearbeitet“, bei Gleichstand nach Titel", () => {
    expect(titles(sortNotes(rows, "neueste"))).toEqual(["", "Birne", "Zebra", "Äpfel"]);
  });

  it("A–Z in deutscher Reihenfolge, ohne Titel ans Ende", () => {
    expect(titles(sortNotes(rows, "az"))).toEqual(["Äpfel", "Birne", "Zebra", ""]);
  });

  it("verändert die Eingabe nicht", () => {
    const before = titles(rows);
    sortNotes(rows, "az");
    expect(titles(rows)).toEqual(before);
  });
});

describe("laterTimestamp", () => {
  it("vergleicht Zeitpunkte, nicht Schreibweisen", () => {
    expect(laterTimestamp("2026-10-11T10:00:00Z", "2026-10-11T10:00:01.5+00:00")).toBe(
      "2026-10-11T10:00:01.5+00:00",
    );
    expect(laterTimestamp("2026-10-11T12:00:00+02:00", "2026-10-11T10:30:00Z")).toBe(
      "2026-10-11T10:30:00Z",
    );
    expect(laterTimestamp("2026-10-11T10:00:00Z", undefined)).toBe("2026-10-11T10:00:00Z");
  });
});

describe("withUnconfirmedEdits", () => {
  it("noch nicht gespeicherte Blockänderungen zählen als zuletzt bearbeitet", async () => {
    const { withUnconfirmedEdits } = await import("./api");
    const rows = [note("Zebra", "2026-10-10T09:00:00Z"), note("Apfel", "2026-10-11T09:00:00Z")];
    const now = new Date("2026-10-11T10:00:00Z");
    const ops = [
      {
        table: "note_blocks",
        id: "b1",
        mode: "upsert" as const,
        values: { note_id: "Zebra", content_text: "neu" },
      },
      { table: "note_blocks", id: "b2", mode: "update" as const, values: { deleted_at: null } },
    ];
    const result = withUnconfirmedEdits(rows, ops, now);
    expect(titles(sortNotes(result, "neueste"))).toEqual(["Zebra", "Apfel"]);
    expect(withUnconfirmedEdits(rows, [], now)).toBe(rows);
  });
});
