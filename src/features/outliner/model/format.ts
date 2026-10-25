import type { EditorState } from "@tiptap/pm/state";

/** Auswahl innerhalb eines Blocks, nur Text (keine Links/Tags) – daraus wird ein ((Notiz-Link)). */
export function selectionAsNoteTitle(state: EditorState): string | null {
  const { from, to, $from, $to, empty } = state.selection;
  if (empty || !$from.sameParent($to)) return null;
  let onlyText = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && !node.isText) onlyText = false;
  });
  const text = state.doc.textBetween(from, to).replace(/\s+/g, " ").trim();
  return onlyText && text && text.length <= 200 ? text : null;
}

/** Ohne Schema gilt https:// (wie beim Autolink); javascript: & Co. lehnt die Link-Extension ab. */
export function normalizeHref(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}
