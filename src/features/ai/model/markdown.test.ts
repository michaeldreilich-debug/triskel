import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { outlineToMarkdown, rowsToDoc } from "@/features/outliner/model/serializer";
import { existingMediaResolver, mediaRefOf } from "./media-refs";
import { lastTopSort, markdownToNoteRows } from "./note-markdown";
import {
  appendTaskNodes,
  markdownToTaskNodes,
  taskBodyText,
  taskBodyToMarkdown,
} from "./task-markdown";

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("Notiz: Markdown → Blöcke (KI-Schnittstelle #33)", () => {
  it("baut den Baum mit neuen IDs; Lesen über den Export ergibt dieselbe Liste", () => {
    const markdown = "- Anlass\n  - Wer: [[Atemschutz]]\n- Beschlüsse #job\n- [ ] Termin klären";
    const plan = markdownToNoteRows(markdown, {
      newId: ids(),
      resolveNoteByTitle: (title) => (title === "Atemschutz" ? "note-7" : undefined),
      resolveTitle: (id) => (id === "note-7" ? "Atemschutz" : undefined),
    });
    expect(plan.rows.map((r) => [r.id, r.parent_id, r.content_text])).toEqual([
      ["id-2", null, "Anlass"],
      ["id-3", "id-2", "Wer: [[Atemschutz]]"],
      ["id-4", null, "Beschlüsse #job"],
      ["id-5", null, "Termin klären"],
    ]);
    expect(plan.tasks).toEqual([{ id: "id-1", title: "Termin klären", done: false }]);
    expect(plan.rows[3]?.task_id).toBe("id-1");
    const back = outlineToMarkdown(rowsToDoc(plan.rows).content ?? [], {
      resolveTitle: () => "Atemschutz",
      taskDone: () => false,
    });
    expect(back).toBe(markdown);
  });

  it("hängt oben hinter den letzten vorhandenen Block an", () => {
    const existing = [
      { parent_id: null, sort: "a0", deleted_at: null },
      { parent_id: null, sort: "a5", deleted_at: "2026-10-17" },
      { parent_id: "x", sort: "b9", deleted_at: null },
      { parent_id: null, sort: "a2", deleted_at: null },
    ];
    expect(lastTopSort(existing)).toBe("a2");
    const plan = markdownToNoteRows("Eins\nZwei", { newId: ids(), afterSort: "a2" });
    const keys = plan.rows.map((r) => r.sort);
    expect(keys.every((k) => k > "a2")).toBe(true);
    expect([...keys].sort()).toEqual(keys);
  });

  it("leerer Text ergibt keine Zeilen", () => {
    expect(markdownToNoteRows(" \n\n", { newId: ids() })).toEqual({ rows: [], tasks: [] });
  });
});

describe("Aufgaben-Notiz: Markdown ↔ Dokument", () => {
  const doc = (content: JSONContent[]): JSONContent => ({ type: "doc", content });

  it("Absätze, Checkliste, Liste; keine Tags; Rückweg gleich", () => {
    const markdown =
      "Vorher klären\n- [ ] Leiter #privat\n- [x] Termin\n- Hinweis\n1. Erst\n2. Dann";
    const nodes = markdownToTaskNodes(markdown);
    expect(nodes.map((n) => n.type)).toEqual([
      "paragraph",
      "taskList",
      "bulletList",
      "orderedList",
    ]);
    expect(nodes[1]?.content?.map((i) => i.attrs?.checked)).toEqual([false, true]);
    expect(JSON.stringify(nodes)).not.toContain('"tag"');
    expect(taskBodyToMarkdown(doc(nodes))).toBe(markdown);
  });

  it("body_text wie im Editor: Zeilen, Notiz-Links als Titel", () => {
    const nodes = markdownToTaskNodes("Siehe [[Plan]]\n\n- [ ] Milch", {
      resolveNoteByTitle: () => "n1",
    });
    expect(taskBodyText(doc(nodes), { resolveTitle: () => "Plan" })).toBe("Siehe Plan\nMilch");
  });

  it("Anhängen setzt eine Checkliste am Ende fort und ersetzt eine leere Notiz", () => {
    const body = doc(markdownToTaskNodes("Einkauf\n- [ ] Milch"));
    const next = appendTaskNodes(body, markdownToTaskNodes("- [ ] Brot\nDanach"));
    expect(taskBodyToMarkdown(next)).toBe("Einkauf\n- [ ] Milch\n- [ ] Brot\nDanach");
    const empty = appendTaskNodes(doc([{ type: "paragraph" }]), markdownToTaskNodes("Neu"));
    expect(empty.content).toHaveLength(1);
    expect(appendTaskNodes(null, markdownToTaskNodes("A")).content).toHaveLength(1);
  });
});

