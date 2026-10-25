import { Node } from "@tiptap/core";
import { BLOCK, DOC } from "../model/names";

/** Dokument des Outliners: nur Blöcke (doc → block+). */
export const OutlineDocument = Node.create({
  name: DOC,
  topNode: true,
  content: `${BLOCK}+`,
});
