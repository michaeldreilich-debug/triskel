/**
 * B1-Abnahme: Testnutzer A und B (vor Migration 09 angelegt) haben genau 2 Bereiche,
 * 3 Vorlagen und eine Einstellungszeile – aus der einmaligen Seed-Ausführung in Migration 09.
 */
import { describe, expect, inject, it } from "vitest";
import { userClient } from "../support/supabase-node";

describe.each([
  ["A", inject("sessionA")],
  ["B", inject("sessionB")],
] as const)("Seeds für Testnutzer %s", (_label, session) => {
  const client = userClient(session);

  it("genau 2 Bereiche: Beruf (orange) und Privat (blau)", async () => {
    const { data, error } = await client
      .from("areas")
      .select("name, color, sort, seed_key")
      .is("deleted_at", null)
      .order("sort");
    expect(error).toBeNull();
    expect(data).toEqual([
      { name: "Beruf", color: "orange", sort: "a0", seed_key: "beruf" },
      { name: "Privat", color: "blue", sort: "a1", seed_key: "privat" },
    ]);
  });

  it("genau 3 Vorlagen: Projekt, Protokoll, Wochenrückblick", async () => {
    const { data, error } = await client
      .from("templates")
      .select("kind, note_type, name, seed_key, body")
      .is("deleted_at", null)
      .order("kind");
    expect(error).toBeNull();
    expect(
      data?.map(({ kind, note_type, name, seed_key }) => ({ kind, note_type, name, seed_key })),
    ).toEqual([
      { kind: "notiz", note_type: "protokoll", name: "Protokoll", seed_key: "protokoll" },
      { kind: "projekt", note_type: null, name: "Projekt", seed_key: "projekt" },
      {
        kind: "rueckblick",
        note_type: null,
        name: "Wochenrückblick",
        seed_key: "wochenrueckblick",
      },
    ]);
    const protocol = data?.find((t) => t.kind === "notiz")?.body as {
      content: Array<{ content: Array<{ content: Array<{ text: string }> }> }>;
    };
    expect(protocol.content.map((block) => block.content[0]?.content[0]?.text)).toEqual([
      "Anlass/Datum",
      "Teilnehmende",
      "Themen",
      "Beschlüsse",
      "Offene Punkte (→ Aufgabe)",
      "Nächster Termin",
    ]);
  });

  it("eine Einstellungszeile mit Standardwerten", async () => {
    const { data, error } = await client.from("user_settings").select("theme, evening_time");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.evening_time).toBe("20:00:00");
    expect(["dark", "paper"]).toContain(data?.[0]?.theme);
  });
});
