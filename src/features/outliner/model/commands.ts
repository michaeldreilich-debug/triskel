/**
 * Outline-Befehle als Transaktions-Funktionen (E2, Plan Abschnitt 1).
 * Jede Funktion verändert die übergebene Transaktion und gibt zurück, ob sie die Aktion
 * übernommen hat (true) – dann darf kein Standardverhalten mehr laufen.
 */

import { closeHistory } from "@tiptap/pm/history";
import { Fragment, NodeRange, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { BLOCK, MERMAID, NOTE_FILE, NOTE_IMAGE, PARAGRAPH } from "./names";
import {
  type BlockRef,
  blockAt,
  childrenStart,
  contentEnd,
  hasChildren,
  isBlock,
  lastVisibleDescendant,
  nextSibling,
  nextVisibleBlock,
  paragraphEnd,
  paragraphOf,
  paragraphStart,
  parentBlock,
  prevSibling,
} from "./tree";

const blockType = (schema: Schema) => schema.nodes[BLOCK] as NonNullable<Schema["nodes"][string]>;
const paragraphType = (schema: Schema) =>
  schema.nodes[PARAGRAPH] as NonNullable<Schema["nodes"][string]>;

export function createBlock(
  schema: Schema,
  content: Fragment | PMNode[] = Fragment.empty,
  children: PMNode[] = [],
): PMNode {
  const paragraph = paragraphType(schema).create(null, content);
  return blockType(schema).create({ id: null, collapsed: false, taskId: null }, [
    paragraph,
    ...children,
  ]);
}

/**
 * Geschwister-Bereich der Auswahl: ein Block (Cursor) oder mehrere Geschwister.
 * Liegt die Auswahl im Absatz eines Elternblocks, wird der Elternblock selbst genommen.
 */
export function selectedSiblings(tr: Transaction): NodeRange | null {
  const { $from, $to } = tr.selection;
  let range = $from.blockRange($to, (node) => node.type.name === BLOCK || node.type.name === "doc");
  if (!range) return null;
  while (isBlock(range.parent) && range.startIndex === 0) {
    const depth: number = range.depth;
    if (depth === 0) return null;
    range = new NodeRange(
      tr.doc.resolve(range.$from.before(depth)),
      tr.doc.resolve(range.$from.after(depth)),
      depth - 1,
    );
  }
  return range;
}

function rangeBlocks(range: NodeRange): PMNode[] {
  const nodes: PMNode[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) nodes.push(range.parent.child(i));
  return nodes;
}

/** Auswahl nach dem Verschieben eines Bereichs um delta wiederherstellen. */
function shiftSelection(tr: Transaction, anchor: number, head: number, delta: number) {
  tr.setSelection(TextSelection.create(tr.doc, anchor + delta, head + delta));
  // Strukturbefehle sind eigene Rückgängig-Schritte (nicht mit Tippen zusammengefasst)
  closeHistory(tr);
}

/** Tab: Block(s) zum letzten Kind des vorherigen Geschwisters machen. */
export function indent(tr: Transaction): boolean {
  const range = selectedSiblings(tr);
  if (!range) return false;
  const { anchor, head } = tr.selection;
  if (range.startIndex === 0) return true;
  const prev = range.parent.child(range.startIndex - 1);
  if (!isBlock(prev)) return true;
  const prevPos = range.start - prev.nodeSize;
  const moved = rangeBlocks(range);
  const newPrev = prev.type.create(
    { ...prev.attrs, collapsed: false },
    prev.content.append(Fragment.from(moved)),
    prev.marks,
  );
  tr.replaceWith(prevPos, range.end, newPrev);
  const newStart = prevPos + 1 + prev.content.size;
  shiftSelection(tr, anchor, head, newStart - range.start);
  return true;
}

/** Umschalt+Tab: Block(s) hinter den Elternblock setzen; folgende Geschwister bleiben, wo sie sind. */
export function outdent(tr: Transaction): boolean {
  const range = selectedSiblings(tr);
  if (!range) return false;
  const { anchor, head } = tr.selection;
  if (!isBlock(range.parent) || range.depth === 0) return true;
  const parentPos = range.$from.before(range.depth);
  const parent = range.parent;
  const moved = rangeBlocks(range);
  const kept: PMNode[] = [];
  parent.forEach((child, _offset, index) => {
    if (index < range.startIndex || index >= range.endIndex) kept.push(child);
  });
  const newParent = parent.type.create(parent.attrs, kept, parent.marks);
  tr.replaceWith(parentPos, parentPos + parent.nodeSize, [newParent, ...moved]);
  const newStart = parentPos + newParent.nodeSize;
  shiftSelection(tr, anchor, head, newStart - range.start);
  return true;
}

/** ⌥⇧↑ / ⌥⇧↓: Block(s) samt Kindern unter den Geschwistern verschieben. */
export function move(tr: Transaction, direction: "up" | "down"): boolean {
  const range = selectedSiblings(tr);
  if (!range) return false;
  const { anchor, head } = tr.selection;
  const moved = rangeBlocks(range);
  if (direction === "up") {
    if (range.startIndex === 0) return true;
    const prev = range.parent.child(range.startIndex - 1);
    if (!isBlock(prev)) return true;
    tr.replaceWith(range.start - prev.nodeSize, range.end, [...moved, prev]);
    shiftSelection(tr, anchor, head, -prev.nodeSize);
    return true;
  }
  if (range.endIndex >= range.parent.childCount) return true;
  const next = range.parent.child(range.endIndex);
  tr.replaceWith(range.start, range.end + next.nodeSize, [next, ...moved]);
  shiftSelection(tr, anchor, head, next.nodeSize);
  return true;
}

function setCollapsedAt(tr: Transaction, ref: BlockRef, collapsed: boolean) {
  tr.setNodeMarkup(ref.pos, undefined, { ...ref.node.attrs, collapsed });
  // Ein-/Ausklappen ist Ansicht, kein Inhalt: nicht in die Rückgängig-Historie
  tr.setMeta("addToHistory", false);
}

/** ⌘↑: einklappen (Block mit Kindern, sonst den Elternblock und Cursor dorthin). */
export function collapse(tr: Transaction): boolean {
  const ref = blockAt(tr.selection.$from);
  if (!ref) return false;
  if (hasChildren(ref.node)) {
    if (!ref.node.attrs.collapsed) setCollapsedAt(tr, ref, true);
    return true;
  }
  const parent = parentBlock(tr.doc, ref);
  if (!parent) return true;
  setCollapsedAt(tr, parent, true);
  tr.setSelection(TextSelection.create(tr.doc, paragraphEnd(parent)));
  return true;
}

/** ⌘↓: aufklappen. */
export function expand(tr: Transaction): boolean {
  const ref = blockAt(tr.selection.$from);
  if (!ref) return false;
  if (hasChildren(ref.node) && ref.node.attrs.collapsed) setCollapsedAt(tr, ref, false);
  return true;
}

/** Klick auf den Pfeil: umschalten; liegt der Cursor in den Kindern, wandert er in den Block. */
export function toggleCollapsedAt(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos);
  if (!isBlock(node) || !hasChildren(node)) return false;
  const ref = { node, pos };
  const collapsing = !node.attrs.collapsed;
  setCollapsedAt(tr, ref, collapsing);
  if (collapsing) {
    const { from } = tr.selection;
    if (from > childrenStart(ref) - 1 && from < pos + node.nodeSize) {
      tr.setSelection(TextSelection.create(tr.doc, paragraphEnd(ref)));
    }
  }
  return true;
}

