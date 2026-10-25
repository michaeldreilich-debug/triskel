/**
 * Daten für die KI-Schnittstelle (#33): ein Schnappschuss aller lebenden Einträge (Single-User,
 * wenige hundert Zeilen – je Aufruf frisch, kein Cache) und die Darstellung als Markdown mit
 * Links in die App. Lesen über dieselben Abfragen wie die App (`tasks/queries`, `notes/queries`).
 */
import {
  EVENT_LINK_COLUMNS,
  type EventLinkRow,
  linksOfTarget,
  toEventLink,
} from "@/features/calendar/links";
import type { ExportArea, ExportNote } from "@/features/export/vault";
import { createRenderer, eventLinkLabel, frontmatter } from "@/features/export/vault";
import {
  fetchNoteBlocks,
  fetchNotes,
  fetchTopics,
  type ServerNote,
} from "@/features/notes/queries";
import {
  type NoteTypeRow,
  noteTypeName,
  parseNoteType,
  type TopicRow,
} from "@/features/notes/types";
import type { BlockRow } from "@/features/outliner/model/serializer";
import {
  type MilestoneRow,
  PROJECT_STATUS_LABELS,
  type ProjectRow,
} from "@/features/projects/types";
import {
  fetchDependencies,
  fetchMilestones,
  fetchProjects,
  fetchTasks,
} from "@/features/tasks/queries";
import { recurrenceLabel } from "@/features/tasks/recurrence";
import {
  type DependencyRow,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskRow,
} from "@/features/tasks/types";
import { berlinDate, berlinTime } from "@/lib/dates";
import { taskBodyToMarkdown } from "../model/task-markdown";
import { type AiContext, appUrl, check, type Db, ref } from "./context";

export interface Snapshot {
  areas: ExportArea[];
  topics: TopicRow[];
  projects: ProjectRow[];
  milestones: MilestoneRow[];
  tasks: TaskRow[];
  dependencies: DependencyRow[];
  notes: ServerNote[];
  /** Notiz-Typen des Nutzers (#34, ohne Papierkorb) in Reihenfolge */
  noteTypes: Array<Pick<NoteTypeRow, "key" | "name" | "counts_as_knowledge">>;
  /** Termin-Verknüpfungen (#68, ohne gelöste) */
  eventLinks: EventLinkRow[];
}

export async function fetchAreas(db: Db): Promise<ExportArea[]> {
  return check(
    "Bereiche laden",
    await db.from("areas").select("id, name, sort").is("deleted_at", null).order("sort"),
  );
}

/** Notiz-Typen (#34, Migration 25) ohne Papierkorb. */
export async function fetchNoteTypes(
  db: Db,
): Promise<Array<Pick<NoteTypeRow, "key" | "name" | "counts_as_knowledge">>> {
  const rows = check(
    "Notiz-Typen laden",
    await db
      .from("note_types")
      .select("key, name, counts_as_knowledge")
      .is("deleted_at", null)
      .order("sort"),
  );
  return rows.map((row) => ({
    key: parseNoteType(row.key),
    name: row.name,
    counts_as_knowledge: row.counts_as_knowledge,
  }));
}

/** Termin-Verknüpfungen (#68, Migration 43) ohne gelöste. */
export async function fetchEventLinks(db: Db): Promise<EventLinkRow[]> {
  const rows = check(
    "Termin-Verknüpfungen laden",
    await db.from("event_links").select(EVENT_LINK_COLUMNS).is("deleted_at", null),
  );
  return (rows as unknown as Array<Record<string, unknown> & { id: string }>).map(toEventLink);
}

