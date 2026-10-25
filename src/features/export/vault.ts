/**
 * Markdown-Export (B14) als reine Funktion: alle Daten → Dateien eines Obsidian-Vaults.
 * - YAML-Frontmatter mit den Eigenschaften, Outliner als verschachtelte Liste, Links als
 *   `[[Datei|Titel]]` (Dateinamen sind im ganzen Vault eindeutig, doppelte bekommen „ (2)“).
 * - Projekte mit nummeriertem Fahrplan (Meilensteine in Reihenfolge, darunter ihre Aufgaben als
 *   Checkliste), damit Claude ihn Schritt für Schritt abarbeiten kann (Rückmeldung #12).
 * - `export.json` enthält alle Zeilen aller Tabellen (auch den Papierkorb) als Sicherung.
 */

import { taskBodyToMarkdown } from "@/features/ai/model/task-markdown";
import { type EventLinkRow, eventWhenLabel, linksOfTarget } from "@/features/calendar/links";
import {
  type NoteType,
  type NoteTypeRow,
  noteTypeName,
  parseNoteType,
} from "@/features/notes/types";
import { type BlockRow, outlineToMarkdown, rowsToDoc } from "@/features/outliner/model/serializer";
import { linkLabel, normalizeLinkUrl } from "@/features/projects/links";
import {
  type MilestoneRow,
  PROJECT_STATUS_LABELS,
  type ProjectRow,
} from "@/features/projects/types";
import {
  activityEntries,
  answerOf,
  groupBySection,
  questionsOf,
  recapRange,
  recapTitle,
} from "@/features/recaps/model";
import type { RecapRow } from "@/features/recaps/types";
import { recurrenceLabel } from "@/features/tasks/recurrence";
import { PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskRow } from "@/features/tasks/types";
import { berlinDate, formatDayShort, isoWeekNumber, isoWeekYear } from "@/lib/dates";

export interface ExportArea {
  id: string;
  name: string;
  sort: string;
}

export interface ExportTopic {
  id: string;
  area_id: string;
  name: string;
}

export interface ExportNote {
  id: string;
  title: string;
  type: NoteType;
  area_id: string;
  topic_id: string | null;
  project_id: string | null;
  task_id: string | null;
  tags: string[];
  reviewed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportInput {
  areas: ExportArea[];
  topics: ExportTopic[];
  projects: ProjectRow[];
  milestones: MilestoneRow[];
  tasks: TaskRow[];
  /** „Blockiert durch“: task_id → blocked_by_task_id */
  dependencies: Array<{ task_id: string; blocked_by_task_id: string }>;
  notes: ExportNote[];
  blocks: Array<BlockRow & { note_id: string }>;
  recaps: RecapRow[];
  /** Termin-Verknüpfungen (#68, ohne gelöste): „termin“ an Notiz und Aufgabe */
  eventLinks?: EventLinkRow[];
  /** Notiz-Typen des Nutzers (#34) für die Namen; fehlen sie, gelten die mitgelieferten */
  noteTypes?: Array<Pick<NoteTypeRow, "key" | "name">>;
  /** alle Zeilen aller Tabellen (auch gelöschte) für export.json */
  tables: Record<string, unknown[]>;
  /** Bilder aus Notizen (E24): Dateiname im Export → Inhalt */
  attachments?: Array<{ name: string; data: Uint8Array }>;
  /** Bilder/Dateien, die sich nicht laden ließen (fehlen im ZIP, T-10) */
  missingAttachments?: number;
  exportedAt: Date;
}

export const EXPORT_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Hilfen: Dateinamen, YAML                                           */
/* ------------------------------------------------------------------ */

/** Dateiname ohne Zeichen, die Dateisysteme oder Obsidian-Links stören. */
export function safeName(title: string, fallback = "Ohne Titel"): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 100)
    .trim();
  return cleaned || fallback;
}

/** Vergibt im ganzen Vault eindeutige Dateinamen (Obsidian löst Links über den Namen auf). */
export function createNamer() {
  const used = new Set<string>();
  return (title: string, fallback?: string) => {
    const base = safeName(title, fallback);
    let name = base;
    for (let n = 2; used.has(name.toLocaleLowerCase("de")); n++) name = `${base} (${n})`;
    used.add(name.toLocaleLowerCase("de"));
    return name;
  };
}

