import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { outline } from "../test-utils";
import {
  assignSortKeys,
  type BlockRow,
  diffRows,
  docToRows,
  inlineText,
  outlineToMarkdown,
  rowsToDoc,
} from "./serializer";

const sample = () =>
  outline([
    ["Pressluftatmer", ["Prüffristen", "Nach jedem Einsatz"]],
    ["Atemschutzmasken", ["Maske 1", "Maske 2"], { collapsed: true }],
    "Offene Punkte",
  ]);

const texts = (rows: BlockRow[]) => rows.map((r) => r.content_text);

describe("docToRows", () => {
  it("liefert Zeilen in Vorordnung mit Eltern, aufsteigender Sortierung und Klappzustand", () => {
    const rows = docToRows(sample());
    expect(texts(rows)).toEqual([
      "Pressluftatmer",
      "Prüffristen",
      "Nach jedem Einsatz",
      "Atemschutzmasken",
      "Maske 1",
      "Maske 2",
      "Offene Punkte",
    ]);
    const byText = Object.fromEntries(rows.map((r) => [r.content_text, r]));
    expect(byText.Prüffristen?.parent_id).toBe("id-Pressluftatmer");
    expect(byText.Pressluftatmer?.parent_id).toBeNull();
    expect(byText.Atemschutzmasken?.collapsed).toBe(true);
    const top = rows.filter((r) => r.parent_id === null).map((r) => r.sort);
    expect([...top].sort()).toEqual(top);
    expect(new Set(top).size).toBe(3);
  });

  it("content_text löst Links und Tags auf", () => {
    const content: JSONContent[] = [
      { type: "text", text: "Siehe " },
      { type: "noteLink", attrs: { noteId: "n1" } },
      { type: "hardBreak" },
      { type: "tag", attrs: { name: "pa" } },
    ];
    expect(
      inlineText(content, { resolveTitle: (id) => (id === "n1" ? "Wartungsplan" : undefined) }),
    ).toBe("Siehe [[Wartungsplan]]\n#pa");
  });

  it("verweigert Blöcke ohne oder mit doppelter ID", () => {
    const missing = outline(["A"]);
    ((missing.content ?? [])[0] as { attrs: { id: unknown } }).attrs.id = null;
    expect(() => docToRows(missing)).toThrow(/ohne ID/);
    expect(() => docToRows(outline(["A", ["B", [], { id: "id-A" }]]))).toThrow(/doppelt/);
  });
});

describe("rowsToDoc", () => {
  it("baut das Dokument verlustfrei wieder auf (Baum, IDs, Klappzustand)", () => {
    const doc = sample();
    expect(rowsToDoc(docToRows(doc))).toEqual(doc);
  });

  it("ignoriert gelöschte Zeilen und zeigt verwaiste oder zyklische Zeilen oben an", () => {
    const rows = docToRows(sample());
    const deleted = rows.map((r) =>
      r.content_text === "Offene Punkte" ? { ...r, deleted_at: "2026-10-10T10:00:00Z" } : r,
    );
    expect(texts(docToRows(rowsToDoc(deleted)))).not.toContain("Offene Punkte");

    const orphan: BlockRow = {
      ...(rows[1] as BlockRow),
      id: "waise",
      parent_id: "gibt-es-nicht",
      sort: "a0",
    };
    const cycleA: BlockRow = {
      ...(rows[1] as BlockRow),
      id: "zyk-a",
      parent_id: "zyk-b",
      sort: "a0",
    };
    const cycleB: BlockRow = {
      ...(rows[1] as BlockRow),
      id: "zyk-b",
      parent_id: "zyk-a",
      sort: "a1",
    };
    const ids = (rowsToDoc([orphan, cycleA, cycleB]).content ?? []).map((b) => b.attrs?.id);
    expect(ids).toContain("waise");
    expect(ids.some((id) => id === "zyk-a" || id === "zyk-b")).toBe(true);
    const all = docToRows(rowsToDoc([orphan, cycleA, cycleB])).map((r) => r.id);
    expect(all.sort()).toEqual(["waise", "zyk-a", "zyk-b"]);
  });

  it("leere Notiz ergibt einen leeren Block", () => {
    expect(rowsToDoc([]).content).toHaveLength(1);
  });
});

