import { describe, expect, it } from "vitest";
import {
  priorityOf,
  recurrenceOf,
  resolveNamed,
  resolveNamedLoose,
  ToolInputError,
} from "./resolve";

const projects = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Digitale Werkstatt-Lösung" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Steuer 2024" },
  { id: "33333333-3333-4333-8333-333333333333", title: "Steuer 2025" },
];
const find = (value: string) => resolveNamed(value, projects, (p) => p.title, "Projekt");
const findLoose = (value: string) => resolveNamedLoose(value, projects, (p) => p.title, "Projekt");

describe("Namen auflösen (#33)", () => {
  it("Schreiben: per ID, genauem Namen oder eindeutigem Namensanfang", () => {
    expect(find("22222222-2222-4222-8222-222222222222").title).toBe("Steuer 2024");
    expect(find("steuer 2024").title).toBe("Steuer 2024");
    expect(find("Digitale Werk").title).toBe("Digitale Werkstatt-Lösung");
  });

  it("Lesen (loose): auch Wortanfang, Teilwort und Tippfehler, wenn eindeutig", () => {
    expect(findLoose("Werkstatt").title).toBe("Digitale Werkstatt-Lösung");
    expect(findLoose("werkstatt losung").title).toBe("Digitale Werkstatt-Lösung");
    expect(() => findLoose("Steuer")).toThrow(/nicht eindeutig: Steuer 2024 .*Steuer 2025/);
  });

  it("mehrdeutig oder unbekannt → Fehler mit Vorschlägen, nie raten", () => {
    expect(() => find("Steuer")).toThrow(/nicht eindeutig: Steuer 2024 .*Steuer 2025/);
    expect(() => find("Urlaub")).toThrow(/nicht gefunden\. Vorhanden: Digitale/);
    expect(() => find("44444444-4444-4444-8444-444444444444")).toThrow(ToolInputError);
  });

  it("Schreiben: Teiltreffer verschiedener Stufen ergeben eine Rückfrage mit Kandidaten (Review Teil B, K-1)", () => {
    // 19.10.: „8“ traf den Meilenstein „7 Oberfläche Teil 2 (#34 … #48)“ (enthalten, Stufe 40)
    const milestones = [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "7 Oberfläche Teil 2 (#34 … #48)" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "9 Abschluss" },
    ];
    expect(() => resolveNamed("8", milestones, (m) => m.title, "Meilenstein")).toThrow(
      /Meilenstein „8“ passt auf keinen Namen genau\. Gemeint sein könnte: 7 Oberfläche Teil 2 \(#34 … #48\) \(aaaaaaaa.*den Nutzer fragen/,
    );
    // Wortanfang (60) und Tippfehler (20): beim Schreiben nur Kandidaten, beim Lesen Treffer
    expect(() => find("Werkstatt")).toThrow(/passt auf keinen Namen genau/);
    expect(() => find("werkstatt losung")).toThrow(/passt auf keinen Namen genau/);
    // „Feuer“: Anfang von „Feuerwerk Silvester“ (80), enthalten in „Lagerfeuer Rezepte“ (40) →
    // der eindeutige Namensanfang gewinnt
    const named = [
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Feuerwerk Silvester" },
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Lagerfeuer Rezepte" },
    ];
    expect(resolveNamed("Feuer", named, (p) => p.title, "Projekt").title).toBe(
      "Feuerwerk Silvester",
    );
    expect(() => resolveNamed("Lagerfeuer", named, (p) => p.title, "Projekt")).not.toThrow();
    expect(() => resolveNamed("feuer rezepte", named, (p) => p.title, "Projekt")).toThrow(
      /Gemeint sein könnte: Lagerfeuer Rezepte/,
    );
    // zwei genau gleiche Namen bleiben mehrdeutig
    const twins = [
      { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", title: "Protokoll" },
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "Protokoll" },
    ];
    expect(() => resolveNamed("Protokoll", twins, (p) => p.title, "Notiz")).toThrow(
      /nicht eindeutig/,
    );
  });
});

describe("Werte", () => {
  it("Priorität deutsch → Zahl", () => {
    expect(priorityOf("hoch")).toBe(1);
    expect(priorityOf(null)).toBeNull();
  });

  it("Wiederholung als Vorgabe (Bezugstag Fälligkeit) oder RRULE", () => {
    expect(recurrenceOf("wöchentlich", "2026-10-19", "2026-10-17")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(recurrenceOf("Täglich", null, "2026-10-17")).toBe("FREQ=DAILY");
    expect(recurrenceOf("keine", null, "2026-10-17")).toBeNull();
    expect(recurrenceOf("RRULE:freq=monthly;bymonthday=1", null, "2026-10-17")).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=1",
    );
    expect(() => recurrenceOf("manchmal", null, "2026-10-17")).toThrow(/nicht verstanden/);
  });
});
