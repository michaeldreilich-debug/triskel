"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import {
  ArrowLeft,
  Globe,
  ImagePlus,
  Link2,
  ListChecks,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { FoldButton, WideToggle } from "@/components/shell/wide";
import { useBufferedText } from "@/components/ui/buffered";
import { Button, buttonClasses } from "@/components/ui/button";
import { copyAppLink } from "@/components/ui/copy-link";
import { DatePicker } from "@/components/ui/date-picker";
import { EditedLine } from "@/components/ui/edited-line";
import { FileDrop } from "@/components/ui/file-drop";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { AreaSummary } from "@/features/areas/defaults";
import { LinkedEvents } from "@/features/calendar/components/event-links";
import { useConvert } from "@/features/convert/api";
import { TouchPhotoButtons, useMediaPicker } from "@/features/outliner/components/media-picker";
import { OutlinerHelp } from "@/features/outliner/components/outliner-help";
import { useProjects } from "@/features/projects/api";
import { useRecaps } from "@/features/recaps/api";
import { OnThisDayList } from "@/features/recaps/components/on-this-day";
import { onThisDay } from "@/features/recaps/model";
import { NoteShareBadge } from "@/features/share/components/share-badge";
import { openNoteShare } from "@/features/share/components/share-dialog";
import { ProjectField } from "@/features/tasks/components/pickers";
import { TaskItem } from "@/features/tasks/components/task-item";
import { useTaskData } from "@/features/tasks/hooks";
import { useTaskPeek } from "@/features/tasks/peek";
import { TASK_STATUS_LABELS, taskTitle } from "@/features/tasks/types";
import {
  autoNoteTemplate,
  noteTemplatesFor,
  pendingTemplate,
  pendingTemplateKey,
  useTemplates,
} from "@/features/templates/api";
import { TemplateChips } from "@/features/templates/components/template-chips";
import { isEmptyDoc, noteTemplateDoc, withFreshIds } from "@/features/templates/model";
import type { TemplateRow } from "@/features/templates/types";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { berlinDate } from "@/lib/dates";
import { useSaveQueue } from "@/lib/save-queue/react";
import {
  blocksAfterLoadError,
  useBacklinks,
  useNoteActions,
  useNoteBlocks,
  useTaskBacklinks,
  useTopicActions,
} from "../api";
import { useNoteTypes } from "../note-types";
import type { NoteRow, NoteType, TopicRow } from "../types";
import { NoteEditor } from "./note-editor";
import { NoteTypePicker } from "./note-type-picker";
import { TagEditor } from "./tag-editor";
import { recentTopicIds, TopicPicker } from "./topic-picker";

const NO_TOPIC = "__ohne__";

function Property({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="flex min-h-11 items-center text-ui-sm text-faint md:min-h-8"
        >
          {label}
        </label>
      ) : (
        <span className="flex min-h-11 items-center text-ui-sm text-faint md:min-h-8">{label}</span>
      )}
      <div className="min-w-0">{children}</div>
    </>
  );
}

export interface NoteViewProps {
  note: NoteRow;
  notes: NoteRow[];
  areas: AreaSummary[];
  topics: TopicRow[];
  /** Link zurück zur Liste (Mobil) */
  backHref: string;
  hrefFor: (noteId: string) => string;
  onOpenNote: (noteId: string) => void;
  onTrashed: () => void;
  /** Rückverweise stehen ab 4xl in der eigenen Spalte; eingeklappt (#80) wieder unter der Notiz */
  backlinksInColumn?: boolean;
  /** Als Panel neben der Notizen-Datenbank (#88): Schließen, Einklappen, „Im Wissen öffnen“ */
  panel?: { onClose: () => void; onFold: () => void };
}

/**
 * Notiz rechts in der Wissen-Ansicht bzw. als Panel neben der Notizen-Datenbank (#88): Titel,
 * Eigenschaften, Outliner, Rückverweise.
 */
