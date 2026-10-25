import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { TaskDirectory } from "../directory";
import { toggleCollapsedAt } from "../model/commands";
import { BLOCK, PARAGRAPH } from "../model/names";

/**
 * Outline-Block: Absatz + verschachtelte Kinder (block → paragraph block*).
 * Attribute: id (vergibt das BlockId-Plugin), collapsed, taskId (B5: „Offener Punkt → Aufgabe“).
 * Eingeklappte Kinder bleiben im Dokument und werden nur ausgeblendet (Node-View + CSS).
 */
export interface BlockOptions {
  /** Aufgaben für Blöcke mit taskId (Checkbox + Status) */
  tasks: TaskDirectory | null;
}

export const Block = Node.create<BlockOptions>({
  name: BLOCK,
  content: `${PARAGRAPH} ${BLOCK}*`,
  defining: true,

  addOptions() {
    return { tasks: null };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute("data-id"),
        renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
      },
      collapsed: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute("data-collapsed") === "true",
        renderHTML: (attrs) => (attrs.collapsed ? { "data-collapsed": "true" } : {}),
      },
      taskId: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute("data-task-id"),
        renderHTML: (attrs) => (attrs.taskId ? { "data-task-id": attrs.taskId } : {}),
      },
      /**
       * Nur im Speicher, nie im HTML oder in der Datenbank: eben eingefügt (⌘V, Ablegen). Das
       * BlockId-Plugin entscheidet daran, ob ein Block verschoben wurde (ID und Aufgabe bleiben)
       * oder kopiert (neue ID, keine Aufgabe) – V-9.
       */
      pasted: {
        default: false,
        keepOnSplit: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "block" }, HTMLAttributes), 0];
  },

  addNodeView() {
    const tasks = this.options.tasks;
    return ({ node: initialNode, getPos, editor }) => {
      let node: PMNode = initialNode;

      const dom = document.createElement("div");
      dom.className = "ol-block";
      dom.dataset.type = "block";

      const gutter = document.createElement("div");
      gutter.className = "ol-gutter";
      gutter.contentEditable = "false";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "ol-toggle";
      toggle.tabIndex = -1;

      const bullet = document.createElement("span");
      bullet.className = "ol-bullet";
      bullet.setAttribute("aria-hidden", "true");

      // „Block → Aufgabe“: Checkbox mit dem Status der Aufgabe (synchron in beide Richtungen)
      const check = document.createElement("button");
      check.type = "button";
      check.className = "ol-check";
      check.setAttribute("role", "checkbox");
      check.hidden = true;

      gutter.append(toggle, check, bullet);

      const body = document.createElement("div");
      body.className = "ol-body";

      dom.append(gutter, body);

      check.addEventListener("mousedown", (event) => event.preventDefault());
      check.addEventListener("click", (event) => {
        event.preventDefault();
        const taskId = node.attrs.taskId;
        if (tasks && typeof taskId === "string") tasks.toggle(taskId);
      });

      toggle.addEventListener("mousedown", (event) => event.preventDefault());
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.commands.command(({ tr }) => toggleCollapsedAt(tr, pos));
      });

      const render = () => {
        const childCount = node.childCount - 1;
        const collapsed = Boolean(node.attrs.collapsed) && childCount > 0;
        if (node.attrs.id) dom.dataset.blockId = node.attrs.id;
        dom.dataset.hasChildren = String(childCount > 0);
        dom.dataset.collapsed = String(collapsed);
        toggle.hidden = childCount === 0;
        toggle.setAttribute("aria-label", collapsed ? "Ausklappen" : "Einklappen");
        toggle.setAttribute("aria-expanded", String(!collapsed));
        body.dataset.hiddenLabel = collapsed ? `${childCount} eingeklappt` : "";
        const taskId = typeof node.attrs.taskId === "string" ? node.attrs.taskId : null;
        const task = taskId && tasks ? tasks.get(taskId) : undefined;
        check.hidden = !task;
        if (task) {
          dom.dataset.task = task.done ? "done" : "open";
          dom.dataset.taskId = task.id;
          check.setAttribute("aria-checked", String(task.done));
          check.setAttribute(
            "aria-label",
            `Aufgabe „${task.title || "Ohne Titel"}“ ${task.done ? "wieder öffnen" : "erledigen"}`,
          );
        } else {
          delete dom.dataset.task;
          delete dom.dataset.taskId;
        }
      };
      // nur Blöcke mit Aufgabe hören auf den Aufgaben-Cache (O-15): bei 1 500 Blöcken sonst
      // 1 500 Listener, und jede Änderung an irgendeiner Aufgabe zeichnete alle Gutter neu
      let unsubscribe: (() => void) | undefined;
      const listen = () => {
        const wanted = Boolean(tasks && typeof node.attrs.taskId === "string" && node.attrs.taskId);
        if (wanted && !unsubscribe) unsubscribe = tasks?.subscribe(render);
        else if (!wanted && unsubscribe) {
          unsubscribe();
          unsubscribe = undefined;
        }
      };
      render();
      listen();

      return {
        dom,
        contentDOM: body,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          render();
          listen();
          return true;
        },
        destroy: () => unsubscribe?.(),
        stopEvent: (event) => gutter.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          !body.contains(mutation.target) ||
          (mutation.type === "attributes" && mutation.target === body),
      };
    };
  },
});
