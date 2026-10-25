import type { ChainedCommands, Editor } from "@tiptap/core";
import { selectionAsNoteTitle } from "../model/format";

/** Zeichenformate an der Auswahl – gemeinsam für Leiste und Rechtsklick-Menü (O-21). */
export const formatState = (editor: Editor) => ({
  bold: editor.isActive("bold"),
  italic: editor.isActive("italic"),
  strike: editor.isActive("strike"),
  code: editor.isActive("code"),
  link: editor.isActive("link"),
  noteTitle: selectionAsNoteTitle(editor.state),
});

/**
 * Befehl ausführen, Fokus sofort zurück in den Editor: TipTaps focus() wartet einen Frame – ein
 * gleich danach geöffnetes Menü würde durch den späten Fokuswechsel sonst wieder geschlossen.
 */
export function runFocused(editor: Editor, command: (chain: ChainedCommands) => ChainedCommands) {
  editor.view.focus();
  command(editor.chain()).run();
}
