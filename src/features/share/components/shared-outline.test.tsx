import type { JSONContent } from "@tiptap/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sharedDoc } from "../model";
import { SharedOutline } from "./shared-outline";

const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
const USER = "0b1f7a3e-1111-4222-8333-444455556666";
const NOTE = "5d3f9c5a-1111-4222-8333-444455556666";
const IMAGE = `${USER}/${NOTE}/7e4a0d6b-1111-4222-8333-444455556666.png`;
const PDF = `${USER}/${NOTE}/8f5b1e7c-1111-4222-8333-444455556666.pdf`;

let sort = 0;
const block = (
  id: string,
  content: JSONContent[],
  extra: { parent?: string; collapsed?: boolean; done?: boolean | null; kind?: string } = {},
) => ({
  id,
  parent_id: extra.parent ?? null,
  sort: `a${sort++}`,
  collapsed: extra.collapsed ?? false,
  content: { type: "paragraph", ...(extra.kind ? { attrs: { kind: extra.kind } } : {}), content },
  task_done: extra.done ?? null,
});
const t = (text: string, marks?: JSONContent["marks"]) => ({ type: "text", text, marks });

function render(blocks: ReturnType<typeof block>[]): string {
  const { doc, taskDone } = sharedDoc({ title: "Notiz", blocks });
  return renderToStaticMarkup(<SharedOutline doc={doc} taskDone={taskDone} token={TOKEN} />);
}

