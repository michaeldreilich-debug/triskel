import { describe, expect, it } from "vitest";
import {
  applyChoices,
  distance,
  matchArea,
  normalize,
  parseCapture,
  resolveProjectToken,
  scoreProject,
} from "./parse";

const areas = [
  { id: "fw", name: "Beruf" },
  { id: "pv", name: "Privat" },
];
const projects = [
  { id: "bew", title: "Bewerbung Musterfirma", area_id: "pv", status: "aktiv" },
  { id: "werk", title: "Werkstatt digitalisieren", area_id: "fw", status: "aktiv" },
  { id: "kleid", title: "Kleiderkammer Inventur", area_id: "fw", status: "geplant" },
  { id: "nord", title: "Nordlichter-Reise", area_id: "pv", status: "idee" },
  { id: "alt", title: "Werkstatt aufräumen", area_id: "fw", status: "archiv" },
];
const ctx = { areas, projects };

describe("Schnellerfassung: Kürzel", () => {
  it("„Lebenslauf #privat @Bewerbung“ landet zugeordnet (Abnahme B8)", () => {
    expect(parseCapture("Lebenslauf #privat @Bewerbung", ctx)).toEqual({
      title: "Lebenslauf",
      kind: "task",
      areaId: "pv",
      projectId: "bew",
      ambiguous: null,
      unknownProject: null,
      unknownAreas: [],
    });
  });

  it("#notiz macht eine Notiz daraus, mit Bereich und Projekt kombinierbar", () => {
    expect(parseCapture("Idee für die Übung #notiz", ctx)).toMatchObject({
      title: "Idee für die Übung",
      kind: "note",
      areaId: null,
      projectId: null,
    });
    expect(parseCapture("#Notiz Funkprobe #job @Werkstatt", ctx)).toMatchObject({
      title: "Funkprobe",
      kind: "note",
      areaId: "fw",
      projectId: "werk",
    });
    // nur am Wortanfang, „#notizen“ ist kein Kürzel
    expect(parseCapture("Liste #notizen", ctx)).toMatchObject({ kind: "task" });
    expect(parseCapture("Milch kaufen", ctx).kind).toBe("task");
  });

  it("ohne Kürzel: Inbox (kein Bereich, kein Projekt)", () => {
    const result = parseCapture("Milch kaufen", ctx);
    expect(result).toMatchObject({ title: "Milch kaufen", areaId: null, projectId: null });
  });

  it("Bereich per Name, Namensanfang und Kurzform", () => {
    expect(parseCapture("Atemschutz prüfen #job", ctx)).toMatchObject({
      title: "Atemschutz prüfen",
      areaId: "fw",
    });
    expect(parseCapture("#Beruf Übung", ctx).areaId).toBe("fw");
    expect(parseCapture("Steuer #pri", ctx).areaId).toBe("pv");
    expect(matchArea("p", areas)).toBeNull();
    expect(matchArea("x", areas)).toBeNull();
  });

  it("Projekt bestimmt den Bereich, auch gegen ein #-Kürzel", () => {
    expect(parseCapture("Termin #job @Bewerbung", ctx)).toMatchObject({
      areaId: "pv",
      projectId: "bew",
    });
  });

  it("Unschärfe: Wortanfang, Umlaute, Bindestrich, Tippfehler, mehrere Wörter", () => {
    expect(parseCapture("Angebot @digital", ctx).projectId).toBe("werk");
    expect(parseCapture("Liste @kleider", ctx).projectId).toBe("kleid");
    expect(parseCapture("Packen @nordlichter-reise", ctx).projectId).toBe("nord");
    expect(parseCapture("Packen @Nordlichter_Reise", ctx).projectId).toBe("nord");
    expect(parseCapture("Mail @Bewerbnug", ctx).projectId).toBe("bew"); // Tippfehler
    expect(parseCapture('Notiz @"musterfirma"', ctx)).toMatchObject({
      title: "Notiz",
      projectId: "bew",
    });
    expect(scoreProject("werkstatt digitalisieren", "Werkstatt digitalisieren")).toBe(100);
  });

  it("mehrere Treffer: nichts zuordnen, Kandidaten melden, Kürzel bleibt im Text", () => {
    const two = [
      ...projects,
      { id: "werk2", title: "Werkstatt Ordnung", area_id: "fw", status: "aktiv" },
    ];
    const result = parseCapture("Schrauben @Werkstatt", { areas, projects: two });
    expect(result.projectId).toBeNull();
    expect(result.areaId).toBeNull();
    expect(result.ambiguous?.candidates.map((p) => p.id).sort()).toEqual(["werk", "werk2"]);
    expect(result.title).toBe("Schrauben @Werkstatt");
    // genauer Treffer schlägt Teiltreffer
    expect(parseCapture("@Werkstatt_Ordnung x", { areas, projects: two }).projectId).toBe("werk2");
  });

  it("abgeschlossene/archivierte Projekte werden nicht gefunden; Unbekanntes bleibt Text", () => {
    expect(parseCapture("Kehren @aufräumen", ctx)).toMatchObject({
      projectId: null,
      unknownProject: "aufräumen",
      title: "Kehren @aufräumen",
    });
    const tags = parseCapture("Feier #sommer #job", ctx);
    expect(tags).toMatchObject({ title: "Feier #sommer", areaId: "fw", unknownAreas: ["sommer"] });
  });

  it("Kürzel nur am Wortanfang (E-Mail-Adressen bleiben)", () => {
    expect(parseCapture("schreibe an max@bewerbung.de", ctx)).toMatchObject({
      projectId: null,
      title: "schreibe an max@bewerbung.de",
    });
  });

  it("Hilfsfunktionen", () => {
    expect(normalize("  Größe_Über-Maß ")).toBe("groesse ueber mass");
    expect(distance("kitten", "sitting")).toBe(3);
    expect(distance("", "abc")).toBe(3);
  });
});