export async function loadSnapshot(db: Db): Promise<Snapshot> {
  const [areas, topics, projects, milestones, tasks, dependencies, notes, noteTypes, eventLinks] =
    await Promise.all([
      fetchAreas(db),
      fetchTopics(db),
      fetchProjects(db),
      fetchMilestones(db),
      fetchTasks(db),
      fetchDependencies(db),
      fetchNotes(db),
      fetchNoteTypes(db),
      fetchEventLinks(db),
    ]);
  return {
    areas,
    topics,
    projects,
    milestones,
    tasks,
    dependencies,
    notes,
    noteTypes,
    eventLinks,
  };
}

export const toExportNote = (note: ServerNote): ExportNote => ({
  ...note,
  type: parseNoteType(note.type),
});

export const areaName = (snapshot: Snapshot, id: string | null | undefined) =>
  snapshot.areas.find((a) => a.id === id)?.name ?? null;

/** Wo eine Aufgabe hingehört: Projekt bzw. Bereich bzw. Inbox. */
export function taskPlace(snapshot: Snapshot, task: TaskRow): string {
  if (task.in_inbox || !task.area_id) return "Inbox";
  const project = snapshot.projects.find((p) => p.id === task.project_id);
  const area = areaName(snapshot, task.area_id) ?? "Ohne Bereich";
  return project ? `${project.title.trim() || "Ohne Titel"} · ${area}` : area;
}

/**
 * Darstellung wie im Export (createRenderer), aber mit Links in die App samt ID.
 * `place`: Aufgabenzeilen nennen Projekt/Bereich (Listen), sonst nur die ID (Projektseite).
 */
export function renderer(
  snapshot: Snapshot,
  origin: string,
  options: { blocks?: Array<BlockRow & { note_id: string }>; place?: boolean } = {},
) {
  return createRenderer(
    {
      areas: snapshot.areas,
      topics: snapshot.topics,
      projects: snapshot.projects,
      milestones: snapshot.milestones,
      tasks: snapshot.tasks,
      dependencies: snapshot.dependencies,
      notes: snapshot.notes.map(toExportNote),
      blocks: options.blocks ?? [],
      noteTypes: snapshot.noteTypes,
      eventLinks: snapshot.eventLinks,
    },
    {
      project: (id) => {
        const project = snapshot.projects.find((p) => p.id === id);
        return project ? ref(project.title, appUrl.project(origin, id), id) : null;
      },
      note: (id, title) => {
        const note = snapshot.notes.find((n) => n.id === id);
        return note ? ref(note.title, appUrl.note(origin, id), id) : title;
      },
      noteRef: (id) => {
        const note = snapshot.notes.find((n) => n.id === id);
        return note ? note.title.trim() || "Ohne Titel" : undefined;
      },
      taskSuffix: (task) =>
        options.place ? ` · ${taskPlace(snapshot, task)} (id: ${task.id})` : ` (id: ${task.id})`,
    },
  );
}