describe("Diff gegen den gespeicherten Stand", () => {
  it("Text ändern → genau eine Zeile", () => {
    const saved = docToRows(sample());
    const doc = sample();
    const block = doc.content?.[2] as JSONContent;
    (block.content as JSONContent[])[0] = {
      type: "paragraph",
      content: [{ type: "text", text: "Offene Punkte!" }],
    };
    const diff = diffRows(saved, docToRows(doc, saved));
    expect(diff.upserts.map((r) => r.content_text)).toEqual(["Offene Punkte!"]);
    expect(diff.removed).toEqual([]);
  });

  it("Verschieben ändert nur die Sortierung einer Zeile", () => {
    const saved = docToRows(sample());
    const doc = sample();
    doc.content = [doc.content?.[2], doc.content?.[0], doc.content?.[1]] as JSONContent[];
    const diff = diffRows(saved, docToRows(doc, saved));
    expect(diff.upserts.map((r) => r.content_text)).toEqual(["Offene Punkte"]);
  });

  it("Einrücken ändert Eltern und Sortierung nur dieser Zeile", () => {
    const saved = docToRows(sample());
    const doc = sample();
    const [first, second, third] = doc.content as JSONContent[];
    ((first as JSONContent).content as JSONContent[]).push(third as JSONContent);
    doc.content = [first, second] as JSONContent[];
    const diff = diffRows(saved, docToRows(doc, saved));
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]).toMatchObject({
      content_text: "Offene Punkte",
      parent_id: "id-Pressluftatmer",
    });
  });

  it("Löschen eines Blocks meldet ihn samt Kindern als entfernt (Soft-Delete)", () => {
    const saved = docToRows(sample());
    const doc = sample();
    doc.content = [doc.content?.[0], doc.content?.[2]] as JSONContent[];
    const diff = diffRows(saved, docToRows(doc, saved));
    expect(diff.upserts).toEqual([]);
    expect(diff.removed.sort()).toEqual(["id-Atemschutzmasken", "id-Maske 1", "id-Maske 2"]);
  });

  it("ohne Änderung gibt es nichts zu speichern", () => {
    const saved = docToRows(sample());
    expect(diffRows(saved, docToRows(sample(), saved))).toEqual({ upserts: [], removed: [] });
  });
});

describe("Sortierschlüssel", () => {
  it("behält die längste aufsteigende Folge und erzeugt nur fehlende Schlüssel neu", () => {
    const keys = assignSortKeys(["a1", undefined, "a0", "a3", undefined]);
    expect(keys[0]).toBe("a1");
    expect(keys[3]).toBe("a3");
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(5);
  });

  it("doppelte Schlüssel werden aufgelöst", () => {
    const keys = assignSortKeys(["a0", "a0", "a0"]);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("Markdown", () => {
  it("Outline als verschachtelte Liste mit Formatierung, Links und Tags", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "block",
          attrs: { id: "a" },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "fett", marks: [{ type: "bold" }] },
                { type: "text", text: " und " },
                { type: "noteLink", attrs: { noteId: "n" } },
                { type: "text", text: " " },
                { type: "tag", attrs: { name: "pa" } },
              ],
            },
            {
              type: "block",
              attrs: { id: "b" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Kind" }] }],
            },
          ],
        },
      ],
    };
    expect(outlineToMarkdown(doc.content ?? [], { resolveTitle: () => "Notiz" })).toBe(
      "- **fett** und [[Notiz]] #pa\n  - Kind",
    );
  });
});

describe("Mehr Formatierung (#40)", () => {
  const block = (id: string, paragraph: JSONContent): JSONContent => ({
    type: "block",
    attrs: { id },
    content: [paragraph],
  });
  const doc: JSONContent = {
    type: "doc",
    content: [
      block("a", {
        type: "paragraph",
        attrs: { kind: "h2" },
        content: [{ type: "text", text: "Beschlüsse" }],
      }),
      block("b", { type: "paragraph", attrs: { kind: "divider" } }),
      block("c", {
        type: "paragraph",
        attrs: { kind: "callout", fremd: 1 },
        content: [
          { type: "text", text: "rot", marks: [{ type: "textColor", attrs: { color: "rot" } }] },
          { type: "text", text: " " },
          { type: "text", text: "markiert", marks: [{ type: "marker", attrs: { color: "gelb" } }] },
        ],
      }),
      block("d", {
        type: "paragraph",
        attrs: { kind: "unbekannt" },
        content: [{ type: "text", text: "x" }],
      }),
    ],
  };

  it("Absatzart bleibt beim Speichern erhalten, Unbekanntes fällt weg", () => {
    const rows = docToRows(doc);
    expect(rows.map((r) => r.content.attrs ?? null)).toEqual([
      { kind: "h2" },
      { kind: "divider" },
      { kind: "callout" },
      null,
    ]);
    expect(rows[2]?.content.content?.[0]?.marks).toEqual([
      { type: "textColor", attrs: { color: "rot" } },
    ]);
    const back = rowsToDoc(rows);
    expect(back.content?.[0]?.content?.[0]).toEqual({
      type: "paragraph",
      attrs: { kind: "h2" },
      content: [{ type: "text", text: "Beschlüsse" }],
    });
  });

  it("Markdown: Überschrift, Linie, Hinweis, Marker – und zurück", () => {
    const markdown = outlineToMarkdown(doc.content ?? []);
    expect(markdown).toBe("- ## Beschlüsse\n- ---\n- > [!note] rot ==markiert==\n- x");
  });
});
