import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findWebLinks } from "../model/web-links";

const key = new PluginKey<DecorationSet>("autoLinks");

/**
 * Web-Adressen im Text immer klickbar (#93), egal wie sie hineinkamen (KI, Einfügen, ältere
 * Daten). Nur Darstellung: Inline-Decorations ohne Link-Markierung – der Inhalt wird nie
 * umgeschrieben (Öffnen ändert nichts, Speichern bleibt unberührt). Tiptaps Klick-Handler findet
 * das `<a>` und öffnet es im neuen Tab. Text mit Link-Markierung oder Code bleibt, wie er ist.
 */
export const AutoLinks = Extension.create({
  name: "autoLinks",

  addProseMirrorPlugins() {
    const build = (doc: Parameters<typeof DecorationSet.create>[0]) => {
      const decorations: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        if (node.marks.some((mark) => mark.type.name === "link" || mark.type.name === "code"))
          return;
        for (const { from, to, href } of findWebLinks(node.text)) {
          decorations.push(
            Decoration.inline(pos + from, pos + to, {
              nodeName: "a",
              href,
              target: "_blank",
              rel: "noopener noreferrer",
              class: "auto-link",
            }),
          );
        }
      });
      return DecorationSet.create(doc, decorations);
    };
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});