/** Aufgabe als eigene Seite (fetch): Eigenschaften, Notiz/Checkliste, Blocker, Notizen. */
export function renderTask(snapshot: Snapshot, task: TaskRow, origin: string): string {
  const project = snapshot.projects.find((p) => p.id === task.project_id);
  const milestone = snapshot.milestones.find((m) => m.id === task.milestone_id);
  const titleOf = (id: string) => snapshot.notes.find((n) => n.id === id)?.title;
  const parts = [
    frontmatter({
      typ: "aufgabe",
      id: task.id,
      status: TASK_STATUS_LABELS[task.status],
      bereich: task.in_inbox || !task.area_id ? "Inbox" : areaName(snapshot, task.area_id),
      projekt: project ? ref(project.title, appUrl.project(origin, project.id), project.id) : null,
      meilenstein: milestone ? `${milestone.title} (id: ${milestone.id})` : null,
      prioritaet: task.priority ? PRIORITY_LABELS[task.priority] : null,
      faellig: task.due_date,
      geplant: task.scheduled_at
        ? `${berlinDate(task.scheduled_at)} ${berlinTime(task.scheduled_at)}`
        : null,
      dauer_min: task.duration_min,
      wiederholung: task.recurrence ? recurrenceLabel(task.recurrence) : null,
      fokus: task.focus_date,
      erledigt: task.completed_at ? berlinDate(task.completed_at) : null,
      erstellt: berlinDate(task.created_at),
      angelegt_von: task.created_by === "ai" ? "KI" : "Nutzer",
      zustaendig: task.assignee === "ai" ? "KI" : "Nutzer",
      termin: (() => {
        const events = linksOfTarget(snapshot.eventLinks, { taskId: task.id }).map(
          (l) => `${eventLinkLabel(l)} (kalender: ${l.google_calendar_id}, termin: ${l.event_id})`,
        );
        return events.length > 1 ? events : (events[0] ?? null);
      })(),
      geaendert: berlinDate(task.updated_at),
    }),
    `# ${task.title.trim() || "Ohne Titel"}`,
  ];
  const body = taskBodyToMarkdown(task.body, { resolveTitle: (id) => titleOf(id) });
  if (body) parts.push(body);
  const blockers = snapshot.dependencies
    .filter((d) => d.task_id === task.id)
    .map((d) => snapshot.tasks.find((t) => t.id === d.blocked_by_task_id))
    .filter((t): t is TaskRow => Boolean(t));
  if (blockers.length) {
    parts.push(
      "## Blockiert durch",
      blockers
        .map((t) => `- [${t.status === "erledigt" ? "x" : " "}] ${t.title} (id: ${t.id})`)
        .join("\n"),
    );
  }
  const notes = snapshot.notes.filter((n) => n.task_id === task.id);
  if (notes.length) {
    parts.push(
      "## Notizen",
      notes.map((n) => `- ${ref(n.title, appUrl.note(origin, n.id), n.id)}`).join("\n"),
    );
  }
  return `${parts.join("\n\n")}\n`;
}

/** Notiz als Zeile einer Liste. */
export function noteLine(snapshot: Snapshot, note: ServerNote, origin: string): string {
  const topic = snapshot.topics.find((t) => t.id === note.topic_id);
  const project = snapshot.projects.find((p) => p.id === note.project_id);
  const meta = [
    noteTypeName(snapshot.noteTypes, parseNoteType(note.type)),
    areaName(snapshot, note.area_id),
    topic ? `Thema ${topic.name}` : null,
    project ? `Projekt ${project.title}` : null,
    note.tags.length ? note.tags.map((t) => `#${t}`).join(" ") : null,
    `geändert ${berlinDate(note.edited_at)}`,
  ].filter(Boolean);
  const snippet = note.snippet.trim() ? `\n  ${note.snippet.trim().slice(0, 160)}` : "";
  return `- ${ref(note.title, appUrl.note(origin, note.id), note.id)} · ${meta.join(" · ")}${snippet}`;
}

/** Projekt als Zeile einer Liste: Status, Bereich, Fortschritt, nächster Meilenstein. */
export function projectLine(snapshot: Snapshot, project: ProjectRow, origin: string): string {
  const own = snapshot.tasks.filter((t) => t.project_id === project.id);
  const done = own.filter((t) => t.status === "erledigt").length;
  const next = snapshot.milestones
    .filter((m) => m.project_id === project.id && !m.done_at)
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))[0];
  const meta = [
    PROJECT_STATUS_LABELS[project.status],
    areaName(snapshot, project.area_id),
    own.length ? `${done}/${own.length} erledigt` : null,
    project.target_date ? `Ziel ${project.target_date}` : null,
    next ? `nächster Meilenstein: ${next.title}` : null,
  ].filter(Boolean);
  return `- ${ref(project.title, appUrl.project(origin, project.id), project.id)} · ${meta.join(" · ")}`;
}

/** Notiz mit Inhalt laden (fetch, update). */
export async function loadNoteBlocks(ctx: AiContext, noteId: string) {
  return fetchNoteBlocks(ctx.db, noteId);
}
