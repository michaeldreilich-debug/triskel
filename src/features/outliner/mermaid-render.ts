/**
 * Mermaid-Diagramme zeichnen (E24): Die Bibliothek wird erst geladen, wenn ein Diagramm
 * angezeigt wird. securityLevel „strict“: keine Klick-Handler, Beschriftungen ohne HTML; das
 * erzeugte SVG bereinigt Mermaid selbst (DOMPurify).
 */
type MermaidApi = typeof import("mermaid").default;

let api: Promise<MermaidApi> | null = null;
let theme: string | null = null;
let counter = 0;

const currentTheme = () =>
  document.documentElement.dataset.theme === "paper" ? "neutral" : "dark";

async function load(): Promise<MermaidApi> {
  api ??= import("mermaid").then((m) => m.default);
  const mermaid = await api;
  const wanted = currentTheme();
  if (theme !== wanted) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: wanted });
    theme = wanted;
  }
  return mermaid;
}

export async function renderMermaid(code: string): Promise<string> {
  const mermaid = await load();
  counter += 1;
  const id = `mermaid-${counter}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    // bei Syntaxfehlern lässt Mermaid ein Hilfselement im body stehen
    document.getElementById(`d${id}`)?.remove();
  }
}
