/**
 * Notiz- und Tag-Verzeichnis für den Outliner aus dem TanStack-Query-Cache (statt lokaler Liste
 * wie in der Spielwiese). Titel werden beim Anzeigen aufgelöst – Umbenennen bricht keinen Link.
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  type NoteDirectory,
  type NoteSummary,
  normalize,
  rankByTitle,
  type TagDirectory,
} from "@/features/outliner/directory";
import { notesKey } from "./api";
import type { NoteRow } from "./types";

export function createQueryNoteDirectory(
  queryClient: QueryClient,
  options: { create: (title: string) => string },
): NoteDirectory {
  let source: NoteRow[] | undefined;
  let byId = new Map<string, NoteRow>();
  const notes = () => {
    const current = queryClient.getQueryData<NoteRow[]>(notesKey) ?? [];
    if (current !== source) {
      source = current;
      byId = new Map(current.map((n) => [n.id, n]));
    }
    return current;
  };
  const summary = (n: NoteRow): NoteSummary => ({
    id: n.id,
    title: n.title.trim() || "Ohne Titel",
    ...(n.archived_at ? { archived: true } : {}),
  });

  return {
    titleOf(id) {
      notes();
      const note = byId.get(id);
      return note ? summary(note).title : undefined;
    },
    search(query) {
      const all = notes().map(summary);
      const ranked = rankByTitle(
        all.filter((n) => !n.archived),
        query,
      );
      const q = normalize(query);
      if (!q) return ranked;
      // archivierte nur, wenn der Titel so beginnt – sonst stünde „((Titel“ einer archivierten
      // Notiz ohne Treffer und ohne „anlegen“ da (O-9)
      const archived = rankByTitle(
        all.filter((n) => n.archived && normalize(n.title).startsWith(q)),
        query,
      );
      return [...ranked, ...archived];
    },
    findByTitle(title) {
      const q = normalize(title);
      return notes().find((n) => normalize(n.title) === q)?.id;
    },
    create: (title) => options.create(title.trim()),
    subscribe(listener) {
      return queryClient.getQueryCache().subscribe((event) => {
        if (event.type === "updated" && event.query.queryKey[0] === notesKey[0]) listener();
      });
    },
  };
}

/** Tags aus allen Notizen (für #-Autocomplete). */
export function createQueryTagDirectory(queryClient: QueryClient): TagDirectory {
  return {
    search(query) {
      const q = normalize(query);
      const tags = new Set<string>();
      for (const note of queryClient.getQueryData<NoteRow[]>(notesKey) ?? []) {
        for (const tag of note.tags) if (normalize(tag).startsWith(q)) tags.add(tag);
      }
      return [...tags].sort((a, b) => a.localeCompare(b, "de"));
    },
  };
}
