import { Extension } from "@tiptap/core";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Erstes fokussierbares Element nach `element` (in Dokument-Reihenfolge, nicht darin). */
function nextFocusable(element: HTMLElement): HTMLElement | null {
  for (const candidate of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (element.contains(candidate)) continue;
    if (!(element.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    // unsichtbar (hidden, inert, display: none) zählt nicht; ohne checkVisibility: sichtbar
    if (candidate.closest("[hidden], [inert]")) continue;
    if (candidate.checkVisibility?.() === false) continue;
    return candidate;
  }
  return null;
}

/**
 * Escape verlässt den Editor (O-6, WCAG 2.1.2): Tab rückt im Outliner ein und gibt den Fokus
 * deshalb nie ab. Der Fokus springt zum nächsten Bedienelement danach – von dort geht Tab normal
 * weiter, ⇧Tab erreicht die Knöpfe der Bilder und Dateien. Niedrige Priorität: Vorschlagsliste,
 * Menüs und Diagramm-Code behandeln Escape vorher selbst.
 */
export const LeaveEditor = Extension.create({
  name: "leaveEditor",
  priority: 50,

  addKeyboardShortcuts() {
    return {
      Escape: () => {
        const dom = this.editor.view.dom as HTMLElement;
        const next = nextFocusable(dom);
        if (next) next.focus();
        else dom.blur();
        return true;
      },
    };
  },
});
