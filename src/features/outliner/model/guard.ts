/**
 * Schutz vor stillem Verlust im Outliner (Review Teil B, V-11, V-3):
 * - Eine Auswahl über einen eingeklappten Block hinweg löscht sonst dessen verborgene Kinder
 *   ohne Rückfrage: Löschen/Ausschneiden klappt sie zuerst auf, der zweite Druck löscht sichtbar.
 * - Umbenennen einer Block-Aufgabe anderswo (Panel, Tabelle, KI) kommt in den Block zurück,
 *   solange der Blocktext reiner Text ist – sonst setzte die nächste Änderung in der Notiz den
 *   Titel still auf den alten Blocktext zurück.
 * Reine Funktionen auf ProseMirror-Transaktionen, ohne Editor-Instanz.
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { BLOCK } from "./names";
import { forEachBlock, hasChildren, paragraphOf } from "./tree";

/** Eingeklappte Blöcke mit Kindern, die ganz in [from, to] liegen (Löschen würde sie samt Kindern treffen). */
export function collapsedBlocksIn(doc: PMNode, from: number, to: number): number[] {
  if (from === to) return [];
  const found: number[] = [];
  forEachBlock(doc, (ref) => {
    if (!ref.node.attrs.collapsed || !hasChildren(ref.node)) return;
    const end = ref.pos + ref.node.nodeSize;
    // ganz in der Auswahl – oder die Auswahl endet im Absatz davor und frisst den Block an
    if (ref.pos >= from && end <= to) found.push(ref.pos);
    else if (ref.pos < to && end > from && (from <= ref.pos || to >= end)) found.push(ref.pos);
  });
  return found;
}

/** Diese Blöcke aufklappen (Auswahl bleibt). true = etwas geändert. */
export function expandBlocksAt(tr: Transaction, positions: number[]): boolean {
  let changed = false;
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos);
    if (!node || node.type.name !== BLOCK || !node.attrs.collapsed) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed: false });
    changed = true;
  }
  return changed;
}

/**
 * Vor dem Löschen einer Auswahl (Backspace, Entf, Ausschneiden): Liegt ein eingeklappter Block
 * mit Kindern darin, nur aufklappen (true = behandelt, nichts gelöscht).
 */
export function expandCollapsedInSelection(tr: Transaction): boolean {
  const { from, to, empty } = tr.selection;
  if (empty) return false;
  const positions = collapsedBlocksIn(tr.doc, from, to);
  return positions.length > 0 && expandBlocksAt(tr, positions);
}

/** Nur Text (mit Marken), keine Verweise, Tags, Bilder oder Dateien – lässt sich gefahrlos ersetzen. */
function isPlainText(paragraph: PMNode): boolean {
  let plain = true;
  paragraph.forEach((child) => {
    if (!child.isText) plain = false;
  });
  return plain;
}

/**
 * Titel umbenannter Aufgaben in ihre Blöcke schreiben (V-3). `titles`: Aufgaben-ID → neuer Titel;
 * geändert werden nur Blöcke, deren Absatz reiner Text ist und anders lautet. Liefert die IDs der
 * geänderten Aufgaben.
 */
export function writeTaskTitles(tr: Transaction, titles: Map<string, string>): string[] {
  const written: string[] = [];
  // von hinten nach vorn, damit frühere Positionen gültig bleiben
  const targets: Array<{ taskId: string; pos: number; node: PMNode }> = [];
  forEachBlock(tr.doc, (ref) => {
    const taskId = ref.node.attrs.taskId;
    if (typeof taskId === "string" && titles.has(taskId)) targets.push({ taskId, ...ref });
  });
  for (const target of targets.reverse()) {
    const paragraph = paragraphOf(target.node);
    const title = (titles.get(target.taskId) ?? "").trim();
    if (!isPlainText(paragraph) || paragraph.textContent.trim() === title) continue;
    const start = target.pos + 2;
    const end = start + paragraph.content.size;
    const marks = paragraph.firstChild?.marks ?? [];
    if (title) tr.replaceWith(start, end, tr.doc.type.schema.text(title, marks));
    else tr.delete(start, end);
    written.push(target.taskId);
  }
  return written;
}