describe("Auswahl im Sheet „Festhalten“ (applyChoices)", () => {
  const base = (text: string) => parseCapture(text, ctx);

  it("Knöpfe füllen, was der Text offen lässt", () => {
    expect(applyChoices(base("Milch"), { kind: "note", areaId: "pv" }, projects)).toMatchObject({
      kind: "note",
      areaId: "pv",
      projectId: null,
    });
  });

  it("Kürzel im Text gehen vor", () => {
    const result = applyChoices(
      base("Milch #job #notiz"),
      { kind: "task", areaId: "pv" },
      projects,
    );
    expect(result).toMatchObject({ kind: "note", areaId: "fw" });
  });

  it("gewähltes Projekt bestimmt den Bereich", () => {
    expect(applyChoices(base("Milch"), { areaId: "fw", projectId: "bew" }, projects)).toMatchObject(
      { areaId: "pv", projectId: "bew" },
    );
  });

  it("ohne Auswahl bleibt es unverändert (Inbox)", () => {
    expect(applyChoices(base("Milch"), {}, projects)).toEqual(base("Milch"));
  });
});

describe("Mehrdeutiges @-Kürzel auflösen (resolveProjectToken)", () => {
  it("ersetzt das Kürzel als ganzes Wort durch den Titel in Anführungszeichen", () => {
    expect(resolveProjectToken("Mail @be schreiben", "be", "Bewerbung Musterfirma")).toBe(
      'Mail @"Bewerbung Musterfirma" schreiben',
    );
    expect(resolveProjectToken("@be", "be", "Bewerbung Musterfirma")).toBe(
      '@"Bewerbung Musterfirma"',
    );
  });

  it("lässt andere Wörter und Teiltreffer stehen", () => {
    expect(resolveProjectToken("Mail @bewerbung", "be", "Bewerbung Musterfirma")).toBe(
      "Mail @bewerbung",
    );
    expect(resolveProjectToken("a@be", "be", "Bewerbung Musterfirma")).toBe("a@be");
  });

  it("nimmt den Titel wörtlich, auch mit $-Zeichen", () => {
    expect(resolveProjectToken("x @k", "k", "Kosten $1 & $&")).toBe('x @"Kosten $1 & $&"');
  });
});
