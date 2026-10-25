"use client";

/**
 * Bilder und Dateien endgültig gelöschter Notizen, Aufgaben und Projekte entfernen (E24, #27, #44) – aber nur,
 * was nirgends sonst mehr steht. Per Kopieren oder Ausschneiden wandert ein Bild oder eine Datei
 * in eine andere Notiz oder Aufgabe, der Pfad zeigt dann weiter in den Ordner der alten.
 * Gezählt wird alles, was noch zurückkommen kann: auch Inhalte im Papierkorb, Vorlagen und noch
 * nicht gespeicherte Änderungen. Lässt sich das nicht prüfen, bleibt alles liegen (verwaiste
 * Dateien kosten nur Speicher, kein Datenverlust).
 */
import { ATTACHMENT_BUCKET } from "@/features/notes/attachments";
import { NOTE_IMAGE_BUCKET } from "@/features/notes/images";
import { browserMediaApi, type MediaFolderApi } from "@/features/notes/media-api";
import { fetchAll } from "@/lib/data/fetch-all";
import type { Supabase } from "@/lib/supabase/client";

const MEDIA_BUCKETS = [NOTE_IMAGE_BUCKET, ATTACHMENT_BUCKET] as const;

/** Pfade, die in keinem der Inhalte vorkommen (beliebig verschachtelt, auch als JSON-Text). */
export function unusedPaths(paths: string[], contents: unknown[]): string[] {
  const text = contents.map((content) => JSON.stringify(content) ?? "").join("\n");
  return paths.filter((path) => !text.includes(path));
}

type Page<T> = { data: T[] | null; error: unknown };

/**
 * Alle Inhalte, die auf Bilder und Dateien zeigen können. Die Besitzer sind schon endgültig
 * gelöscht (nur danach aufrufen) – lebt einer doch noch (anderswo zurückgeholt, empty_trash
 * gescheitert), zählen seine Inhalte mit und seine Dateien bleiben (D-11).
 */
async function fetchContents(client: Supabase): Promise<unknown[]> {
  const [blocks, tasks, projects, templates] = await Promise.all([
    fetchAll<{ note_id: string; content: unknown }>(
      async (from, to) =>
        (await client
          .from("note_blocks")
          .select("note_id, content")
          .order("id")
          .range(from, to)) as Page<{ note_id: string; content: unknown }>,
    ),
    fetchAll<{ id: string; body: unknown }>(
      async (from, to) =>
        (await client.from("tasks").select("id, body").order("id").range(from, to)) as Page<{
          id: string;
          body: unknown;
        }>,
    ),
    // Freitext der Projekte (#44)
    fetchAll<{ id: string; body: unknown }>(
      async (from, to) =>
        (await client.from("projects").select("id, body").order("id").range(from, to)) as Page<{
          id: string;
          body: unknown;
        }>,
    ),
    fetchAll<{ body: unknown }>(
      async (from, to) =>
        (await client.from("templates").select("body").order("id").range(from, to)) as Page<{
          body: unknown;
        }>,
    ),
  ]);
  return [
    ...blocks.map((b) => b.content),
    ...tasks.map((t) => t.body),
    ...projects.map((p) => p.body),
    ...templates.map((t) => t.body),
  ];
}

/**
 * Ordner der Besitzer in beiden Buckets durchgehen und nur ungenutzte Dateien entfernen – erst
 * NACH dem bestätigten endgültigen Löschen aufrufen. `pending`: noch nicht gespeicherte Werte
 * (Speicher-Warteschlange) zählen mit.
 */
export async function removeUnusedMedia(
  client: Supabase,
  _userId: string, // der Server nimmt die eigene Kennung aus der Sitzung
  ownerIds: string[],
  pending: unknown[] = [],
  api: MediaFolderApi = browserMediaApi,
): Promise<void> {
  const candidates = await Promise.all(
    MEDIA_BUCKETS.map(async (bucket) => ({
      bucket,
      paths: (await Promise.all(ownerIds.map((id) => api.list(bucket, id)))).flat(),
    })),
  );
  if (candidates.every((c) => c.paths.length === 0)) return;
  const contents = [...(await fetchContents(client)), ...pending];
  for (const { bucket, paths } of candidates) {
    const unused = unusedPaths(paths, contents);
    if (unused.length > 0) await api.remove(bucket, unused);
  }
}
