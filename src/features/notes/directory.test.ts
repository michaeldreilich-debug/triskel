import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { noteItems } from "@/features/outliner/extensions/suggestions";
import { notesKey } from "./api";
import { createQueryNoteDirectory, createQueryTagDirectory } from "./directory";
import type { NoteRow } from "./types";

const note = (id: string, title: string, extra: Partial<NoteRow> = {}): NoteRow => ({
  id,
  title,
  type: "wissen",
  area_id: "a",
  topic_id: null,
  project_id: null,
  task_id: null,
  tags: [],
  reviewed_at: null,
  archived_at: null,
  created_at: "2026-10-11T10:00:00Z",
  updated_at: "2026-10-11T10:00:00Z",
  deleted_at: null,
  edited_at: "2026-10-11T10:00:00Z",
  snippet: "",
  ...extra,
});

function setup(notes: NoteRow[]) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(notesKey, notes);
  const create = vi.fn((title: string) => {
    const id = `neu-${title}`;
    queryClient.setQueryData<NoteRow[]>(notesKey, (old) => [...(old ?? []), note(id, title)]);
    return id;
  });
  return { queryClient, create, dir: createQueryNoteDirectory(queryClient, { create }) };
}

describe("Notizverzeichnis aus dem Query-Cache", () => {
  it("archivierte Notiz: mit passendem Titel unten angeboten und gekennzeichnet (O-9)", () => {
    const { dir } = setup([
      note("1", "Wartungsplan 2025", { archived_at: "2026-01-02T10:00:00Z" }),
      note("2", "Wartungsplan 2026"),
      note("3", "Alte Liste", { archived_at: "2026-01-02T10:00:00Z" }),
    ]);
    expect(dir.search("Wartungsplan")).toEqual([
      { id: "2", title: "Wartungsplan 2026" },
      { id: "1", title: "Wartungsplan 2025", archived: true },
    ]);
    // ohne Suchtext und ohne passenden Anfang bleiben archivierte draußen
    expect(dir.search("").map((n) => n.id)).toEqual(["2"]);
    expect(dir.search("Liste")).toEqual([]);
    const items = noteItems(dir, "Wartungsplan 2025");
    expect(items).toEqual([{ kind: "note", id: "1", title: "Wartungsplan 2025", archived: true }]);
  });

  it("löst Titel per ID auf, leere Titel als „Ohne Titel“, unbekannte als undefined", () => {
    const { dir } = setup([note("1", "Wartungsplan PA"), note("2", "  ")]);
    expect(dir.titleOf("1")).toBe("Wartungsplan PA");
    expect(dir.titleOf("2")).toBe("Ohne Titel");
    expect(dir.titleOf("x")).toBeUndefined();
  });

  it("Suche: Anfangstreffer vor Teiltreffern, archivierte nur ganz unten (O-9)", () => {
    const { dir } = setup([
      note("1", "Atemschutz Prüfung"),
      note("2", "Prüffristen Atemschutz"),
      note("3", "Atemschutz alt", { archived_at: "2026-01-01" }),
    ]);
    expect(dir.search("atem").map((n) => n.id)).toEqual(["1", "2", "3"]);
    expect(dir.search("schutz").map((n) => n.id)).toEqual(["1", "2"]);
  });

  it("Umbenennen im Cache: Titel und Abonnenten aktualisieren sich", () => {
    const { dir, queryClient } = setup([note("1", "Alt")]);
    const listener = vi.fn();
    const unsubscribe = dir.subscribe(listener);
    queryClient.setQueryData<NoteRow[]>(notesKey, [note("1", "Neu")]);
    expect(dir.titleOf("1")).toBe("Neu");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("findet per Titel (ohne Groß-/Kleinschreibung) und legt neue Notizen an", () => {
    const { dir, create } = setup([note("1", "Wartungsplan PA")]);
    expect(dir.findByTitle(" wartungsplan pa ")).toBe("1");
    expect(dir.create("  Neue Notiz ")).toBe("neu-Neue Notiz");
    expect(create).toHaveBeenCalledWith("Neue Notiz");
    expect(dir.titleOf("neu-Neue Notiz")).toBe("Neue Notiz");
  });
});

describe("Tag-Verzeichnis", () => {
  it("sammelt Tags aller Notizen, Präfixsuche", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(notesKey, [
      note("1", "a", { tags: ["pa", "prüfung"] }),
      note("2", "b", { tags: ["pa", "wartung"] }),
    ]);
    const tags = createQueryTagDirectory(queryClient);
    expect(tags.search("p")).toEqual(["pa", "prüfung"]);
    expect(tags.search("")).toEqual(["pa", "prüfung", "wartung"]);
  });
});