describe("Aufgaben-Notiz: mehr Formatierung (#40)", () => {
  it("Überschrift, Zitat, Linie und Marker hin und zurück", () => {
    const markdown = "## Stand\n> Zitat\n---\n==wichtig==\n- [ ] Punkt";
    const nodes = markdownToTaskNodes(markdown);
    expect(nodes.slice(0, 3).map((n) => n.attrs?.kind)).toEqual(["h2", "quote", "divider"]);
    expect(taskBodyToMarkdown({ type: "doc", content: nodes })).toBe(markdown);
  });
});

describe("Bilder und Dateien bleiben beim Ersetzen (O8, Regel 1)", () => {
  const USER = "00000000-0000-4000-8000-0000000000aa";
  const image: JSONContent = {
    type: "noteImage",
    attrs: {
      path: `${USER}/note-1/1a2b3c4d-0000-4000-8000-000000000001.png`,
      alt: "Namensliste",
      width: 320,
      crop: { x: 0.1, y: 0, w: 0.8, h: 1 },
    },
  };
  const file: JSONContent = {
    type: "noteFile",
    attrs: {
      path: `${USER}/note-1/9f8e7d6c-0000-4000-8000-000000000002.pdf`,
      name: "Grüße März.pdf",
      size: 1234,
      mime: "application/pdf",
      view: "full",
    },
  };
  const tile: JSONContent = {
    type: "noteFile",
    attrs: {
      ...file.attrs,
      path: `${USER}/note-1/5555aaaa-0000-4000-8000-000000000003.txt`,
      name: "Liste.txt",
      mime: "text/plain",
      view: "tile",
    },
  };
  const block = (id: string, content: JSONContent[]): JSONContent => ({
    type: "block",
    attrs: { id, collapsed: false, taskId: null },
    content: [{ type: "paragraph", content }],
  });
  const media = (nodes: JSONContent[] | undefined) =>
    (nodes ?? []).filter((n) => n.type === "noteImage" || n.type === "noteFile");

  it("Notiz: fetch → ersetzen mit demselben Text ergibt dieselben Bild-/Datei-Knoten", () => {
    const blocks = [
      block("b1", [{ type: "text", text: "Liste vom Einsatz" }]),
      block("b2", [image]),
      block("b3", [{ type: "text", text: "Beleg " }, file, { type: "text", text: " und " }, tile]),
    ];
    const markdown = outlineToMarkdown(blocks);
    expect(markdown).toContain(`![[${mediaRefOf(image)}]]`);
    expect(markdown).toContain("![[Grüße März-9f8e7d6c.pdf]]");
    expect(markdown).toContain("[[Liste-5555aaaa.txt]]");
    const plan = markdownToNoteRows(markdown, {
      newId: ids(),
      resolveMedia: existingMediaResolver(blocks.map((b) => b.content?.[0])),
    });
    expect(media(plan.rows[1]?.content.content)).toEqual([image]);
    expect(plan.rows[2]?.content.content).toEqual([
      { type: "text", text: "Beleg " },
      file,
      { type: "text", text: " und " },
      tile,
    ]);
    expect(outlineToMarkdown(rowsToDoc(plan.rows).content ?? [])).toBe(markdown);
  });

  it("Aufgabe/Projekt-Freitext: Rundweg über taskBodyToMarkdown", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Foto:" }] },
        { type: "paragraph", content: [image] },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [tile] }] }],
        },
      ],
    };
    const markdown = taskBodyToMarkdown(body);
    const nodes = markdownToTaskNodes(markdown, { resolveMedia: existingMediaResolver([body]) });
    expect(nodes).toEqual(body.content);
  });

  it("nur Bilder und Dateien, die schon im Eintrag stehen – fremde Verweise bleiben Text", () => {
    const resolve = existingMediaResolver([{ type: "paragraph", content: [image] }]);
    const foreign = `![[${USER.replace("aa", "bb")}/note-1/x.png]] ![[fremd.png]] [[../../${mediaRefOf(image)}]]`;
    const nodes = markdownToTaskNodes(foreign, { resolveMedia: resolve });
    expect(JSON.stringify(nodes)).not.toContain("noteImage");
    // derselbe Verweis zweimal: zwei unabhängige Kopien
    const twice = markdownToTaskNodes(`![[${mediaRefOf(image)}]] ![[${mediaRefOf(image)}]]`, {
      resolveMedia: resolve,
    });
    const [a, , b] = twice[0]?.content ?? [];
    expect(a).toEqual(image);
    expect(b).toEqual(image);
    expect(a).not.toBe(b);
    // ohne Bilder im Eintrag gibt es keinen Auflöser
    expect(
      existingMediaResolver([{ type: "paragraph", content: [{ type: "text", text: "x" }] }]),
    ).toBeUndefined();
  });
});
