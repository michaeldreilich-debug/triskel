/**
 * Bilder und Dateien beim Schreiben der KI erhalten (#71, Prüfung O8 – Regel 1 „Nie Daten
 * verlieren“). „fetch“ zeigt Bilder als `![[<datei>]]` und Dateien als `[[<name>-<id>.<ext>]]`
 * (wie der Export, `inlineMarkdown`). Schreibt die KI einen Inhalt neu (update_note, update_task,
 * update_project mit „ersetzen“) und übernimmt diese Verweise, werden sie wieder Bild- bzw.
 * Datei-Knoten – aber nur für Bilder und Dateien, die schon in diesem Eintrag stehen: Der Knoten
 * kommt samt Pfad, Größe und Zuschnitt aus dem bisherigen Inhalt, nie ein Pfad aus der Eingabe.
 * Rein, ohne Editor und ohne Datenbank.
 */
import type { JSONContent } from "@tiptap/core";
import { exportFileName } from "@/features/outliner/model/files";
import { NOTE_FILE, NOTE_IMAGE } from "@/features/outliner/model/names";

/** Verweis, unter dem `inlineMarkdown` den Knoten zeigt (ohne `![[`/`]]`); sonst null. */
export function mediaRefOf(node: JSONContent): string | null {
  const path = typeof node.attrs?.path === "string" ? node.attrs.path : "";
  if (!path) return null;
  if (node.type === NOTE_IMAGE) return path.split("/").pop() || null;
  if (node.type === NOTE_FILE) return exportFileName(path, String(node.attrs?.name ?? "Datei"));
  return null;
}

const key = (value: string) => value.trim().normalize("NFC");

/**
 * Auflöser für `parseInline` (`resolveMedia`): Verweis aus dem Text → Kopie des vorhandenen
 * Bild- bzw. Datei-Knotens. `undefined`, wenn der Eintrag keine Bilder oder Dateien hat.
 */
export function existingMediaResolver(
  roots: Iterable<JSONContent | null | undefined>,
): ((ref: string) => JSONContent | undefined) | undefined {
  const byRef = new Map<string, JSONContent>();
  const walk = (node: JSONContent | null | undefined) => {
    if (!node || typeof node !== "object") return;
    const ref = mediaRefOf(node);
    if (ref) {
      const path = String(node.attrs?.path);
      for (const name of [ref, path]) if (!byRef.has(key(name))) byRef.set(key(name), node);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  if (byRef.size === 0) return undefined;
  return (ref) => {
    const found = byRef.get(key(ref.split("|")[0] ?? ""));
    return found ? structuredClone(found) : undefined;
  };
}
