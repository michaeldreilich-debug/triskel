// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectFiles,
  exportFileName,
  fileExt,
  fileMeta,
  formatBytes,
  isPdf,
} from "@/features/notes/attachments";
import {
  collectImagePaths,
  fitWithin,
  imageFileName,
  isAcceptedImage,
  isHeicFile,
} from "@/features/notes/images";
import { uploadFailedMessage } from "./extensions/media-utils";
import { mermaidFromText } from "./extensions/mermaid";
import { docToRows, inlineText, outlineToMarkdown, rowsToDoc } from "./model/serializer";
import { createTestEditor, cursor, outline, paste, type } from "./test-utils";

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  document.body.innerHTML = "";
});

const mermaidNodes = (e: Editor) => {
  const found: string[] = [];
  e.state.doc.descendants((node) => {
    if (node.type.name === "mermaid") found.push(node.attrs.code as string);
  });
  return found;
};

describe("Mermaid im Outliner (E24)", () => {
  it("erkennt eingefügten Code mit Zaun", () => {
    expect(mermaidFromText("```mermaid\ngraph TD\n  A --> B\n```")).toBe("graph TD\n  A --> B");
    expect(mermaidFromText("  ```mermaid   \nsequenceDiagram\n```  \n")).toBe("sequenceDiagram");
    expect(mermaidFromText("Text davor\n```mermaid\ngraph TD\n```")).toBeNull();
    expect(mermaidFromText("```js\nx\n```")).toBeNull();
  });

  it("Einfügen mit Zaun ergibt ein Diagramm statt Blöcken", () => {
    editor = createTestEditor(outline(["Plan"]));
    cursor(editor, "Plan");
    expect(paste(editor, { text: "```mermaid\ngraph TD\n  A --> B\n```" })).toBe(true);
    expect(mermaidNodes(editor)).toEqual(["graph TD\n  A --> B"]);
    expect(editor.state.doc.childCount).toBe(1);
  });

  it("Tippen im Diagramm-Code steht sofort im Dokument – nichts wartet beim Verlassen (D-6)", () => {
    editor = createTestEditor(outline(["Plan"]));
    cursor(editor, "Plan");
    expect(paste(editor, { text: "```mermaid\ngraph TD\n```" })).toBe(true);
    const textarea = editor.view.dom.querySelector<HTMLTextAreaElement>(".ol-mermaid-code");
    expect(textarea).toBeTruthy();
    (textarea as HTMLTextAreaElement).value = "graph LR\n  A --> B";
    textarea?.dispatchEvent(new Event("input"));
    expect(mermaidNodes(editor)).toEqual(["graph LR\n  A --> B"]);
  });

  it("leeres Diagramm beim Öffnen holt sich keinen Fokus, ein eben eingefügtes schon (O-12)", async () => {
    const doc = (code: string) => ({
      type: "doc",
      content: [
        {
          type: "block",
          content: [{ type: "paragraph", content: [{ type: "mermaid", attrs: { code } }] }],
        },
      ],
    });
    editor = createTestEditor(doc(""));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement?.classList.contains("ol-mermaid-code")).toBe(false);
    editor.destroy();
    editor = createTestEditor(outline(["Plan"]));
    cursor(editor, "Plan");
    editor.commands.insertMermaid();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement?.classList.contains("ol-mermaid-code")).toBe(true);
  });

  it("Wechsel Papier ↔ Dunkel zeichnet Diagramme neu (O-13)", async () => {
    const renderMermaid = vi.fn(async (code: string) => `<svg data-code="${code}"></svg>`);
    editor = createTestEditor(outline(["Plan"]), { renderMermaid });
    cursor(editor, "Plan");
    editor.commands.insertMermaid("graph TD");
    expect(renderMermaid).toHaveBeenCalledTimes(1);
    document.documentElement.dataset.theme = "paper";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderMermaid).toHaveBeenCalledTimes(2);
    delete document.documentElement.dataset.theme;
  });

  it("```mermaid und Leertaste am Anfang eines Punkts legt ein leeres Diagramm an", () => {
    editor = createTestEditor(outline([""]));
    cursor(editor, "", "start");
    type(editor, "```mermaid ");
    expect(mermaidNodes(editor)).toEqual([""]);
  });

  it("Rundreise durch die Zeilen; Suchtext enthält den Code; Markdown als ```mermaid-Block", () => {
    editor = createTestEditor(outline(["Plan"]));
    cursor(editor, "Plan");
    editor.commands.insertMermaid("graph LR\n  X --> Y");
    const rows = docToRows(editor.getJSON());
    expect(rows[0]?.content_text).toBe("PlanDiagramm: graph LR\n  X --> Y");
    const again = rowsToDoc(rows);
    expect(JSON.stringify(again)).toContain('"code":"graph LR\\n  X --> Y"');
    expect(outlineToMarkdown(again.content ?? [])).toBe(
      "- Plan\n  ```mermaid\n  graph LR\n    X --> Y\n  ```",
    );
  });
});

