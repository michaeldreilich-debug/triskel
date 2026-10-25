import type { AreaSummary } from "@/features/areas/defaults";
import type { NoteRow } from "@/features/notes/types";
import { type ProjectRow, projectTitle } from "@/features/projects/types";
import type { TaskRow } from "@/features/tasks/types";

/** Eine Zeile aus `search_all` (Migration 08/12). */
export interface SearchRow {
  kind: string;
  id: string;
  title: string;
  snippet: string;
  rank: number;
}

export type SearchKind = "projekt" | "aufgabe" | "notiz" | "rueckblick";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** zweite Zeile: wo der Eintrag liegt und – bei Treffern im Inhalt – ein Ausschnitt */
  detail: string;
  done: boolean;
}

export interface SearchGroup {
  /** Art der Treffer; „beste“ = die relevantesten Treffer aller Arten (#84) */
  key: SearchKind | "beste";
  heading: string;
  hits: SearchHit[];
}

/** Reihenfolge der Gruppen in der Palette (unter „Beste Treffer“). */
export const SEARCH_GROUPS: { kind: SearchKind; heading: string }[] = [
  { kind: "projekt", heading: "Projekte" },
  { kind: "aufgabe", heading: "Aufgaben" },
  { kind: "notiz", heading: "Notizen" },
  { kind: "rueckblick", heading: "Rückblicke" },
];

/** So viele Treffer stehen oben unter „Beste Treffer“ (#84) … */
export const TOP_HITS = 3;
/** … sobald es so viele Treffer sind – weniger passen ohne Scrollen ins Fenster. */
export const TOP_HITS_FROM = 6;

export interface SearchContext {
  areas: AreaSummary[];
  projects: ProjectRow[];
  tasks: TaskRow[];
  notes: NoteRow[];
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Treffer nach Art gruppieren (Reihenfolge innerhalb der Gruppe = Rang aus der Datenbank) und mit
 * dem Stand aus dem Cache anreichern: aktueller Titel, Bereich bzw. Projekt, erledigt. Bei langen
 * Listen stehen die relevantesten offenen Treffer vorab unter „Beste Treffer“ (#84) – sonst landet
 * die beste Notiz unter allen Projekten und Aufgaben.
 */
export function groupSearchResults(rows: SearchRow[], ctx: SearchContext): SearchGroup[] {
  const areaName = (id: string | null | undefined) => ctx.areas.find((a) => a.id === id)?.name;
  const hit = (row: SearchRow): SearchHit | null => {
    const snippet = oneLine(row.snippet ?? "");
    const detail = (...parts: (string | undefined | null | false)[]) =>
      parts.filter(Boolean).join(" · ");
    switch (row.kind) {
      case "projekt": {
        const project = ctx.projects.find((p) => p.id === row.id);
        const title = project ? projectTitle(project) : row.title || "Ohne Titel";
        const closed = project?.status === "abgeschlossen" || project?.status === "archiv";
        return {
          kind: "projekt",
          id: row.id,
          title,
          detail: detail(
            areaName(project?.area_id),
            closed && (project?.status === "archiv" ? "archiviert" : "abgeschlossen"),
            snippet,
          ),
          done: closed,
        };
      }
      case "aufgabe": {
        const task = ctx.tasks.find((t) => t.id === row.id);
        const project = ctx.projects.find((p) => p.id === task?.project_id);
        const where = project
          ? projectTitle(project)
          : task
            ? (areaName(task.area_id) ?? "Inbox")
            : undefined;
        return {
          kind: "aufgabe",
          id: row.id,
          title: task?.title.trim() || row.title || "Ohne Titel",
          detail: detail(where, task?.status === "erledigt" && "erledigt", snippet),
          done: task?.status === "erledigt",
        };
      }
      case "notiz": {
        const note = ctx.notes.find((n) => n.id === row.id);
        return {
          kind: "notiz",
          id: row.id,
          title: note?.title.trim() || row.title || "Ohne Titel",
          detail: detail(areaName(note?.area_id), snippet),
          done: false,
        };
      }
      case "rueckblick":
        return { kind: "rueckblick", id: row.id, title: row.title, detail: snippet, done: false };
      default:
        return null;
    }
  };
  const hits = rows.map(hit).filter((h): h is SearchHit => h !== null);
  // die Datenbank liefert nach Rang; jeder Treffer steht nur einmal (cmdk braucht eindeutige Werte)
  const top = hits.length >= TOP_HITS_FROM ? hits.filter((h) => !h.done).slice(0, TOP_HITS) : [];
  const rest = hits.filter((h) => !top.includes(h));
  // Erledigtes und Abgeschlossenes nach unten, sonst bleibt der Rang
  const byOpen = (a: SearchHit, b: SearchHit) => Number(a.done) - Number(b.done);
  const groups: SearchGroup[] = [
    { key: "beste", heading: "Beste Treffer", hits: top },
    ...SEARCH_GROUPS.map((g) => ({
      key: g.kind,
      heading: g.heading,
      hits: rest.filter((h) => h.kind === g.kind).sort(byOpen),
    })),
  ];
  return groups.filter((g) => g.hits.length > 0);
}
