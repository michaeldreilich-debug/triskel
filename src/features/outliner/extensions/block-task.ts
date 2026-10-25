import { Extension, InputRule } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { TaskDirectory } from "../directory";
import { blockAt, paragraphOf } from "../model/tree";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockTask: {
      /** aktuellen Block in eine Aufgabe umwandeln (Titel = Blocktext) */
      convertBlockToTask: () => ReturnType;
      /** Verknüpfung zur Aufgabe lösen (die Aufgabe bleibt bestehen) */
      unlinkBlockTask: () => ReturnType;
    };
  }
}

export interface BlockTaskOptions {
  tasks: TaskDirectory | null;
}

/** Aufgaben-ID des Blocks an der Auswahl (null = kein Aufgaben-Block). */
export function blockTaskIdAt(state: EditorState): string | null {
  const block = blockAt(state.selection.$from);
  const id = block?.node.attrs.taskId;
  return typeof id === "string" && id ? id : null;
}

function convert(tr: Transaction, state: EditorState, tasks: TaskDirectory, skip = 0): boolean {
  const block = blockAt(state.selection.$from);
  if (!block || block.node.attrs.taskId) return false;
  const title = paragraphOf(block.node).textContent.slice(skip).trim();
  const taskId = tasks.create(title);
  tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, taskId });
  return true;
}

/**
 * „Offener Punkt → Aufgabe“ (Plan Abschnitt 1): „() “ oder „[] “ am Blockanfang legt eine Aufgabe
 * mit dem Blocktext an und setzt `taskId`. „()“ geht auf der deutschen Mac-Tastatur ohne ⌥
 * (Rückmeldung 12.10.2026 – wie „((“ statt „[[“). Die Node-View zeigt danach Checkbox und Status der Aufgabe.
 */
export const BlockTask = Extension.create<BlockTaskOptions>({
  name: "blockTask",

  addOptions() {
    return { tasks: null };
  },

  addCommands() {
    return {
      convertBlockToTask:
        () =>
        ({ state, tr, dispatch }) => {
          const tasks = this.options.tasks;
          if (!tasks) return false;
          if (!dispatch) return Boolean(blockAt(state.selection.$from)) && !blockTaskIdAt(state);
          return convert(tr, state, tasks);
        },
      unlinkBlockTask:
        () =>
        ({ state, tr, dispatch }) => {
          const block = blockAt(state.selection.$from);
          if (!block?.node.attrs.taskId) return false;
          if (dispatch)
            tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, taskId: null });
          return true;
        },
    };
  },

  addInputRules() {
    const tasks = this.options.tasks;
    if (!tasks) return [];
    return [
      new InputRule({
        // „() “, „( ) “, „[] “ oder „[ ] “ ganz am Anfang des Absatzes
        find: /^(?:\( ?\)|\[ ?\])\s$/,
        handler: ({ state, range }) => {
          const block = blockAt(state.selection.$from);
          if (!block || block.node.attrs.taskId) return null;
          const skip = range.to - range.from;
          const { tr } = state;
          tr.delete(range.from, range.to);
          const title = paragraphOf(block.node).textContent.slice(skip).trim();
          const taskId = tasks.create(title);
          tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, taskId });
        },
      }),
    ];
  },
});
