import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { MERMAID } from "../model/names";
import { updateNodeAttrs } from "./media-utils";

export interface MermaidOptions {
  /** Diagramm zeichnen (lädt Mermaid nach); ohne: nur der Code */
  render: ((code: string) => Promise<string>) | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaid: {
      /** Diagramm an der Auswahl einfügen (leer: Bearbeiten öffnet sich) */
      insertMermaid: (code?: string) => ReturnType;
    };
  }
}

/** ```mermaid … ``` als ganzer eingefügter Text (z. B. aus Claude oder ChatGPT kopiert). */
export function mermaidFromText(text: string): string | null {
  const match = /^\s*```mermaid[^\S\n]*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return match ? (match[1] ?? "").trim() : null;
}

/**
 * Mermaid-Diagramm als atomarer Knoten im Absatz: der Code ist das Attribut (durchsuchbar, im
 * Export ein ```mermaid-Block), die App zeichnet. Einfügen: ```mermaid tippen und Leertaste,
 * Code mit Zaun einfügen, oder per Rechtsklick-Menü.
 */
export const Mermaid = Node.create<MermaidOptions>({
  name: MERMAID,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  // vor dem Outline-Einfügen (Priorität 1000), das mehrzeiligen Text in Blöcke zerlegt
  priority: 1050,

  addOptions() {
    return { render: null };
  },

  addAttributes() {
    return { code: { default: "" } };
  },

  addStorage() {
    // nur ein eben eingefügtes leeres Diagramm holt sich den Fokus – nicht eines, das beim
    // Öffnen der Notiz schon leer dastand (am iPhone ginge sonst die Tastatur auf, O-12)
    return { focusNext: false };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mermaid"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes({ "data-type": "mermaid" }, HTMLAttributes),
      `\`\`\`mermaid\n${node.attrs.code}\n\`\`\``,
    ];
  },

  renderText({ node }) {
    return `\`\`\`mermaid\n${node.attrs.code}\n\`\`\``;
  },

  addCommands() {
    return {
      insertMermaid:
        (code = "") =>
        ({ commands }) => {
          this.storage.focusNext = !code.trim();
          return commands.insertContent({ type: MERMAID, attrs: { code } });
        },
    };
  },

  addInputRules() {
    const storage = this.storage;
    return [
      new InputRule({
        find: /^```mermaid\s$/,
        handler: ({ state, range }) => {
          storage.focusNext = true;
          const node = state.schema.nodes[MERMAID]?.create({ code: "" });
          if (node) state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },

  addNodeView() {
    const { render } = this.options;
    return ({ node: initialNode, getPos, editor }) => {
      let node: PMNode = initialNode;
      let editing = false;
      let rendered: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const dom = document.createElement("span");
      dom.className = "ol-media ol-mermaid";
      dom.dataset.type = "mermaid";
      dom.contentEditable = "false";

      const bar = document.createElement("span");
      bar.className = "ol-media-bar";
      const label = document.createElement("span");
      label.textContent = "Diagramm";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "ol-media-button";
      bar.append(label, toggle);

      const view = document.createElement("span");
      view.className = "ol-mermaid-view";
      view.setAttribute("role", "img");
      const textarea = document.createElement("textarea");
      textarea.className = "ol-mermaid-code";
      textarea.spellcheck = false;
      textarea.setAttribute("aria-label", "Mermaid-Code");
      textarea.placeholder = "graph TD\n  A[Start] --> B[Ziel]";
      dom.append(bar, view, textarea);

      const commit = () => {
        if (editor.isDestroyed || textarea.value === node.attrs.code) return;
        // nur, wenn an der Stelle noch dieses Diagramm steht (nicht gelöscht oder verschoben)
        updateNodeAttrs(editor.view, getPos, MERMAID, { code: textarea.value });
      };

      const draw = () => {
        const code = (node.attrs.code as string).trim();
        if (code === rendered) return;
        rendered = code;
        view.setAttribute(
          "aria-label",
          code ? `Diagramm: ${code.split("\n")[0]}` : "Leeres Diagramm",
        );
        if (!code) {
          view.textContent = "Leeres Diagramm – Code eingeben";
          view.classList.add("is-empty");
          return;
        }
        view.classList.remove("is-empty", "is-error");
        if (!render) {
          view.textContent = code;
          return;
        }
        view.textContent = "Diagramm wird gezeichnet …";
        render(code)
          .then((svg) => {
            if (rendered !== code) return;
            view.innerHTML = svg;
          })
          .catch((error: unknown) => {
            if (rendered !== code) return;
            view.classList.add("is-error");
            const message = error instanceof Error ? error.message.split("\n")[0] : "";
            view.textContent = `Diagramm fehlerhaft${message ? `: ${message}` : ""}`;
          });
      };

      const setEditing = (next: boolean, focus = true) => {
        const was = editing;
        editing = next;
        dom.classList.toggle("is-editing", next);
        toggle.textContent = next ? "Fertig" : "Bearbeiten";
        toggle.setAttribute("aria-expanded", String(next));
        textarea.hidden = !next;
        if (next) {
          textarea.value = node.attrs.code;
          if (focus) setTimeout(() => textarea.focus(), 0);
        } else if (was) {
          commit();
          if (timer) clearTimeout(timer);
          timer = null;
          draw();
        }
      };

      toggle.addEventListener("click", () => setEditing(!editing));
      // jede Eingabe gleich ins Dokument: der Editor entprellt das Speichern selbst und übernimmt
      // es vor dem Verlassen der Seite (D-6); entprellt wird hier nur das Zeichnen
      textarea.addEventListener("input", commit);
      textarea.addEventListener("blur", commit);
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
          event.preventDefault();
          setEditing(false);
          editor.commands.focus();
        }
      });

      textarea.value = node.attrs.code;
      draw();
      const storage = editor.storage as unknown as Record<string, { focusNext?: boolean }>;
      const justInserted = Boolean(storage[MERMAID]?.focusNext);
      if (storage[MERMAID]) storage[MERMAID].focusNext = false;
      setEditing(!(node.attrs.code as string).trim(), justInserted);

      // Papier ↔ Dunkel: mit dem neuen Theme neu zeichnen (O-13)
      const themeObserver = new MutationObserver(() => {
        rendered = null;
        draw();
      });
      themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });

      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          if (!editing) {
            textarea.value = node.attrs.code;
            draw();
          } else {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              draw();
            }, 400);
          }
          return true;
        },
        selectNode: () => dom.classList.add("is-selected"),
        deselectNode: () => dom.classList.remove("is-selected"),
        // Eingaben im Code-Feld und Klicks auf den Knopf gehören dem Diagramm, nicht dem Editor
        stopEvent: (event) => event.target === textarea || event.target === toggle,
        ignoreMutation: () => true,
        destroy: () => {
          if (timer) clearTimeout(timer);
          themeObserver.disconnect();
        },
      };
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("mermaidPaste"),
        props: {
          handlePaste: (view, event) => {
            const code = mermaidFromText(event.clipboardData?.getData("text/plain") ?? "");
            if (code === null) return false;
            const node = view.state.schema.nodes[MERMAID]?.create({ code });
            if (!node) return false;
            view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