describe("Bilder im Outliner (E24)", () => {
  const withImage = {
    type: "doc",
    content: [
      {
        type: "block",
        attrs: { id: "b1" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "noteImage", attrs: { path: "u/n/abc.png", alt: "Skizze" } }],
          },
        ],
      },
    ],
  };

  it("Bildknoten übersteht Editor und Zeilen; Suchtext nennt den Alternativtext", () => {
    editor = createTestEditor(withImage);
    const rows = docToRows(editor.getJSON());
    expect(rows[0]?.content.content?.[0]).toMatchObject({
      type: "noteImage",
      attrs: { path: "u/n/abc.png", alt: "Skizze" },
    });
    expect(rows[0]?.content_text).toBe("[Bild: Skizze]");
    expect(outlineToMarkdown(rowsToDoc(rows).content ?? [])).toBe("- ![[abc.png]]");
    expect(collectImagePaths(rows.map((r) => r.content))).toEqual(["u/n/abc.png"]);
    // ohne Bildspeicher zeigt die Ansicht einen Hinweis statt eines kaputten Bilds
    expect(editor.view.dom.querySelector(".ol-image")?.textContent).toContain("nicht verfügbar");
  });

  it("Hilfen: Zielgröße, Dateiname", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(imageFileName("u/n/abc.png")).toBe("abc.png");
    expect(inlineText([{ type: "noteImage", attrs: { path: "x", alt: "" } }])).toBe("[Bild]");
  });

  it("iPhone-Fotos (HEIC/HEIF) gelten als Bild – auch ohne Typ, nur mit Endung (#39)", () => {
    const file = (name: string, type = "") => new File(["x"], name, { type });
    expect(isHeicFile(file("IMG_0001.HEIC", "image/heic"))).toBe(true);
    expect(isHeicFile(file("IMG_0002.heif", "image/heif"))).toBe(true);
    expect(isHeicFile(file("IMG_0003.HEIC"))).toBe(true);
    expect(isHeicFile(file("serie", "image/heic-sequence"))).toBe(true);
    expect(isHeicFile(file("foto.jpg", "image/jpeg"))).toBe(false);
    expect(isAcceptedImage(file("IMG_0003.HEIC"))).toBe(true);
    expect(isAcceptedImage(file("plan.pdf", "application/pdf"))).toBe(false);
  });
});

describe("Dateien im Outliner (#27)", () => {
  const withFile = (view: "tile" | "full") => ({
    type: "doc",
    content: [
      {
        type: "block",
        attrs: { id: "b1" },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "noteFile",
                attrs: {
                  path: "u/n/3fa2c1d0-aaaa-bbbb.pdf",
                  name: "Einsatzplan 2026.pdf",
                  size: 2_400_000,
                  mime: "application/pdf",
                  view,
                },
              },
            ],
          },
        ],
      },
    ],
  });

  it("Dateiknoten übersteht Editor und Zeilen; Suchtext nennt den Namen; Export verlinkt bzw. bettet ein", () => {
    editor = createTestEditor(withFile("tile"));
    const rows = docToRows(editor.getJSON());
    expect(rows[0]?.content.content?.[0]).toMatchObject({
      type: "noteFile",
      attrs: { name: "Einsatzplan 2026.pdf", view: "tile" },
    });
    expect(rows[0]?.content_text).toBe("[Datei: Einsatzplan 2026.pdf]");
    expect(outlineToMarkdown(rowsToDoc(rows).content ?? [])).toBe(
      "- [[Einsatzplan 2026-3fa2c1d0.pdf]]",
    );
    expect(collectFiles(rows.map((r) => r.content))).toEqual([
      { path: "u/n/3fa2c1d0-aaaa-bbbb.pdf", name: "Einsatzplan 2026.pdf" },
    ]);
    // ohne Dateispeicher: Hinweis statt Knöpfen ins Leere
    expect(editor.view.dom.querySelector(".ol-file")?.textContent).toContain("nicht verfügbar");

    editor.destroy();
    editor = createTestEditor(withFile("full"));
    const full = docToRows(editor.getJSON());
    expect(outlineToMarkdown(rowsToDoc(full).content ?? [])).toBe(
      "- ![[Einsatzplan 2026-3fa2c1d0.pdf]]",
    );
  });

  it("Hilfen: Größe, Kurzbeschreibung, Endung, PDF erkennen", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(820 * 1024)).toBe("820 KB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2,4 MB");
    expect(formatBytes(24 * 1024 * 1024)).toBe("24 MB");
    expect(fileMeta({ name: "plan.pdf", size: 2048, mime: "application/pdf" })).toBe("PDF · 2 KB");
    expect(fileMeta({ name: "Bericht.DOCX", size: 2048, mime: "" })).toBe("DOCX · 2 KB");
    expect(fileMeta({ name: "ohne", size: 10, mime: "" })).toBe("Datei · 10 B");
    expect(fileExt("a.tar.GZ")).toBe("gz");
    expect(fileExt("komisch.<script>")).toBe("bin");
    expect(isPdf({ name: "x.PDF", mime: "" })).toBe(true);
    expect(isPdf({ name: "x.txt", mime: "text/plain" })).toBe(false);
    expect(exportFileName("u/n/12345678-x.pdf", 'a/b:c*?"d.pdf')).toBe("a b c d-12345678.pdf");
  });

  it("Meldung nach gescheitertem Hochladen nennt den Grund (#72)", () => {
    expect(uploadFailedMessage("a.xlsx", new TypeError("Failed to fetch"))).toBe(
      "„a.xlsx“ kam nicht beim Speicher an – die Verbindung brach unterwegs ab (Netzwerk, Firmen-Proxy oder Sicherheitssoftware?).",
    );
    const refused = Object.assign(new Error("Payload too large"), { status: 413 });
    expect(uploadFailedMessage("a.xlsx", refused)).toBe(
      "„a.xlsx“ konnte nicht hochgeladen werden – der Speicher lehnte ab (413: Payload too large).",
    );
  });
});
