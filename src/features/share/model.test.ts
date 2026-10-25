import { describe, expect, it } from "vitest";
import { parseSharedNote, sharedDoc, sharedFilePath, sharedTitle } from "./model";

const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("Antwort von shared_note lesen (#94)", () => {
  it("null, kaputt oder ohne Titel → null", () => {
    for (const bad of [null, undefined, "x", [], {}, { title: 3 }]) {
      expect(parseSharedNote(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("liest Blöcke defensiv; unbrauchbare fallen weg, fehlender Inhalt wird ein leerer Absatz", () => {
    const note = parseSharedNote({
      title: "Plan",
      blocks: [
        {
          id: "a",
          parent_id: null,
          sort: "a0",
          collapsed: false,
          content: p("A"),
          task_done: null,
        },
        { id: "b", parent_id: "a", sort: "a0", collapsed: "ja", content: "x", task_done: true },
        { id: 3, sort: "a1" },
        "kaputt",
      ],
    });
    expect(note?.blocks).toEqual([
      { id: "a", parent_id: null, sort: "a0", collapsed: false, content: p("A"), task_done: null },
      {
        id: "b",
        parent_id: "a",
        sort: "a0",
        collapsed: false,
        content: { type: "paragraph" },
        task_done: true,
      },
    ]);
    expect(sharedTitle({ title: "  ", blocks: [] })).toBe("Ohne Titel");
  });

  it("baut den Baum wie die App (Reihenfolge, Eltern, eingeklappt) und merkt Aufgaben je Block", () => {
    const note = parseSharedNote({
      title: "Plan",
      blocks: [
        {
          id: "b",
          parent_id: null,
          sort: "a1",
          collapsed: false,
          content: p("B"),
          task_done: false,
        },
        { id: "a", parent_id: null, sort: "a0", collapsed: true, content: p("A"), task_done: null },
        { id: "c", parent_id: "a", sort: "a0", collapsed: false, content: p("C"), task_done: true },
        // verwaist: Eltern fehlen → oben, nichts geht verloren
        {
          id: "d",
          parent_id: "weg",
          sort: "a2",
          collapsed: false,
          content: p("D"),
          task_done: null,
        },
      ],
    });
    const { doc, taskDone } = sharedDoc(note as NonNullable<typeof note>);
    expect(doc.content?.map((b) => b.attrs?.id)).toEqual(["a", "b", "d"]);
    expect(doc.content?.[0]?.attrs?.collapsed).toBe(true);
    expect(doc.content?.[0]?.content?.[1]?.attrs?.id).toBe("c");
    expect([...taskDone]).toEqual([
      ["b", false],
      ["c", true],
    ]);
  });

  it("Datei-Adresse: Pfad kodiert, Name nur zum Herunterladen; ungültiger Token → leer", () => {
    expect(sharedFilePath(TOKEN, "u/n/f.png")).toBe(
      `/api/freigabe/${TOKEN}/datei?pfad=u%2Fn%2Ff.png`,
    );
    expect(sharedFilePath(TOKEN, "u/n/f.pdf", "Plan & Co.pdf")).toBe(
      `/api/freigabe/${TOKEN}/datei?pfad=u%2Fn%2Ff.pdf&name=Plan+%26+Co.pdf`,
    );
    expect(sharedFilePath("../x", "u/n/f.png")).toBe("");
  });
});