describe("Darstellung der freigegebenen Notiz (#94)", () => {
  it("Marken: fett, kursiv, durchgestrichen, Code, Marker, Textfarbe nur als Token-Schlüssel", () => {
    const html = render([
      block("a", [
        t("fett", [{ type: "bold" }]),
        t("kursiv", [{ type: "italic" }]),
        t("weg", [{ type: "strike" }]),
        t("code()", [{ type: "code" }]),
        t("gelb", [{ type: "marker", attrs: { color: "gruen" } }]),
        t("rot", [{ type: "textColor", attrs: { color: "rot" } }]),
        t("böse", [{ type: "textColor", attrs: { color: "red;background:url(x)" } }]),
      ]),
    ]);
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<s>weg</s>");
    expect(html).toContain("<code>code()</code>");
    expect(html).toContain('<mark class="tx-marker" data-marker="gruen">gelb</mark>');
    expect(html).toContain('<span class="tx-color" data-color="rot">rot</span>');
    expect(html).not.toContain("background:url");
    expect(html).toContain("böse");
  });

  it("Links nur http(s)/mailto, neuer Tab ohne Referer; javascript: und data: werden nie ein Link", () => {
    const html = render([
      block("a", [
        t("gut", [{ type: "link", attrs: { href: "https://example.com/a?b=1" } }]),
        t("mail", [{ type: "link", attrs: { href: "mailto:a@example.com" } }]),
        t("böse", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
        t("daten", [{ type: "link", attrs: { href: "data:text/html,<script>x</script>" } }]),
        t("leer", [{ type: "link", attrs: {} }]),
      ]),
    ]);
    expect(html).toContain(
      '<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer nofollow">',
    );
    expect(html).toContain('href="mailto:a@example.com"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain("böse");
  });

  it("Adressen ohne Link-Markierung sind klickbar wie in der App (#93), Dateinamen und Code nicht", () => {
    const html = render([
      block("a", [t("Infos unter dwd.de und https://example.com/x, Datei Bericht.pdf ")]),
      block("b", [t("dwd.de", [{ type: "code" }])]),
    ]);
    expect(html).toContain('<a href="https://dwd.de/" target="_blank"');
    expect(html).toContain('<a href="https://example.com/x" target="_blank"');
    expect(html).toContain("Bericht.pdf");
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain("<code>dwd.de</code>");
  });

  it("nie rohes HTML aus dem Inhalt", () => {
    const html = render([block("a", [t('<script>alert("x")</script><img src=x onerror=1>')])]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("verknüpfte Notiz ohne Titel und Link, #tag als Text", () => {
    const html = render([
      block("a", [
        t("Siehe "),
        { type: "noteLink", attrs: { noteId: NOTE } },
        { type: "tag", attrs: { name: "beruf" } },
      ]),
    ]);
    expect(html).toContain('<span class="sn-muted">verknüpfte Notiz</span>');
    expect(html).not.toContain(NOTE);
    expect(html).toContain('<span class="sn-tag">#beruf</span>');
  });

  it("Bilder und Dateien über die Freigabe-Route; fremd aussehende Pfade werden kein Abruf", () => {
    const html = render([
      block("a", [
        { type: "noteImage", attrs: { path: IMAGE, alt: "Plan", width: 50 } },
        { type: "noteFile", attrs: { path: PDF, name: "Plan.pdf" } },
        { type: "noteImage", attrs: { path: "../../etc/passwd", alt: "kaputt" } },
        { type: "noteFile", attrs: { path: "https://evil.example/x", name: "Fremd" } },
      ]),
    ]);
    const src = `/api/freigabe/${TOKEN}/datei?pfad=${encodeURIComponent(IMAGE)}`;
    expect(html).toContain(`src="${src.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('alt="Plan"');
    expect(html).toContain("width:50%");
    expect(html).toContain(
      `href="/api/freigabe/${TOKEN}/datei?pfad=${encodeURIComponent(PDF)}&amp;name=Plan.pdf"`,
    );
    expect(html).toContain("„Plan.pdf“ öffnen");
    expect(html).toContain("[Bild: kaputt]");
    expect(html).toContain("[Datei: Fremd]");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("passwd");
  });

  it("Mermaid als Code-Block, Absatzarten als Überschrift/Zitat/Hinweis/Linie", () => {
    const html = render([
      block("a", [t("Ablauf"), { type: "mermaid", attrs: { code: "graph TD\n  A-->B" } }]),
      block("h", [t("Titel")], { kind: "h1" }),
      block("h3", [t("Klein")], { kind: "h3" }),
      block("q", [t("Zitat")], { kind: "quote" }),
      block("c", [t("Hinweis")], { kind: "callout" }),
      block("d", [], { kind: "divider" }),
    ]);
    expect(html).toContain(
      '<figure class="sn-diagram" aria-label="Diagramm (Mermaid)"><pre class="sn-code"><code>graph TD\n  A--&gt;B</code></pre></figure>',
    );
    expect(html).toContain('<h2 class="sn-p" data-kind="h1">');
    expect(html).toContain('<h4 class="sn-p" data-kind="h3">');
    expect(html).toContain('<blockquote class="sn-p" data-kind="quote">');
    expect(html).toContain('data-kind="callout" role="note"');
    expect(html).toContain("<hr/>");
  });

  it("Aufgaben als deaktiviertes Kästchen; Eingeklapptes als <details>, Aufgeklapptes als Liste", () => {
    const html = render([
      block("o", [t("offen")], { done: false }),
      block("e", [t("erledigt")], { done: true }),
      block("p", [t("Eltern zu")], { collapsed: true }),
      block("k1", [t("Kind 1")], { parent: "p" }),
      block("k2", [t("Kind 2")], { parent: "p" }),
      block("q", [t("Eltern offen")]),
      block("k3", [t("Kind 3")], { parent: "q" }),
    ]);
    expect(html).toContain(
      '<input type="checkbox" class="sn-check" disabled="" aria-label="Offen"/>',
    );
    expect(html).toMatch(
      /<input type="checkbox" class="sn-check"[^>]*checked=""[^>]*aria-label="Erledigt"|<input type="checkbox" class="sn-check"[^>]*aria-label="Erledigt"[^>]*checked=""/,
    );
    expect(html).toContain('data-task="done"');
    expect(html).toMatch(
      /<details class="sn-fold"><summary>2 Unterpunkte<\/summary><ul class="sn-list">.*Kind 1.*Kind 2.*<\/ul><\/details>/,
    );
    expect(html).toMatch(/Eltern offen<\/span><\/div><\/div><ul class="sn-list"><li[^>]*>.*Kind 3/);
  });
});