export function NoteView({
  note,
  notes,
  areas,
  topics,
  backHref,
  hrefFor,
  onOpenNote,
  onTrashed,
  backlinksInColumn = true,
  panel,
}: NoteViewProps) {
  const ids = {
    title: useId(),
    type: useId(),
    area: useId(),
    project: useId(),
    topic: useId(),
    tags: useId(),
  };
  const reviewedId = useId();
  const actions = useNoteActions();
  const convert = useConvert();
  const topicActions = useTopicActions();
  const projects = useProjects();
  const blocks = useNoteBlocks(note.id);
  const queue = useSaveQueue();
  const editorRef = useRef<Editor | null>(null);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [empty, setEmpty] = useState(false);
  const templates = useTemplates();
  const queryClient = useQueryClient();
  const noteTemplates = noteTemplatesFor(templates.data ?? [], note.type);

  /** Vorlage in die leere Notiz übernehmen (über den Editor → Diff → Warteschlange). */
  const applyTemplate = (template: TemplateRow, type: NoteType = note.type) => {
    const editor = editorRef.current;
    if (!editor || !isEmptyDoc(editor.getJSON())) return;
    editor.commands.setContent(withFreshIds(noteTemplateDoc(template.body)), { emitUpdate: true });
    if (template.note_type && template.note_type !== type) {
      actions.update(note.id, { type: template.note_type });
    }
  };

  // Beim Anlegen gewählte Vorlage (z. B. „Neues Protokoll“) anwenden, sobald der Editor bereit ist
  const pending = queryClient.getQueryData<string>(pendingTemplateKey(note.id));
  useEffect(() => {
    if (!pending || !empty) return;
    const template = pendingTemplate(templates.data, pending);
    if (!template) {
      // Vorlagen geladen, aber keine passende (Typ ohne Vorlage): nichts mehr vormerken
      if (templates.data) queryClient.removeQueries({ queryKey: pendingTemplateKey(note.id) });
      return;
    }
    queryClient.removeQueries({ queryKey: pendingTemplateKey(note.id) });
    applyTemplate(template);
  });
  const titleField = useBufferedText(
    note.title,
    (title) => actions.update(note.id, { title }),
    (raw) => raw.replace(/\n/g, " "),
  );
  const topic = topics.find((t) => t.id === note.topic_id);
  // Editor erst mit frischem Serverstand einhängen (offline: letzter bekannter Stand)
  const ready = blocks.data && (blocks.isFetchedAfterMount || blocks.isError);
  // Neuladen gescheitert (V-5): Cache vom letzten Mal plus alles, was die Warteschlange für diese
  // Notiz noch hält – nie gegen den alten Stand diffen und Wartendes überschreiben
  const blockData =
    blocks.data && blocks.isError && !blocks.isFetchedAfterMount
      ? blocksAfterLoadError(queue, blocks.data, note.id)
      : blocks.data;

  return (
    <FileDrop
      onFiles={(files) => editorRef.current?.chain().insertMedia(files, "end").run()}
      label="Loslassen: in die Notiz einfügen"
      className="w-full"
    >
      <article
        aria-labelledby={ids.title}
        className={cn(
          "flex w-full flex-col",
          panel ? "gap-5 px-6 py-5" : "gap-6 px-4 py-6 md:px-8 md:py-8 lg:px-10",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-ui-sm text-faint">
            {panel ? null : (
              <Link
                href={backHref}
                className="-ml-2 inline-flex size-11 items-center justify-center rounded-control text-muted hover:bg-surface-2 md:hidden"
                aria-label="Zurück zur Notizliste"
              >
                <ArrowLeft size={18} strokeWidth={1.5} aria-hidden />
              </Link>
            )}
            <span className="truncate">
              {panel ? "Notizen" : "Wissen"}
              {topic ? ` / ${topic.name}` : ""}
            </span>
            {/* öffentlich per Link (#94): sichtbar, ein Klick öffnet die Freigabe */}
            <NoteShareBadge noteId={note.id} />
          </div>
          <div className="flex shrink-0 items-center">
            {panel ? (
              <Link
                href={appPath.note(note.id)}
                aria-label="Im Wissen öffnen"
                title="Im Wissen öffnen (ganze Seite)"
                className={buttonClasses("ghost", "icon-sm")}
              >
                <Maximize2 size={16} strokeWidth={1.5} aria-hidden />
              </Link>
            ) : (
              <WideToggle mode="page" />
            )}
            <InsertMenu editorRef={editorRef} />
            <OutlinerHelp />
            <MenuRoot>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Notiz-Aktionen">
                  <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem onSelect={() => void convert.noteToTask(note.id)}>
                  <ListChecks aria-hidden />
                  In Aufgabe umwandeln
                </MenuItem>
                <MenuItem onSelect={() => copyAppLink(appPath.note(note.id))}>
                  <Link2 aria-hidden />
                  Link kopieren
                </MenuItem>
                <MenuItem onSelect={() => openNoteShare(note.id)}>
                  <Globe aria-hidden />
                  Öffentlich freigeben …
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="danger" onSelect={() => actions.trash(note.id, onTrashed)}>
                  <Trash2 aria-hidden />
                  In den Papierkorb
                </MenuItem>
              </MenuContent>
            </MenuRoot>
            {panel ? (
              <>
                <FoldButton label="Notiz" side="right" onClick={panel.onFold} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Notiz schließen"
                  onClick={panel.onClose}
                >
                  <X size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <textarea
          id={ids.title}
          aria-label="Titel"
          rows={1}
          {...titleField}
          placeholder="Ohne Titel"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              editorRef.current?.commands.focus("start");
            }
          }}
          className="heading w-full resize-none bg-transparent text-title-sm tracking-tight text-fg [field-sizing:content] placeholder:text-faint focus-visible:outline-none md:text-title"
        />
        <EditedLine at={note.edited_at} className="-mt-5" />
        <LinkedEvents target={{ noteId: note.id }} />

        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 border-b border-border pb-5 text-ui md:grid-cols-[110px_minmax(0,1fr)]">
          {/* Bereich zuerst, wie bei Aufgaben (Rückmeldung #21) */}
          <Property label="Bereich" htmlFor={ids.area}>
            <Select
              id={ids.area}
              value={note.area_id}
              onValueChange={(value) => {
                const keepTopic = topics.find((t) => t.id === note.topic_id)?.area_id === value;
                actions.update(note.id, {
                  area_id: value,
                  ...(keepTopic ? {} : { topic_id: null }),
                });
              }}
              options={areas.map((a) => ({
                value: a.id,
                label: a.name,
                icon: <AreaDot color={a.color} />,
              }))}
              variant="quiet"
            />
          </Property>
          {/* Zuordnung oben (#21); das Projekt bleibt sichtbar, auch archiviert (#26) */}
          <Property label="Projekt" htmlFor={ids.project}>
            <ProjectField
              id={ids.project}
              value={note.project_id}
              projects={projects.data ?? []}
              areas={areas}
              onSelect={(projectId) => actions.update(note.id, { project_id: projectId })}
            />
          </Property>
          <Property label="Typ" htmlFor={ids.type}>
            {/* eigene Typen suchen, anlegen, verwalten (#34) */}
            <NoteTypePicker
              id={ids.type}
              value={note.type}
              onSelect={(type) => {
                actions.update(note.id, { type });
                // leere Notiz bekommt die Vorlage ihres Typs (z. B. Protokoll)
                const template = empty ? autoNoteTemplate(templates.data ?? [], type) : undefined;
                if (template) applyTemplate(template, type);
              }}
            />
          </Property>
          <Property label="Thema" htmlFor={ids.topic}>
            <TopicPicker
              id={ids.topic}
              value={note.topic_id ?? NO_TOPIC}
              label={topic?.name ?? "Kein Thema"}
              muted={!topic}
              topics={topics}
              areas={areas}
              recentIds={recentTopicIds(notes)}
              fixed={[{ value: NO_TOPIC, label: "Kein Thema" }]}
              onSelect={(value) =>
                actions.update(note.id, { topic_id: value === NO_TOPIC ? null : value })
              }
              onCreate={(name) => {
                const created = topicActions.create(note.area_id, name);
                actions.update(note.id, { topic_id: created.id });
              }}
            />
          </Property>
          <Property label="Tags" htmlFor={ids.tags}>
            <TagEditor
              id={ids.tags}
              tags={note.tags}
              onChange={(tags) => actions.update(note.id, { tags })}
            />
          </Property>
          <Property label="Geprüft am" htmlFor={reviewedId}>
            <DatePicker
              id={reviewedId}
              value={note.reviewed_at}
              onChange={(value) => actions.update(note.id, { reviewed_at: value })}
              placeholder="Nie"
              variant="quiet"
            />
          </Property>
        </div>

        {ready && blocks.data ? (
          <div className="flex flex-col gap-3">
            {empty ? <TemplateChips templates={noteTemplates} onApply={applyTemplate} /> : null}
            {blockData && blockData.unconfirmed > 0 ? (
              <p
                data-testid="local-state-hint"
                className="rounded-control border border-warning/50 px-3 py-2 text-ui-sm text-warning"
              >
                Lokaler Stand geladen: {blockData.unconfirmed} noch nicht gespeicherte Änderung
                {blockData.unconfirmed === 1 ? "" : "en"} – wird gespeichert.
                {blocks.isError ? " Neuladen war nicht möglich." : ""}
              </p>
            ) : null}
            <NoteEditor
              key={note.id}
              note={note}
              initialRows={(blockData ?? blocks.data).rows}
              rows={blocks.isError ? undefined : blocks.data.rows}
              onOpenNote={onOpenNote}
              onTaskIdsChange={setTaskIds}
              onEmptyChange={setEmpty}
              editorRef={editorRef}
            />
          </div>
        ) : blocks.isError && !blocks.data ? (
          <p role="alert" className="text-ui text-danger">
            Inhalt konnte nicht geladen werden. Bitte Verbindung prüfen und neu laden.
          </p>
        ) : (
          <div className="flex flex-col gap-3" aria-busy="true">
            <span className="sr-only">Inhalt wird geladen</span>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-6 w-3/5" />
          </div>
        )}

        {taskIds.length > 0 ? <NoteTasks taskIds={taskIds} /> : null}

        <Backlinks
          noteId={note.id}
          notes={notes}
          topics={topics}
          hrefFor={hrefFor}
          className={backlinksInColumn ? "4xl:hidden" : undefined}
        />

        <NoteOnThisDay note={note} notes={notes} />
      </article>
    </FileDrop>
  );
}

/** „An diesem Tag“ (E24): was vor 1, 3, 12 Monaten am Tag dieser Notiz entstand (leer = nichts). */
function NoteOnThisDay({ note, notes }: { note: NoteRow; notes: NoteRow[] }) {
  const projects = useProjects();
  const recaps = useRecaps();
  const day = berlinDate(note.created_at);
  const groups = onThisDay(
    { start: day, end: day },
    { notes, projects: projects.data, recaps: recaps.data },
    note.id,
  );
  if (groups.length === 0) return null;
  return (
    <section aria-label="An diesem Tag" className="flex flex-col gap-2.5">
      <h2 className="text-meta uppercase tracking-widest text-faint">An diesem Tag</h2>
      <OnThisDayList groups={groups} label="Früher am selben Tag" />
    </section>
  );
}

/** Aufgaben aus Blöcken dieser Notiz („Block → Aufgabe“) mit Status, abhakbar. */
function NoteTasks({ taskIds }: { taskIds: string[] }) {
  const data = useTaskData();
  const tasks = taskIds
    .map((id) => data.tasks.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  if (tasks.length === 0) return null;
  const open = tasks.filter((t) => t.status !== "erledigt").length;
  return (
    <section aria-label="Aufgaben in dieser Notiz" className="flex flex-col gap-2.5">
      <h2 className="text-meta uppercase tracking-widest text-faint">Aufgaben · {open} offen</h2>
      <ul className="-mx-2.5 flex flex-col gap-0.5">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskItem task={task} ctx={data.ctx} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Backlinks({
  noteId,
  notes,
  topics,
  hrefFor,
  className,
  action,
}: {
  noteId: string;
  notes: NoteRow[];
  topics: TopicRow[];
  hrefFor: (noteId: string) => string;
  className?: string;
  /** Knopf rechts neben der Überschrift (Spalte einklappen, #80) */
  action?: React.ReactNode;
}) {
  const noteTypes = useNoteTypes();
  const backlinks = useBacklinks(noteId);
  // Aufgaben, deren Notiz per „((“ hierher verlinkt (Rückmeldung 12.10.2026)
  const taskBacklinks = useTaskBacklinks(noteId);
  const taskData = useTaskData();
  const peek = useTaskPeek();
  const items = (backlinks.data ?? [])
    .map((link) => notes.find((n) => n.id === link.noteId))
    .filter((n): n is NoteRow => Boolean(n))
    .sort((a, b) => a.title.localeCompare(b.title, "de"));
  const sourceTasks = (taskBacklinks.data ?? [])
    .map((id) => taskData.tasks.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .sort((a, b) => taskTitle(a).localeCompare(taskTitle(b), "de"));
  const pending = backlinks.isPending || taskBacklinks.isPending;
  const total = items.length + sourceTasks.length;

  return (
    <section aria-label="Verlinkt von" className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-meta uppercase tracking-widest text-faint">
          Verlinkt von · {pending ? "…" : total}
        </h2>
        {action}
      </div>
      {total === 0 && !pending ? (
        <p className="text-ui-sm text-faint">
          Noch keine Notiz und keine Aufgabe verweist hierher.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((source) => {
            const topicName = topics.find((t) => t.id === source.topic_id)?.name;
            return (
              <li key={source.id}>
                <Link
                  href={hrefFor(source.id)}
                  className="-mx-2 flex min-h-11 flex-col justify-center rounded-control px-2 py-1 hover:bg-surface-2 md:min-h-9"
                >
                  <span className="text-ui">{source.title.trim() || "Ohne Titel"}</span>
                  <span className="text-meta text-faint">
                    {noteTypes.name(source.type)}
                    {topicName ? ` · ${topicName}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
          {sourceTasks.map((task) => {
            const project = taskData.ctx.projects.find((p) => p.id === task.project_id);
            return (
              <li key={task.id}>
                <Link
                  href={peek.hrefFor(task.id)}
                  scroll={false}
                  className="-mx-2 flex min-h-11 flex-col justify-center rounded-control px-2 py-1 hover:bg-surface-2 md:min-h-9"
                >
                  <span
                    className={cn(
                      "text-ui",
                      task.status === "erledigt" && "text-faint line-through",
                    )}
                  >
                    {taskTitle(task)}
                  </span>
                  <span className="text-meta text-faint">
                    Aufgabe · {TASK_STATUS_LABELS[task.status]}
                    {project ? ` · ${project.title.trim() || "Ohne Titel"}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Bild oder Diagramm in die Notiz einfügen (auch am Handy, wo es kein Rechtsklick-Menü gibt). */
function InsertMenu({ editorRef }: { editorRef: React.RefObject<Editor | null> }) {
  const picker = useMediaPicker(() => editorRef.current);
  return (
    <>
      <TouchPhotoButtons picker={picker} iconOnly />
      <MenuRoot>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Einfügen: Bild, Datei oder Diagramm">
            <Plus size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={picker.pickImage}>
            <ImagePlus aria-hidden />
            Bild einfügen …
          </MenuItem>
          <MenuItem onSelect={picker.pickFile}>
            <Paperclip aria-hidden />
            Datei einfügen …
          </MenuItem>
          <MenuItem onSelect={() => editorRef.current?.chain().focus("end").insertMermaid().run()}>
            <Workflow aria-hidden />
            Diagramm (Mermaid)
          </MenuItem>
        </MenuContent>
      </MenuRoot>
      {picker.inputs}
    </>
  );
}
