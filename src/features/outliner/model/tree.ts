/**
 * Hilfsfunktionen für den Outline-Baum (reine ProseMirror-Logik, ohne Layout).
 * Position eines Blocks = Position direkt vor dem Block-Knoten.
 * Inhalt des Absatzes beginnt bei pos + 2, endet bei pos + 1 + paragraph.nodeSize - 1.
 */
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { BLOCK } from "./names";

export interface BlockRef {
  node: PMNode;
  pos: number;
}

export const isBlock = (node: PMNode | null | undefined): node is PMNode =>
  node?.type.name === BLOCK;

export const hasChildren = (block: PMNode) => block.childCount > 1;

/** Absatz (erstes Kind) eines Blocks */
export const paragraphOf = (block: PMNode) => block.firstChild as PMNode;

export const paragraphStart = (ref: BlockRef) => ref.pos + 2;
export const paragraphEnd = (ref: BlockRef) => ref.pos + 1 + paragraphOf(ref.node).nodeSize - 1;
/** Position, an der das erste Kind eingefügt wird */
export const childrenStart = (ref: BlockRef) => ref.pos + 1 + paragraphOf(ref.node).nodeSize;
/** Position am Ende der Kinder (innerhalb des Blocks) */
export const contentEnd = (ref: BlockRef) => ref.pos + ref.node.nodeSize - 1;

/** Nächster umschließender Block einer Position. */
export function blockAt($pos: ResolvedPos): (BlockRef & { depth: number }) | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (isBlock(node)) return { node, pos: $pos.before(depth), depth };
  }
  return null;
}

export function blockAtPos(doc: PMNode, pos: number): (BlockRef & { depth: number }) | null {
  const $pos = doc.resolve(pos);
  // Position direkt vor einem Block
  const after = $pos.nodeAfter;
  if (isBlock(after)) return { node: after, pos, depth: $pos.depth + 1 };
  return blockAt($pos);
}

/** Elternblock (null auf oberster Ebene). */
export function parentBlock(doc: PMNode, ref: BlockRef): BlockRef | null {
  const $pos = doc.resolve(ref.pos);
  if ($pos.depth === 0) return null;
  const node = $pos.node($pos.depth);
  return isBlock(node) ? { node, pos: $pos.before($pos.depth) } : null;
}

export function prevSibling(doc: PMNode, ref: BlockRef): BlockRef | null {
  const $pos = doc.resolve(ref.pos);
  const index = $pos.index($pos.depth);
  if (index === 0) return null;
  const node = $pos.node($pos.depth).child(index - 1);
  return isBlock(node) ? { node, pos: ref.pos - node.nodeSize } : null;
}

export function nextSibling(doc: PMNode, ref: BlockRef): BlockRef | null {
  const $pos = doc.resolve(ref.pos);
  const parent = $pos.node($pos.depth);
  const index = $pos.index($pos.depth);
  if (index + 1 >= parent.childCount) return null;
  const node = parent.child(index + 1);
  return isBlock(node) ? { node, pos: ref.pos + ref.node.nodeSize } : null;
}

/** Letzter sichtbarer Nachfahre (steigt in aufgeklappte letzte Kinder ab). */
export function lastVisibleDescendant(ref: BlockRef): BlockRef {
  let current = ref;
  while (hasChildren(current.node) && !current.node.attrs.collapsed) {
    const last = current.node.lastChild as PMNode;
    current = { node: last, pos: current.pos + current.node.nodeSize - 1 - last.nodeSize };
  }
  return current;
}

/** Ist der Block durch einen eingeklappten Vorfahren verborgen? */
export function isHidden(doc: PMNode, ref: BlockRef): boolean {
  const $pos = doc.resolve(ref.pos);
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const node = $pos.node(depth);
    if (isBlock(node) && node.attrs.collapsed) return true;
  }
  return false;
}

/** Nächster sichtbarer Block in Leserichtung. */
export function nextVisibleBlock(doc: PMNode, ref: BlockRef): BlockRef | null {
  if (hasChildren(ref.node) && !ref.node.attrs.collapsed) {
    const first = ref.node.child(1);
    return { node: first, pos: childrenStart(ref) };
  }
  let current: BlockRef | null = ref;
  while (current) {
    const next = nextSibling(doc, current);
    if (next) return next;
    current = parentBlock(doc, current);
  }
  return null;
}

/** Vorheriger sichtbarer Block in Leserichtung. */
export function prevVisibleBlock(doc: PMNode, ref: BlockRef): BlockRef | null {
  const prev = prevSibling(doc, ref);
  if (prev) return lastVisibleDescendant(prev);
  return parentBlock(doc, ref);
}

/** Alle Blöcke in Dokumentreihenfolge (Tiefensuche, Vorordnung). */
export function forEachBlock(
  doc: PMNode,
  fn: (ref: BlockRef, depth: number, parentId: string | null) => void,
) {
  const walk = (node: PMNode, offset: number, depth: number, parentId: string | null) => {
    node.forEach((child, childOffset) => {
      if (!isBlock(child)) return;
      const pos = offset + childOffset;
      fn({ node: child, pos }, depth, parentId);
      walk(child, pos + 1, depth + 1, child.attrs.id ?? null);
    });
  };
  walk(doc, 0, 0, null);
}
