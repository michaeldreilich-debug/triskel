"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileText, Folder, History, Square, SquareCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PaletteGroup, PaletteItem, PaletteNote } from "@/components/ui/command-palette";
import { useAreas } from "@/features/areas/api";
import { useNotes } from "@/features/notes/api";
import { useProjects } from "@/features/projects/api";
import { useTasks } from "@/features/tasks/api";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { useSupabase } from "@/lib/data/provider";
import { groupSearchResults, type SearchHit, type SearchKind, type SearchRow } from "./results";

/** ab so vielen Zeichen wird gesucht (wie `search_all`) */
export const MIN_QUERY = 2;

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Volltextsuche über Projekte, Aufgaben, Notizen (inkl. Inhalt) und Rückblicke, alle Bereiche. */
export function useSearch(text: string) {
  const getSupabase = useSupabase();
  const query = useDebouncedValue(text.trim(), 150);
  const enabled = query.length >= MIN_QUERY;
  const result = useQuery({
    queryKey: ["search", query],
    enabled,
    // Treffer beim Schließen der Palette verwerfen: Beim nächsten Öffnen wird frisch gesucht und
    // gerade Gespeichertes gefunden (Code-Review 15.10.2026). Solange sie offen ist, bleibt der
    // Cache, sonst zeichnen Neuabrufe die Liste unter der Tastatur-Auswahl neu.
    gcTime: 0,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SearchRow[]> => {
      const { data, error } = await getSupabase().rpc("search_all", { p_query: query });
      if (error) throw error;
      return data ?? [];
    },
  });
  return { ...result, query, enabled, rows: enabled ? (result.data ?? []) : [] };
}

const ICONS: Record<SearchKind, (done: boolean) => React.ReactNode> = {
  projekt: () => <Folder size={16} strokeWidth={1.5} aria-hidden />,
  aufgabe: (done) =>
    done ? (
      <SquareCheck size={16} strokeWidth={1.5} aria-hidden />
    ) : (
      <Square size={16} strokeWidth={1.5} aria-hidden />
    ),
  notiz: () => <FileText size={16} strokeWidth={1.5} aria-hidden />,
  rueckblick: () => <History size={16} strokeWidth={1.5} aria-hidden />,
};

/** Art in „Beste Treffer“ für Screenreader – dort mischen sich die Arten, das Symbol ist stumm. */
const KIND_LABELS: Record<SearchKind, string> = {
  projekt: "Projekt",
  aufgabe: "Aufgabe",
  notiz: "Notiz",
  rueckblick: "Rückblick",
};

/**
 * Treffer in der Befehlspalette (B10, Rückmeldung #19): Projekte, Aufgaben, Notizen, bei langen
 * Listen vorab „Beste Treffer“ (#84). Ein Treffer ersetzt die offene Seite (#96): Projekt, Notiz
 * und Rückblick auf ihrer Seite, die Aufgabe in „Aufgaben“ – nie als Panel neben einem schon
 * offenen Eintrag (dort drückte sie die Notiz zur schmalen Spalte zusammen).
 */
export function PaletteSearchResults({ text, onOpen }: { text: string; onOpen: () => void }) {
  const router = useRouter();
  const search = useSearch(text);
  const areas = useAreas();
  const projects = useProjects();
  const tasks = useTasks();
  const notes = useNotes();

  if (text.trim().length < MIN_QUERY) return null;

  const groups = groupSearchResults(search.rows, {
    areas: areas.data ?? [],
    projects: projects.data ?? [],
    tasks: tasks.data ?? [],
    notes: notes.data ?? [],
  });
  // noch die Treffer zum vorigen Suchtext: nicht als „keine Treffer“ melden
  const settled = !search.isFetching && search.query === text.trim();

  const open = (hit: SearchHit) => {
    onOpen();
    if (hit.kind === "projekt") router.push(appPath.project(hit.id));
    else if (hit.kind === "notiz") router.push(appPath.note(hit.id));
    else if (hit.kind === "aufgabe") router.push(appPath.task(hit.id));
    else router.push(appPath.recap(hit.id));
  };

  if (search.isError) return <PaletteNote>Die Suche ist gerade nicht erreichbar.</PaletteNote>;
  if (groups.length === 0) {
    return (
      <PaletteNote>
        {settled
          ? `Keine Treffer für „${text.trim()}“ in Projekten, Aufgaben, Notizen und Rückblicken.`
          : "Suche …"}
      </PaletteNote>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <PaletteGroup key={group.key} heading={group.heading}>
          {group.hits.map((hit) => (
            <PaletteItem
              key={hit.id}
              value={`${hit.kind}:${hit.id}`}
              onSelect={() => open(hit)}
              className="py-1.5"
            >
              {ICONS[hit.kind](hit.done)}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate", hit.done && "text-muted line-through")}>
                  {group.key === "beste" ? (
                    <span className="sr-only">{KIND_LABELS[hit.kind]}: </span>
                  ) : null}
                  {hit.title}
                </span>
                {hit.detail ? (
                  <span className="truncate text-meta text-faint">{hit.detail}</span>
                ) : null}
              </span>
            </PaletteItem>
          ))}
        </PaletteGroup>
      ))}
    </>
  );
}