/** Bild, Datei und Diagramm: selbst gewählt (Antippen) und doch nie durch Tippen zu ersetzen. */
const MEDIA_ATOMS = new Set([NOTE_IMAGE, NOTE_FILE, MERMAID]);

/**
 * Ist ein Bild, eine Datei oder ein Diagramm als Knoten ausgewählt (Antippen am Handy), Cursor
 * dahinter setzen – Enter, Tippen und Einfügen sollen es nicht ersetzen (O-1). true = verschoben.
 */
export function cursorAfterSelectedMedia(tr: Transaction): boolean {
  const { selection } = tr;
  if (!(selection instanceof NodeSelection) || !MEDIA_ATOMS.has(selection.node.type.name)) {
    return false;
  }
  tr.setSelection(TextSelection.create(tr.doc, selection.to));
  return true;
}

/**
 * „Ans Ende“ (Ablegen neben dem Editor, O-4): Ende des letzten sichtbaren Blocks – nicht in die
 * Kinder eines eingeklappten letzten Blocks. Ohne Outline-Blöcke das Ende des Dokuments.
 */
export function visibleEnd(doc: PMNode): Selection {
  const last = doc.lastChild;
  if (!isBlock(last)) return Selection.atEnd(doc);
  const ref = lastVisibleDescendant({ node: last, pos: doc.content.size - last.nodeSize });
  return TextSelection.create(doc, paragraphEnd(ref));
}

/** Enter: neuer Block. Leerer eingerückter Block ohne Kinder wird stattdessen ausgerückt. */
export function split(tr: Transaction): boolean {
  // ein ausgewähltes Bild bleibt stehen, der neue Block kommt dahinter (O-1)
  if (!cursorAfterSelectedMedia(tr) && !tr.selection.empty) tr.deleteSelection();
  const { $from } = tr.selection;
  if ($from.parent.type.name !== PARAGRAPH) return false;
  const ref = blockAt($from);
  if (!ref) return false;
  const schema = tr.doc.type.schema;
  const paragraph = $from.parent;
  const nested = isBlock(tr.doc.resolve(ref.pos).parent);

  if (paragraph.content.size === 0 && !hasChildren(ref.node) && nested) return outdent(tr);

  // Cursor am Anfang eines nicht leeren Absatzes: leeren Block davor einfügen
  if ($from.parentOffset === 0 && paragraph.content.size > 0) {
    tr.insert(ref.pos, createBlock(schema));
    return true;
  }

  const after = paragraph.content.cut($from.parentOffset);
  tr.delete($from.pos, $from.end());
  const current = { node: tr.doc.nodeAt(ref.pos) as PMNode, pos: ref.pos };
  const asFirstChild = hasChildren(current.node) && !current.node.attrs.collapsed;
  const insertPos = asFirstChild ? childrenStart(current) : current.pos + current.node.nodeSize;
  tr.insert(insertPos, createBlock(schema, after));
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
  return true;
}