type YamlValue = string | number | boolean | null | undefined | string[];

/** YAML-Frontmatter; leere Werte fallen weg, Texte in doppelten Anführungszeichen (JSON = gültiges YAML). */
export function frontmatter(fields: Record<string, YamlValue>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: ${plain(value) ? value : JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

const YAML_WORDS = new Set(["true", "false", "yes", "no", "on", "off", "null", "y", "n"]);

/** Ohne Anführungszeichen: Datum oder ein einzelnes Wort, das YAML nicht anders deutet. */
const plain = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ||
  (/^\p{L}[\p{L}\d_-]*$/u.test(value) && !YAML_WORDS.has(value.toLowerCase()));

const day = (at: string | null | undefined) => (at ? berlinDate(at) : null);
const indent = (text: string, spaces = 2) =>
  text
    .split("\n")
    .map((line) => (line.trim() ? `${" ".repeat(spaces)}${line}` : ""))
    .join("\n");

/* ------------------------------------------------------------------ */
/* Darstellung je Eintrag (Export B14 und KI-Schnittstelle #33)       */
/* ------------------------------------------------------------------ */

export interface RenderData {
  areas: ExportArea[];
  topics: ExportTopic[];
  /** Projekte, Meilensteine und Aufgaben ohne Papierkorb */
  projects: ProjectRow[];
  milestones: MilestoneRow[];
  tasks: TaskRow[];
  dependencies: Array<{ task_id: string; blocked_by_task_id: string }>;
  notes: ExportNote[];
  blocks: Array<BlockRow & { note_id: string }>;
  /** Aufgaben hinter Aufgaben-Blöcken in Notizen (Export: auch aus dem Papierkorb) */
  blockTasks?: TaskRow[];
  /** Notiz-Typen des Nutzers (#34) */
  noteTypes?: Array<Pick<NoteTypeRow, "key" | "name">>;
  /** Termin-Verknüpfungen (#68, ohne gelöste) */
  eventLinks?: EventLinkRow[];
}

/** Wie Verweise aussehen: im Export Obsidian-Links, für die KI Links in die App mit ID. */
export interface RenderLinks {
  /** Verweis auf ein (nicht gelöschtes) Projekt, null = unbekannt */
  project: (id: string) => string | null;
  /** Verweis auf eine Notiz; unbekannte Notizen zeigen den mitgegebenen Titel */
  note: (id: string, title: string) => string;
  /** Inhalt von `[[…]]` im Notiztext, undefined = unbekannt */
  noteRef: (id: string) => string | undefined;
  /** Zusatz am Ende einer Aufgabenzeile (KI: die ID) */
  taskSuffix?: (task: TaskRow) => string;
}

const taskTitle = (t: TaskRow) => t.title.trim() || "Ohne Titel";
const byDue = (a: TaskRow, b: TaskRow) =>
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
  (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);
const bySort = <T extends { sort: string }>(a: T, b: T) =>
  a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0;

/** „Mi, 21.10. 19:00–21:00 · Übungsdienst“ (+ „(ganze Serie)“) aus dem Schnappschuss (#68). */
export const eventLinkLabel = (link: EventLinkRow) =>
  `${eventWhenLabel(link.event_start, link.event_end, link.event_all_day)} · ${
    link.event_title.trim() || "Termin"
  }${link.scope === "series" ? " (ganze Serie)" : ""}`;

export function createRenderer(data: RenderData, links: RenderLinks) {
  const { tasks, notes } = data;
  const eventsOf = (target: { taskId?: string; noteId?: string }) =>
    linksOfTarget(data.eventLinks ?? [], target).map(eventLinkLabel);
  const areaName = (id: string | null | undefined) =>
    data.areas.find((a) => a.id === id)?.name ?? "Ohne Bereich";

  const taskLine = (task: TaskRow) => {
    const events = eventsOf({ taskId: task.id });
    const meta = [
      task.due_date ? `fällig ${task.due_date}` : null,
      task.priority ? `Priorität ${PRIORITY_LABELS[task.priority].toLowerCase()}` : null,
      task.status === "in_arbeit" || task.status === "wartet"
        ? TASK_STATUS_LABELS[task.status].toLowerCase()
        : null,
      task.recurrence ? `wiederholt ${recurrenceLabel(task.recurrence)}` : null,
      task.created_by === "ai" ? "von KI angelegt" : null,
      task.assignee === "ai" ? "für die KI" : null,
      ...events.map((e) => `Termin ${e}`),
      task.status === "erledigt" && task.completed_at ? `erledigt ${day(task.completed_at)}` : null,
    ].filter(Boolean);
    const blockers = data.dependencies
      .filter((d) => d.task_id === task.id)
      .map((d) => tasks.find((t) => t.id === d.blocked_by_task_id))
      .filter((t): t is TaskRow => Boolean(t) && t?.status !== "erledigt");
    if (blockers.length) meta.push(`blockiert durch ${blockers.map(taskTitle).join(", ")}`);
    const line = `- [${task.status === "erledigt" ? "x" : " "}] ${taskTitle(task)}${
      meta.length ? ` (${meta.join(" · ")})` : ""
    }${links.taskSuffix?.(task) ?? ""}`;
    const body = task.body_text.trim();
    return body ? `${line}\n${indent(body, 4)}` : line;
  };

  const project = (project: ProjectRow): string => {
    const own = tasks.filter((t) => t.project_id === project.id);
    const done = own.filter((t) => t.status === "erledigt").length;
    const steps = data.milestones.filter((m) => m.project_id === project.id).sort(bySort);
    const nextMilestone = steps.find((m) => !m.done_at);
    const next = tasks.find((t) => t.id === project.next_task_id);
    const parts: string[] = [
      frontmatter({
        typ: "projekt",
        id: project.id,
        bereich: areaName(project.area_id),
        status: PROJECT_STATUS_LABELS[project.status],
        prioritaet: project.priority ? PRIORITY_LABELS[project.priority] : null,
        start: project.start_date,
        ziel: project.target_date,
        fortschritt: own.length ? `${done}/${own.length}` : null,
        naechster_meilenstein: nextMilestone?.title ?? null,
        erstellt: day(project.created_at),
        geaendert: day(project.updated_at),
      }),
      `# ${project.title.trim() || "Projekt ohne Titel"}`,
    ];
    if (project.why.trim()) parts.push("## Warum", project.why.trim());
    const outcome = project.outcome.filter((o) => o.text.trim());
    if (outcome.length) {
      parts.push(
        "## Fertig ist es, wenn …",
        outcome.map((o) => `- [${o.done ? "x" : " "}] ${o.text.trim()}`).join("\n"),
      );
    }
    // Links (Migration 22): nur sichere Adressen, Klammern im Namen stören Markdown-Links nicht
    const linkLines = project.links.flatMap((link) => {
      const url = normalizeLinkUrl(link.url);
      return url ? [`- [${linkLabel(link).replace(/[[\]]/g, "")}](${url})`] : [];
    });
    if (linkLines.length) parts.push("## Links", linkLines.join("\n"));
    // Freitext im Reiter Übersicht (#44) – Checkliste, Notiz-Links und Bilder wie in der App
    const free = taskBodyToMarkdown(project.body, { resolveTitle: links.noteRef }).trim();
    if (free) parts.push("## Freitext", free);
    if (next) parts.push("## Nächster Schritt", taskLine(next));
    if (steps.length) {
      parts.push(
        "## Fahrplan",
        "Meilensteine in Reihenfolge. Abarbeiten: den ersten offenen Meilenstein zuerst, darin die offenen Aufgaben von oben nach unten.",
      );
      steps.forEach((milestone, index) => {
        const state = milestone.done_at ? `erreicht ${day(milestone.done_at)}` : "offen";
        const due = milestone.due_date ? ` · fällig ${milestone.due_date}` : "";
        const list = own.filter((t) => t.milestone_id === milestone.id).sort(byDue);
        parts.push(
          `### ${index + 1}. ${milestone.title.trim() || "Ohne Titel"}${due} · ${state}`,
          list.length ? list.map(taskLine).join("\n") : "_Noch keine Aufgaben._",
        );
      });
    }
    const loose = own
      .filter((t) => !t.milestone_id || !steps.some((m) => m.id === t.milestone_id))
      .sort(byDue);
    if (loose.length) {
      parts.push(steps.length ? "## Aufgaben ohne Meilenstein" : "## Aufgaben");
      parts.push(loose.map(taskLine).join("\n"));
    }
    const projectNotes = notes.filter((n) => n.project_id === project.id);
    if (projectNotes.length) {
      parts.push(
        "## Notizen",
        projectNotes.map((n) => `- ${links.note(n.id, n.title)}`).join("\n"),
      );
    }
    const reflection = project.closing_reflection;
    if (reflection && (reflection.worked || reflection.takeaway || reflection.open)) {
      parts.push(
        "## Abschluss",
        [
          `- Was hat geklappt? ${reflection.worked}`,
          `- Was nehme ich mit? ${reflection.takeaway}`,
          `- Was blieb offen? ${reflection.open}`,
        ].join("\n"),
      );
    }
    return `${parts.join("\n\n")}\n`;
  };

  const blocksByNote = new Map<string, BlockRow[]>();
  for (const block of data.blocks) {
    if (block.deleted_at) continue;
    blocksByNote.set(block.note_id, [...(blocksByNote.get(block.note_id) ?? []), block]);
  }
  const taskById = new Map((data.blockTasks ?? tasks).map((t) => [t.id, t]));

  const note = (note: ExportNote): string => {
    const topic = data.topics.find((t) => t.id === note.topic_id);
    const doc = rowsToDoc(blocksByNote.get(note.id) ?? []);
    const body = outlineToMarkdown(doc.content ?? [], {
      resolveTitle: links.noteRef,
      taskDone: (id) => taskById.get(id)?.status === "erledigt",
    });
    const task = note.task_id ? taskById.get(note.task_id) : undefined;
    const content = [
      frontmatter({
        typ: "notiz",
        notiztyp: noteTypeName(data.noteTypes ?? [], parseNoteType(note.type)),
        id: note.id,
        bereich: areaName(note.area_id),
        thema: topic?.name ?? null,
        projekt: note.project_id ? links.project(note.project_id) : null,
        aufgabe: task ? taskTitle(task) : null,
        termin: (() => {
          const events = eventsOf({ noteId: note.id });
          return events.length > 1 ? events : (events[0] ?? null);
        })(),
        tags: note.tags,
        geprueft: day(note.reviewed_at),
        archiviert: day(note.archived_at),
        erstellt: day(note.created_at),
        geaendert: day(note.updated_at),
      }),
      `# ${note.title.trim() || "Ohne Titel"}`,
      // leere Notiz: nur ein leerer Punkt – weglassen
      body.trim() === "-" ? "" : body,
    ]
      .filter(Boolean)
      .join("\n\n");
    return `${content}\n`;
  };

  const recap = (recap: RecapRow): string => {
    const parts: string[] = [
      frontmatter({
        typ: "rueckblick",
        art: recap.kind,
        id: recap.id,
        kw: recap.kind === "woche" ? isoWeekNumber(recap.period_start) : null,
        start: recap.period_start,
        ende: recap.period_end,
        stimmung: recap.mood,
        energie: recap.energy,
        sport: recap.sport,
        beziehungen: recap.relations,
        lernen: recap.learning,
        themen: recap.themes,
        abgeschlossen: day(recap.closed_at),
      }),
      `# ${recapTitle(recap)} · ${recapRange(recap)}`,
    ];
    for (const group of groupBySection(questionsOf(recap))) {
      if (group.section) parts.push(`## ${group.section}`);
      for (const question of group.questions) {
        const value = answerOf(recap, question);
        const text = Array.isArray(value)
          ? value
              .filter((v) => v.trim())
              .map((v, i) => `${i + 1}. ${v.trim()}`)
              .join("\n")
          : value === null || value === ""
            ? ""
            : question.type === "scale"
              ? `${value} von 5`
              : String(value);
        parts.push(`${group.section ? "###" : "##"} ${question.label}`, text || "_offen_");
      }
    }
    if (recap.themes.length) {
      parts.push("## Themen und Muster", recap.themes.map((t) => `#${t}`).join(" "));
    }
    const stats = recap.stats;
    if (stats) {
      const areas = stats.byArea.map((a) => `${a.name ?? "Inbox"} ${a.count}`).join(", ");
      const lines = [
        `- Erledigt: ${stats.tasksDone}${areas ? ` (${areas})` : ""}`,
        `- Meilensteine erreicht: ${stats.milestonesDone}`,
        `- Fokus-Tage: ${stats.focusDays.achieved} von ${stats.focusDays.planned}`,
      ];
      if (stats.notesCreated !== null) lines.push(`- Neue Notizen: ${stats.notesCreated}`);
      if (stats.stuckProjects.length) {
        lines.push(
          `- Festgefahren: ${stats.stuckProjects.map((p) => links.project(p.id) ?? p.title).join(", ")}`,
        );
      }
      parts.push("## Zahlen", lines.join("\n"));
      const days = (stats.activity ?? []).filter((d) => activityEntries(d).length > 0);
      if (days.length) {
        parts.push(
          "## Tagesverlauf",
          days
            .map((d) =>
              [
                `### ${formatDayShort(d.date)}`,
                ...activityEntries(d).map((e) => {
                  const what =
                    e.kind === "done"
                      ? "erledigt"
                      : e.kind === "milestone"
                        ? "Meilenstein erreicht"
                        : e.kind === "note_new"
                          ? "Notiz angelegt"
                          : "Notiz bearbeitet";
                  const target =
                    e.kind === "note_new" || e.kind === "note_edit"
                      ? links.note(e.id, e.title)
                      : e.title.trim() || "Ohne Titel";
                  return `- ${e.time} ${what}: ${target}`;
                }),
              ].join("\n"),
            )
            .join("\n\n"),
        );
      }
    } else {
      parts.push("## Zahlen", "_Noch nicht abgeschlossen – die Zahlen hält das Abschließen fest._");
    }
    return `${parts.join("\n\n")}\n`;
  };

  return { areaName, taskLine, project, note, recap };
}

/* ------------------------------------------------------------------ */
/* Vault                                                              */
/* ------------------------------------------------------------------ */

export interface VaultFile {
  path: string;
  /** Text (Markdown, JSON) oder Binärdaten (Bilder) */
  content: string | Uint8Array;
}

export function buildVault(input: ExportInput): VaultFile[] {
  const name = createNamer();
  const files: VaultFile[] = [];
  const live = <T extends { deleted_at?: string | null }>(rows: T[]) =>
    rows.filter((r) => !r.deleted_at);

  const projects = live(input.projects);
  const tasks = live(input.tasks);
  const notes = input.notes;
  const recaps = live(input.recaps);

  // Namen zuerst vergeben (Links brauchen sie): Projekte, Notizen, Rückblicke
  const projectFile = new Map(projects.map((p) => [p.id, name(p.title, "Projekt ohne Titel")]));
  const noteFile = new Map(notes.map((n) => [n.id, name(n.title)]));
  const recapFile = new Map(
    recaps.map((r) => [
      r.id,
      name(
        r.kind === "woche"
          ? `Wochenrückblick ${isoWeekYear(r.period_start)}-KW${String(isoWeekNumber(r.period_start)).padStart(2, "0")}`
          : `Monatsrückblick ${r.period_start.slice(0, 7)}`,
      ),
    ]),
  );
  const link = (file: string | undefined, title: string) => {
    if (!file) return title;
    const shown = title.trim() || "Ohne Titel";
    return file === shown ? `[[${file}]]` : `[[${file}|${shown}]]`;
  };

  const render = createRenderer(
    {
      areas: input.areas,
      topics: input.topics,
      projects,
      milestones: live(input.milestones),
      tasks,
      dependencies: input.dependencies,
      notes,
      blocks: input.blocks,
      blockTasks: input.tasks,
      noteTypes: input.noteTypes,
      eventLinks: input.eventLinks,
    },
    {
      project: (id) => {
        const project = projects.find((p) => p.id === id);
        return project ? link(projectFile.get(project.id), project.title) : null;
      },
      note: (id, title) => link(noteFile.get(id), title),
      noteRef: (id) => {
        const target = notes.find((n) => n.id === id);
        if (!target) return undefined;
        const file = noteFile.get(id) as string;
        const shown = target.title.trim() || "Ohne Titel";
        return file === shown ? file : `${file}|${shown}`;
      },
    },
  );
  const { areaName } = render;

  /* ---------------- Projekte ---------------- */
  for (const project of projects) {
    files.push({
      path: `Projekte/${safeName(areaName(project.area_id))}/${projectFile.get(project.id)}.md`,
      content: render.project(project),
    });
  }

  /* ---------------- Aufgaben ohne Projekt (je Bereich, Inbox) ---------------- */
  const loose = tasks.filter((t) => !t.project_id || !projects.some((p) => p.id === t.project_id));
  const groups = new Map<string, TaskRow[]>();
  for (const task of loose) {
    const key = task.in_inbox || !task.area_id ? "Inbox" : areaName(task.area_id);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  for (const [group, list] of groups) {
    const open = list.filter((t) => t.status !== "erledigt").sort(byDue);
    const closed = list
      .filter((t) => t.status === "erledigt")
      .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    const parts = [
      frontmatter({ typ: "aufgaben", bereich: group, offen: open.length }),
      `# Aufgaben · ${group}`,
      "## Offen",
      open.length ? open.map(render.taskLine).join("\n") : "_Nichts offen._",
    ];
    if (closed.length) parts.push("## Erledigt", closed.map(render.taskLine).join("\n"));
    files.push({ path: `Aufgaben/${safeName(group)}.md`, content: `${parts.join("\n\n")}\n` });
  }

  /* ---------------- Notizen ---------------- */
  for (const note of notes) {
    const topic = input.topics.find((t) => t.id === note.topic_id);
    const folder = [
      "Wissen",
      safeName(areaName(note.area_id)),
      ...(topic ? [safeName(topic.name)] : []),
    ].join("/");
    files.push({ path: `${folder}/${noteFile.get(note.id)}.md`, content: render.note(note) });
  }

  /* ---------------- Rückblicke ---------------- */
  for (const recap of recaps) {
    files.push({
      // Ordner nach dem Jahr, zu dem der Rückblick zählt: KW 01/2026 beginnt am 29.12.2025 (T-17)
      path: `Rückblicke/${recap.kind === "woche" ? isoWeekYear(recap.period_start) : recap.period_start.slice(0, 4)}/${recapFile.get(recap.id)}.md`,
      content: render.recap(recap),
    });
  }

  // Bilder liegen unter „Anhänge/“; Obsidian findet ![[datei]] über den Namen
  for (const attachment of input.attachments ?? []) {
    files.push({ path: `Anhänge/${attachment.name}`, content: attachment.data });
  }

  const markdown = files.filter((f) => f.path.endsWith(".md")).length;
  files.push({ path: "README.md", content: readme(input, markdown) });
  files.push({
    path: "export.json",
    content: `${JSON.stringify(
      {
        version: EXPORT_VERSION,
        exported_at: input.exportedAt.toISOString(),
        tables: input.tables,
      },
      null,
      2,
    )}\n`,
  });
  return files;
}

function readme(input: ExportInput, count: number): string {
  const date = berlinDate(input.exportedAt);
  return `${[
    `# Triskel – Export vom ${date}`,
    `${count} Markdown-Dateien. In Obsidian: „Ordner als Vault öffnen“.`,
    "## Aufbau",
    [
      "- `Projekte/<Bereich>/` – je Projekt eine Datei: Warum, „Fertig ist es, wenn …“, Links, nächster Schritt, Fahrplan, Aufgaben, Notizen",
      "- `Aufgaben/` – Aufgaben ohne Projekt je Bereich, dazu die Inbox",
      "- `Wissen/<Bereich>/<Thema>/` – Notizen als verschachtelte Listen, Verweise als `[[Notiz]]`",
      "- `Rückblicke/<Jahr>/` – Wochen- und Monatsrückblicke mit Antworten, Zahlen und Tagesverlauf",
      "- `Anhänge/` – Bilder aus den Notizen (eingebettet als `![[datei]]`); Diagramme stehen als ```mermaid-Block in der Notiz",
      "- `export.json` – alle Daten aller Tabellen (auch der Papierkorb) als Sicherung",
    ].join("\n"),
    "## Fahrplan abarbeiten (für Claude)",
    "Jedes Projekt mit Meilensteinen hat einen Abschnitt „Fahrplan“: nummerierte Meilensteine in Reihenfolge, darunter ihre Aufgaben als Checkliste (`- [ ]` offen, `- [x]` erledigt). Abarbeiten: den ersten offenen Meilenstein zuerst, darin die offenen Aufgaben von oben nach unten. Die Eigenschaft `naechster_meilenstein` im Kopf der Datei nennt ihn.",
  ].join("\n\n")}\n`;
}

/** Zeilen aus einer Tabelle für export.json: ohne die berechneten Suchspalten. */
export function stripComputed(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map(({ search: _search, ...row }) => row);
}
