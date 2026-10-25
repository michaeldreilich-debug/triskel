import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { parseInline, parseOutlineText } from "./paste";

const shape = (blocks: JSONContent[], depth = 0): string[] =>
  blocks.flatMap((b) => {
    const [p, ...children] = b.content ?? [];
    const text = (p?.content ?? [])
      .map((n) => (n.type === "text" ? n.text : `<${n.type}>`))
      .join("");
    return [`${"  ".repeat(depth)}${text}`, ...shape(children, depth + 1)];
  });

describe("Paste-Parser", () => {
  it("Markdown-Liste mit Leerzeichen-Einrückung", () => {
    expect(shape(parseOutlineText("- A\n  - A1\n    - A1a\n- B"))).toEqual([
      "A",
      "  A1",
      "    A1a",
      "B",
    ]);
  });

  it("Tabs, Nummerierung, Checkboxen, Leerzeilen, Grundeinrückung", () => {
    const text = "    1. Eins\n\t\t- [ ] Zwei\n\n    2) Drei\n    * [x] Vier";
    expect(shape(parseOutlineText(text))).toEqual(["Eins", "  Zwei", "Drei", "Vier"]);
  });

  it("einfache Zeilen ohne Markierung werden Blöcke auf einer Ebene", () => {
    expect(shape(parseOutlineText("Anlass\r\nTeilnehmende\nThemen"))).toEqual([
      "Anlass",
      "Teilnehmende",
      "Themen",
    ]);
  });

  it("Überschriften werden Überschriften (#40), Blöcke haben noch keine ID", () => {
    const [block] = parseOutlineText("## Beschlüsse\n- x");
    expect(block?.attrs?.id).toBeNull();
    expect(block?.content?.[0]).toEqual({
      type: "paragraph",
      attrs: { kind: "h2" },
      content: [{ type: "text", text: "Beschlüsse" }],
    });
  });

  it("Zitat, Hinweis-Kasten, Trennlinie und Überschrift im Listenpunkt (Export-Form, #40)", () => {
    const blocks = parseOutlineText(
      "- # Titel\n- > Zitat\n- > [!note] Wichtig\n- ---\n- #### tief\n- normal",
    );
    expect(blocks.map((b) => b.content?.[0]?.attrs?.kind ?? null)).toEqual([
      "h1",
      "quote",
      "callout",
      "divider",
      "h3",
      null,
    ]);
    expect(blocks[2]?.content?.[0]?.content).toEqual([{ type: "text", text: "Wichtig" }]);
    expect(blocks[3]?.content?.[0]?.content).toBeUndefined();
  });

  it("leerer Text ergibt nichts", () => {
    expect(parseOutlineText("  \n\n ")).toEqual([]);
  });
});

describe("Inline-Markdown", () => {
  it("==Marker== wird gelb markiert (#40)", () => {
    expect(parseInline("vor ==wichtig== nach")).toEqual([
      { type: "text", text: "vor " },
      { type: "text", text: "wichtig", marks: [{ type: "marker", attrs: { color: "gelb" } }] },
      { type: "text", text: " nach" },
    ]);
  });

  it("fett, kursiv, Code, durchgestrichen, Link", () => {
    expect(parseInline("**f** *k* `c` ~~d~~ [L](https://example.org)")).toEqual([
      { type: "text", text: "f", marks: [{ type: "bold" }] },
      { type: "text", text: " " },
      { type: "text", text: "k", marks: [{ type: "italic" }] },
      { type: "text", text: " " },
      { type: "text", text: "c", marks: [{ type: "code" }] },
      { type: "text", text: " " },
      { type: "text", text: "d", marks: [{ type: "strike" }] },
      { type: "text", text: " " },
      {
        type: "text",
        text: "L",
        marks: [{ type: "link", attrs: { href: "https://example.org" } }],
      },
    ]);
  });

  it("[[bekannte Notiz]] wird Link, unbekannte bleibt Text; #tag wird Tag", () => {
    const resolve = (title: string) => (title === "Wartungsplan" ? "n1" : undefined);
    expect(
      parseInline("[[Wartungsplan]] und [[Unbekannt]] #pa", { resolveNoteByTitle: resolve }),
    ).toEqual([
      { type: "noteLink", attrs: { noteId: "n1" } },
      { type: "text", text: " und [[Unbekannt]] " },
      { type: "tag", attrs: { name: "pa" } },
    ]);
  });

  it("kein Tag mitten im Wort, keine Kursivschrift bei 2 * 3", () => {
    expect(parseInline("Issue#12 und 2 * 3 * 4")).toEqual([
      { type: "text", text: "Issue#12 und 2 * 3 * 4" },
    ]);
  });
});

describe("Paste-Parser: Checkboxen, Code, Tags (KI-Schnittstelle #33)", () => {
  it("Checkbox-Zeilen werden mit Rückruf Aufgaben-Blöcke (Titel als Klartext)", () => {
    const seen: Array<[string, boolean]> = [];
    const blocks = parseOutlineText("- [ ] **Beleg** Arzt\n- [x] Steuer #privat\n- normal", {
      onTask: (title, done) => {
        seen.push([title, done]);
        return `task-${seen.length}`;
      },
    });
    expect(seen).toEqual([
      ["Beleg Arzt", false],
      ["Steuer #privat", true],
    ]);
    expect(blocks.map((b) => b.attrs?.taskId)).toEqual(["task-1", "task-2", null]);
    expect(shape(blocks)).toEqual(["Beleg Arzt", "Steuer <tag>", "normal"]);
  });

  it("tags: false lässt #wort als Text stehen", () => {
    expect(parseInline("Termin #privat", { tags: false })).toEqual([
      { type: "text", text: "Termin #privat" },
    ]);
  });

  it("Mermaid unter einem Listenpunkt landet im selben Block (Export-Form)", () => {
    const text = "- Ablauf\n  ```mermaid\n  graph TD\n    A --> B\n  ```\n- Danach";
    const blocks = parseOutlineText(text);
    expect(shape(blocks)).toEqual(["Ablauf<mermaid>", "Danach"]);
    const diagram = blocks[0]?.content?.[0]?.content?.[1];
    expect(diagram).toEqual({ type: "mermaid", attrs: { code: "graph TD\n  A --> B" } });
  });

  it("Mermaid ohne Listenpunkt wird ein eigener Block, anderer Code eine Zeile je Block", () => {
    const text = "```mermaid\ngraph LR\n\nA-->B\n```\n```js\nconst a = 1;\n\nlet b;\n```";
    const blocks = parseOutlineText(text);
    expect(shape(blocks)).toEqual(["<mermaid>", "const a = 1;", "let b;"]);
    expect(blocks[0]?.content?.[0]?.content?.[0]?.attrs?.code).toBe("graph LR\n\nA-->B");
    expect(blocks[1]?.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "code" }]);
  });
});