/**
 * Block mit seinem Vorgänger (letzter sichtbarer Block davor) zusammenführen:
 * Text wird angehängt, Kinder werden Kinder des Vorgängers (der dafür aufgeklappt wird).
 */
function mergeInto(tr: Transaction, target: BlockRef, source: BlockRef) {
  const sourceParagraph = paragraphOf(source.node);
  const children: PMNode[] = [];
  source.node.forEach((child, _o, index) => {
    if (index > 0) children.push(child);
  });
  const joinPoint = paragraphEnd(target);
  tr.delete(source.pos, source.pos + source.node.nodeSize);
  if (children.length > 0) {
    tr.insert(contentEnd(target), children);
    const updated = tr.doc.nodeAt(target.pos) as PMNode;
    if (updated.attrs.collapsed)
      tr.setNodeMarkup(target.pos, undefined, { ...updated.attrs, collapsed: false });
  }
  tr.insert(joinPoint, sourceParagraph.content);
  tr.setSelection(TextSelection.create(tr.doc, joinPoint));
  closeHistory(tr);
}

/** Rücktaste am Blockanfang: zusammenführen, löschen oder (erstes Kind) ausrücken. */
export function joinBackward(tr: Transaction): boolean {
  const { selection } = tr;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.parent.type.name !== PARAGRAPH || $from.parentOffset !== 0) return false;
  const ref = blockAt($from);
  if (!ref) return false;

  const prev = prevSibling(tr.doc, ref);
  if (!prev) {
    if (parentBlock(tr.doc, ref)) return outdent(tr);
    // erster Block ganz oben: nur ein leerer Block ohne Kinder verschwindet, wenn weitere folgen
    const next = nextSibling(tr.doc, ref);
    if (next && paragraphOf(ref.node).content.size === 0 && !hasChildren(ref.node)) {
      tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
      tr.setSelection(TextSelection.create(tr.doc, ref.pos + 2));
    }
    return true;
  }

  const target = lastVisibleDescendant(prev);
  if (paragraphOf(ref.node).content.size === 0 && !hasChildren(ref.node)) {
    tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
    tr.setSelection(TextSelection.create(tr.doc, paragraphEnd(target)));
    return true;
  }
  mergeInto(tr, target, ref);
  return true;
}

/** Entf am Absatzende: nächsten sichtbaren Block heranziehen. */
export function joinForward(tr: Transaction): boolean {
  const { selection } = tr;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.parent.type.name !== PARAGRAPH || $from.parentOffset !== $from.parent.content.size)
    return false;
  const ref = blockAt($from);
  if (!ref) return false;
  const next = nextVisibleBlock(tr.doc, ref);
  if (!next) return true;

  if (hasChildren(ref.node) && !ref.node.attrs.collapsed && next.pos === childrenStart(ref)) {
    // erstes Kind: Text heranziehen, seine Kinder rücken an seine Stelle
    const grandChildren: PMNode[] = [];
    next.node.forEach((child, _o, index) => {
      if (index > 0) grandChildren.push(child);
    });
    tr.replaceWith(next.pos, next.pos + next.node.nodeSize, grandChildren);
    tr.insert($from.pos, paragraphOf(next.node).content);
    tr.setSelection(TextSelection.create(tr.doc, $from.pos));
    return true;
  }
  mergeInto(tr, ref, next);
  tr.setSelection(TextSelection.create(tr.doc, $from.pos));
  return true;
}

/**
 * Blöcke (z. B. aus eingefügtem Text) einfügen: ein leerer Block ohne Kinder wird ersetzt,
 * sonst landen sie als Geschwister hinter dem aktuellen Block. Cursor ans Ende des letzten.
 */
export function insertBlocks(tr: Transaction, blocks: PMNode[]): boolean {
  if (blocks.length === 0) return false;
  if (!tr.selection.empty) tr.deleteSelection();
  const ref = blockAt(tr.selection.$from);
  if (!ref) return false;
  const replaceCurrent = paragraphOf(ref.node).content.size === 0 && !hasChildren(ref.node);
  const insertPos = replaceCurrent ? ref.pos : ref.pos + ref.node.nodeSize;
  if (replaceCurrent) tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, blocks);
  else tr.insert(insertPos, blocks);
  const totalSize = blocks.reduce((sum, b) => sum + b.nodeSize, 0);
  const last = blocks[blocks.length - 1] as PMNode;
  const lastRef = lastVisibleDescendant({ node: last, pos: insertPos + totalSize - last.nodeSize });
  tr.setSelection(TextSelection.create(tr.doc, paragraphEnd(lastRef)));
  return true;
}

export { paragraphStart };
