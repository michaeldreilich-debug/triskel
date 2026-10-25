import { describe, expect, it } from "vitest";
import { DataError, describeDbError } from "./context";

describe("Datenbankfehler an die KI (Review Teil B, K-7): feste Texte statt roher Meldungen", () => {
  it("Postgres-Codes werden zu festen Texten, interne Namen bleiben innen", () => {
    expect(
      describeDbError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "event_links_unique"',
      }),
    ).toBe("ein gleicher Eintrag existiert schon");
    expect(
      describeDbError({
        code: "23503",
        message: 'insert or update on table "note_blocks" violates foreign key constraint …',
      }),
    ).not.toMatch(/note_blocks/);
    expect(describeDbError({ code: "42501", message: "permission denied for table notes" })).toBe(
      "keine Berechtigung (KI-Zugang nicht freigegeben oder nicht erlaubt)",
    );
    expect(describeDbError({ code: "PGRST204", message: "Could not find the 'foo' column" })).toBe(
      "ein Feld ist unbekannt",
    );
    expect(describeDbError({ code: "XX000", message: "intern" })).toBe("Datenbankfehler (XX000)");
    expect(describeDbError({ message: "irgendwas" })).toBe("Datenbankfehler");
    expect(describeDbError(null)).toBe("");
  });

  it("eigene Meldungen aus Triggern und RPCs gehen durch", () => {
    expect(
      describeDbError({
        code: "P0001",
        message: "Der Meilenstein gehört zu einem anderen Projekt.",
      }),
    ).toBe("Der Meilenstein gehört zu einem anderen Projekt.");
    expect(describeDbError({ code: "P0002", message: "Aufgabe nicht gefunden." })).toBe(
      "Aufgabe nicht gefunden.",
    );
    expect(describeDbError({ code: "22023", message: "Zieltyp x fehlt." })).toBe(
      "Zieltyp x fehlt.",
    );
    // Freigabe-Sperre (Migration 46) kommt als 42501 mit unserem Text
    const locked =
      "Diese Notiz ist öffentlich freigegeben – die KI kann sie nicht ändern. Der Nutzer ändert sie in der App oder beendet die Freigabe.";
    expect(describeDbError({ code: "42501", message: locked })).toBe(locked);
  });

  it("DataError nennt den Schritt und den festen Text", () => {
    expect(new DataError("Notiz ändern", { code: "23514", message: "check …" }).message).toBe(
      "Notiz ändern fehlgeschlagen: ein Wert ist nicht zulässig",
    );
    expect(new DataError("Notiz ändern", null).message).toBe("Notiz ändern fehlgeschlagen");
  });
});
