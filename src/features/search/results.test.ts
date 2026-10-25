import { describe, expect, it } from "vitest";
import type { NoteRow } from "@/features/notes/types";
import type { ProjectRow } from "@/features/projects/types";
import { task } from "@/features/tasks/fixtures";
import { groupSearchResults, type SearchContext, type SearchRow } from "./results";

const row = (kind: string, id: string, title: string, snippet = ""): SearchRow => ({
  kind,
  id,
  title,
  snippet,
  rank: 1,
});

const ctx: SearchContext = {
  areas: [{ id: "fw", name: "Beruf", color: "orange" }],
  projects: [
    { id: "p1", title: "Digitale Werkstatt", area_id: "fw", status: "aktiv" } as ProjectRow,
    { id: "p2", title: "Alte Werkstatt", area_id: "fw", status: "archiv" } as ProjectRow,
  ],
  tasks: [
    task("t1", { title: "Demo Werkstatt software ablauf", project_id: "p1", area_id: "fw" }),
    task("t2", { title: "werkstatt notizen", area_id: "fw", status: "erledigt" }),
    task("t3", { title: "Gedanke", area_id: null, in_inbox: true }),
  ],
  notes: [{ id: "n1", title: "Werkstatt-Ideen", area_id: "fw" } as NoteRow],
};

describe("groupSearchResults", () => {
  it("gruppiert in fester Reihenfolge: Projekte, Aufgaben, Notizen", () => {
    const groups = groupSearchResults(
      [row("notiz", "n1", "Werkstatt-Ideen"), row("aufgabe", "t1", "x"), row("projekt", "p1", "x")],
      ctx,
    );
    expect(groups.map((g) => g.heading)).toEqual(["Projekte", "Aufgaben", "Notizen"]);
  });

  it("nimmt Titel und Ort aus dem Cache: Projekt, sonst Bereich, sonst Inbox", () => {
    const [tasks] = groupSearchResults(
      [row("aufgabe", "t1", "alt"), row("aufgabe", "t3", "Gedanke")],
      ctx,
    );
    expect(tasks?.hits).toMatchObject([
      { title: "Demo Werkstatt software ablauf", detail: "Digitale Werkstatt" },
      { title: "Gedanke", detail: "Inbox" },
    ]);
  });

  it("Erledigtes und Archiviertes rutscht nach unten, Ausschnitt einzeilig", () => {
    const groups = groupSearchResults(
      [
        row("aufgabe", "t2", "werkstatt notizen"),
        row("aufgabe", "t1", "Demo", "Bau\n  Kkk"),
        row("projekt", "p2", "Alte Werkstatt"),
        row("projekt", "p1", "Digitale Werkstatt"),
      ],
      ctx,
    );
    expect(groups[0]?.hits.map((h) => [h.id, h.detail])).toEqual([
      ["p1", "Beruf"],
      ["p2", "Beruf · archiviert"],
    ]);
    expect(groups[1]?.hits.map((h) => [h.id, h.detail, h.done])).toEqual([
      ["t1", "Digitale Werkstatt · Bau Kkk", false],
      ["t2", "Beruf · erledigt", true],
    ]);
  });

  it("viele Treffer: die drei besten offenen stehen vorab, egal welcher Art (#84)", () => {
    // Rang-Reihenfolge wie aus der Datenbank: die Notiz zuerst, die erledigte Aufgabe an dritter Stelle
    const groups = groupSearchResults(
      [
        row("notiz", "n1", "Werkstatt-Ideen"),
        row("aufgabe", "t1", "x"),
        row("aufgabe", "t2", "werkstatt notizen"),
        row("projekt", "p1", "x"),
        row("aufgabe", "t3", "Gedanke"),
        row("projekt", "p2", "Alte Werkstatt"),
      ],
      ctx,
    );
    expect(groups.map((g) => [g.heading, g.hits.map((h) => h.id)])).toEqual([
      ["Beste Treffer", ["n1", "t1", "p1"]],
      ["Projekte", ["p2"]],
      ["Aufgaben", ["t3", "t2"]],
    ]);
    expect(groups[0]?.hits[0]).toMatchObject({ kind: "notiz", detail: "Beruf" });
  });

  it("wenige Treffer: keine „Beste Treffer“, alles in den Gruppen", () => {
    const rows = ["t1", "t2", "t3"].map((id) => row("aufgabe", id, "x"));
    rows.push(row("notiz", "n1", "Werkstatt-Ideen"), row("projekt", "p1", "x"));
    expect(groupSearchResults(rows, ctx).map((g) => g.key)).toEqual([
      "projekt",
      "aufgabe",
      "notiz",
    ]);
  });

  it("unbekannte Arten fallen weg, fehlender Titel wird „Ohne Titel“", () => {
    expect(groupSearchResults([row("etwas", "x", "?")], ctx)).toEqual([]);
    const [notes] = groupSearchResults([row("notiz", "n9", "")], ctx);
    expect(notes?.hits[0]?.title).toBe("Ohne Titel");
  });
});
