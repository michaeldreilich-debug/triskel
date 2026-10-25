/** Knotennamen des Outline-Schemas: doc → block+, block → paragraph block* */
export const DOC = "doc";
export const BLOCK = "block";
export const PARAGRAPH = "paragraph";
export const NOTE_LINK = "noteLink";
export const TAG = "tag";
/** Bild im Absatz (Pfad im Storage-Bucket, E24) */
export const NOTE_IMAGE = "noteImage";
/** Datei im Absatz (PDF oder beliebig, Pfad im Bucket „attachments“, #27) */
export const NOTE_FILE = "noteFile";
/** Mermaid-Diagramm im Absatz (Code als Attribut, E24) */
export const MERMAID = "mermaid";
