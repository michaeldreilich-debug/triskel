import type { JSONContent } from "@tiptap/core";
import { BLOCK } from "./names";

/**
 * Inhalt vor dem Laden normalisieren: jeder Block bekommt eine eindeutige ID
 * (fehlende und doppelte werden neu vergeben, die erste bleibt). Der Editor prüft das
 * zusätzlich bei jeder Änderung (BlockId-Plugin).
 */
export function ensureBlockIds(doc: JSONContent, generateId: () => string): JSONContent {
  const seen = new Set<string>();
  const visit = (node: JSONContent): JSONContent => {
    const content = node.content?.map(visit);
    if (node.type !== BLOCK) return content ? { ...node, content } : node;
    let id = node.attrs?.id;
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) id = generateId();
    seen.add(id);
    return { ...node, attrs: { ...node.attrs, id }, ...(content ? { content } : {}) };
  };
  return visit(doc);
}
