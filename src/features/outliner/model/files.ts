/** Dateinamen für Dateien im Editor (#27) – rein, ohne Browser (Serializer, Export, Tests). */

/** Dateiendung für den Speicherpfad: klein, nur Buchstaben/Ziffern, sonst „bin“. */
export function fileExt(name: string): string {
  const match = /\.([a-z0-9]{1,10})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "bin";
}

/**
 * Dateiname im Export (Ordner „Anhänge/“): Originalname plus die ersten 8 Zeichen der ID,
 * damit gleichnamige Dateien aus verschiedenen Notizen sich nicht überschreiben.
 */
export function exportFileName(path: string, name: string): string {
  const id = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "").slice(0, 8);
  const ext = fileExt(name);
  const base =
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Datei";
  return `${base}-${id}.${ext}`;
}
