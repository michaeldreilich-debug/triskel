import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { TAG } from "../model/names";

export const TAG_NAME = /^[\p{L}\p{N}_-]{1,50}$/u;

/** Inline-Tag (#tag). Wird beim Speichern zu notes.tags hinzugefügt (E14, DB-Trigger). */
export const Tag = Node.create({
  name: TAG,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-name") ?? "",
        renderHTML: (attrs) => ({ "data-name": attrs.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="tag"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "tag", class: "ol-tag" }, HTMLAttributes),
      `#${node.attrs.name}`,
    ];
  },

  renderText({ node }) {
    return `#${node.attrs.name}`;
  },

  addInputRules() {
    const type = this.type;
    return [
      // „#name“ + Leerzeichen → Tag-Knoten
      new InputRule({
        find: /(?:^|\s)(#([\p{L}\p{N}_-]{1,50}))\s$/u,
        handler: ({ state, range, match }) => {
          const full = match[0];
          const tag = match[1] as string;
          const name = match[2] as string;
          const start = range.from + full.indexOf(tag);
          state.tr.replaceWith(start, range.to, [type.create({ name }), state.schema.text(" ")]);
        },
      }),
    ];
  },
});
