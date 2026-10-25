// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createTestEditor, outline } from "../test-utils";
import { findWebLinks } from "./web-links";

const hrefs = (text: string) => findWebLinks(text).map((link) => link.href);

describe("Web-Adressen im Text (#93)", () => {
  it("erkennt Adressen mit und ohne Schema", () => {
    expect(hrefs("siehe https://claude.ai/code/artifact/abc-1 dort")).toEqual([
      "https://claude.ai/code/artifact/abc-1",
    ]);
    expect(hrefs("dwd.de und meteoschweiz.admin.ch")).toEqual([
      "https://dwd.de/",
      "https://meteoschweiz.admin.ch/",
    ]);
    expect(hrefs("www.elster.de/start")).toEqual(["https://www.elster.de/start"]);
    expect(hrefs("Mail an info@beispiel-verein.de bitte")).toEqual([
      "mailto:info@beispiel-verein.de",
    ]);
  });

  it("Satzzeichen am Ende gehören nicht zur Adresse", () => {
    expect(hrefs("Siehe https://dwd.de/foo.")).toEqual(["https://dwd.de/foo"]);
    expect(findWebLinks("Siehe https://dwd.de/foo.")[0]).toMatchObject({ from: 6, to: 24 });
  });

  it("Dateinamen und Zahlen sind keine Links", () => {
    expect(hrefs("Bericht.pdf, notes.md, build.sh, App.zip und script.py")).toEqual([]);
    expect(hrefs("Version 1.2.3 kostet 4.50 Euro")).toEqual([]);
    expect(hrefs("Text ohne Adresse")).toEqual([]);
  });

  it("andere Schemata werden nie klickbar", () => {
    expect(hrefs("javascript:alert(1) und ftp://x.de/datei")).toEqual([]);
  });
});

describe("AutoLinks in den Editoren", () => {
  let editor: ReturnType<typeof createTestEditor> | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
    document.body.innerHTML = "";
  });

  it("zeigt den Text als Link, ohne den Inhalt zu ändern", () => {
    editor = createTestEditor(outline(["Infos unter https://dwd.de/formular, Datei Bericht.pdf"]));
    const before = JSON.stringify(editor.getJSON());
    const anchors = editor.view.dom.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://dwd.de/formular");
    expect(anchors[0]?.getAttribute("target")).toBe("_blank");
    expect(anchors[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchors[0]?.textContent).toBe("https://dwd.de/formular");
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });

  it("neu getippte Adresse ist sofort klickbar, auch ohne Leerzeichen danach", () => {
    editor = createTestEditor(outline([""]));
    editor.commands.insertContent("dwd.de");
    expect(editor.view.dom.querySelectorAll("a")).toHaveLength(1);
  });
});
