"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { AreaDot, Pill } from "@/components/ui/pill";
import { SwipeRow, trashSwipe } from "@/components/ui/swipe-row";
import { useAreas } from "@/features/areas/api";
import { useProjects } from "@/features/projects/api";
import { NoteShareMark } from "@/features/share/components/share-badge";
import { ProjectField } from "@/features/tasks/components/pickers";
import { autoNoteTemplate, rememberNoteTemplate, useTemplates } from "@/features/templates/api";
import { CELL_CONTROL, CellMenu, CellPopover } from "@/features/views/components/cells";
import { type DatabaseDef, DatabaseView } from "@/features/views/components/database-view";
import { defaultCell } from "@/features/views/components/table-view";
import type { ViewConfig } from "@/features/views/engine";
import {
  NOTE_BOARD_FIELDS,
  NOTE_DEFAULTS,
  NOTE_FIELDS,
  type NoteViewCtx,
} from "@/features/views/entities/notes";
import { projectGroupLink, typeGroupLink } from "@/features/views/group-link";
import { berlinDate, formatDateShort, formatListDate } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import { useNoteActions, useNotes, useTopicActions, useTopics } from "../api";
import { useNoteTypes } from "../note-types";
import { useNoteOpener } from "../peek";
import { DEFAULT_NOTE_TYPE, type NoteRow, type NoteType, noteTitle } from "../types";
import { NoteContextMenu, NoteContextMenuItems } from "./note-context-menu";
import { NoteTypePicker } from "./note-type-picker";
import { TagEditor } from "./tag-editor";
import { recentTopicIds, TopicPicker } from "./topic-picker";

const NO_TOPIC = "__ohne__";

/** Lokaler Ansichts-Zustand der Notizen-Datenbank (`:2` seit #48, Gruppierung nach Projekt) */
const NOTES_STORAGE_KEY = "sz:ansicht:notes:2";

export interface NoteDatabaseProps {
  /** nur Notizen dieses Projekts (Projekt-Reiter, #91) */
  projectId?: string;
  /** Vorgabe ohne gespeicherte Ansicht (z. B. Projekt-Reiter: Tabelle) */
  defaults?: Partial<ViewConfig>;
  storageKey?: string;
  savedViews?: boolean;
  /** Neue Notiz (Typ, wenn im Board eine Spalte gewählt wurde); die Seite weiß, wohin sie gehört */
  onCreate: (type?: NoteType) => void;
  onCount?: (shown: number, total: number) => void;
}

/**
 * Notizen als Datenbank-Ansicht (B6): Liste, Tabelle, Board. Öffnen zeigt die Notiz ab 1280 px als
 * Panel rechts neben der Liste (#88), schmaler wie bisher in „Wissen“. Mit `projectId` die
 * Notizen eines Projekts (Reiter, #91) – ohne Projekt- und Bereichs-Spalte.
 */
export function NoteDatabase({
  projectId,
  defaults,
  storageKey = NOTES_STORAGE_KEY,
  savedViews = true,
  onCreate,
  onCount,
}: NoteDatabaseProps) {
  const { peek, inPanel, hrefOf: hrefOfId, menu } = useNoteOpener();
  const hrefOf = (note: NoteRow) => hrefOfId(note.id);
  const notes = useNotes();
  const topics = useTopics();
  const noteTypes = useNoteTypes();
  const projects = useProjects();
  const areas = useAreas();
  const actions = useNoteActions();
  const topicActions = useTopicActions();
  const areaList = areas.data ?? [];
  const topicList = topics.data ?? [];
  const projectList = projects.data ?? [];
  const typeList = noteTypes.types;
  const ctx: NoteViewCtx = useMemo(
    () => ({ areas: areaList, topics: topicList, projects: projectList, types: typeList }),
    [areaList, topicList, projectList, typeList],
  );
  const queries = [notes, topics, projects, areas];
  const error = queries.some((q) => q.isError && !q.data);

  const today = berlinDate();
  const noteList = notes.data ?? [];
  const rows = projectId ? noteList.filter((n) => n.project_id === projectId) : noteList;
  const recentTopics = recentTopicIds(noteList);

  const moveToArea = (note: NoteRow, areaId: string) => {
    const keepTopic = topicList.find((t) => t.id === note.topic_id)?.area_id === areaId;
    actions.update(note.id, { area_id: areaId, ...(keepTopic ? {} : { topic_id: null }) });
  };

  const def: DatabaseDef<NoteRow, NoteViewCtx> = {
    entity: "notes",
    label: "Notizen",
    hiddenNoun: { one: "weitere Notiz", many: "weitere Notizen" },
    // im Projekt folgen Projekt und Bereich dem Projekt: keine Spalten dafür
    fields: projectId
      ? NOTE_FIELDS.filter((f) => f.key !== "project" && f.key !== "area")
      : NOTE_FIELDS,
    defaults: { ...NOTE_DEFAULTS, ...defaults },
    boardFields: NOTE_BOARD_FIELDS,
    // #81: wie bei den Aufgaben (#79) sind die Projekte beim Öffnen zu, „Ohne Projekt“ (oben) offen
    startClosed: projectId ? undefined : { group: "project", open: [""] },
    searchFields: ["title", "snippet"],
    areaOf: (n) => n.area_id,
    renderListItem: (n) => {
      const topic = topicList.find((t) => t.id === n.topic_id);
      const typeLabel = n.type === DEFAULT_NOTE_TYPE ? null : noteTypes.name(n.type);
      return (
        <SwipeRow left={trashSwipe(() => actions.trash(n.id))}>
          <NoteContextMenu note={n} {...menu(n)}>
            <Link
              href={hrefOf(n)}
              scroll={false}
              aria-current={n.id === peek.noteId && inPanel ? "true" : undefined}
              className="flex min-h-11 flex-col gap-0.5 rounded-card px-2.5 py-2 transition-colors hover:bg-surface aria-[current=true]:bg-surface"
            >
              <span className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-ui font-medium">{noteTitle(n)}</span>
                <NoteShareMark noteId={n.id} />
                <span className="shrink-0 text-meta text-faint tabular-nums">
                  {formatListDate(n.edited_at)}
                </span>
              </span>
              <span className="truncate text-meta text-muted">
                {[typeLabel, topic?.name].filter(Boolean).length ? (
                  <span className="text-faint">
                    {[typeLabel, topic?.name].filter(Boolean).join(" · ")}
                    {n.snippet ? " · " : ""}
                  </span>
                ) : null}
                {n.snippet}
              </span>
            </Link>
          </NoteContextMenu>
        </SwipeRow>
      );
    },
    renderCard: (n) => {
      const topic = topicList.find((t) => t.id === n.topic_id);
      return (
        <article className="flex flex-col gap-1.5 rounded-card border border-border bg-surface p-3">
          <Link
            href={hrefOf(n)}
            scroll={false}
            draggable={false}
            className="text-ui font-medium hover:underline"
          >
            {noteTitle(n)}
            <NoteShareMark noteId={n.id} className="ml-1.5 align-middle" />
          </Link>
          {n.snippet ? <p className="line-clamp-2 text-meta text-muted">{n.snippet}</p> : null}
          <p className="flex items-center gap-2 text-meta text-faint">
            {topic ? <span className="truncate">{topic.name}</span> : null}
            <span className="ml-auto tabular-nums">{formatListDate(n.edited_at)}</span>
          </p>
        </article>
      );
    },
    contextMenu: (n) => <NoteContextMenuItems note={n} {...menu(n)} />,
    cells: {
      title: (n) => (
        <Link href={hrefOf(n)} scroll={false} className="font-medium hover:underline">
          {noteTitle(n)}
          <NoteShareMark noteId={n.id} className="ml-1.5 align-middle" />
        </Link>
      ),
      // #87: Eigenschaften direkt in der Zelle ändern – dieselben Auswahlen wie in der Notiz
      type: (n) => (
        <NoteTypePicker
          aria-label={`Typ: ${noteTypes.name(n.type)}`}
          value={n.type}
          onSelect={(type) => actions.update(n.id, { type })}
          label={<Pill>{noteTypes.name(n.type)}</Pill>}
          className={CELL_CONTROL}
        />
      ),
      area: (n) => {
        const a = areaList.find((x) => x.id === n.area_id);
        // im Projekt folgt der Bereich dem Projekt (Trigger, Migration 05) – wie in der Aufgaben-Tabelle (U-5)
        if (n.project_id) {
          return a ? (
            <span className="inline-flex items-center gap-1.5">
              <AreaDot color={a.color} />
              {a.name}
            </span>
          ) : (
            <span className="text-faint">–</span>
          );
        }
        return (
          <CellMenu
            label="Bereich"
            value={n.area_id}
            options={areaList.map((x) => ({
              value: x.id,
              label: x.name,
              icon: <AreaDot color={x.color} />,
            }))}
            onChange={(value) => moveToArea(n, value)}
          >
            {a ? (
              <span className="inline-flex items-center gap-1.5">
                <AreaDot color={a.color} />
                {a.name}
              </span>
            ) : (
              "–"
            )}
          </CellMenu>
        );
      },
      topic: (n) => {
        const topic = topicList.find((t) => t.id === n.topic_id);
        return (
          <TopicPicker
            aria-label={`Thema: ${topic?.name ?? "kein Thema"}`}
            value={n.topic_id ?? NO_TOPIC}
            label={topic?.name ?? "–"}
            muted={!topic}
            topics={topicList}
            areas={areaList}
            recentIds={recentTopics}
            fixed={[{ value: NO_TOPIC, label: "Kein Thema" }]}
            onSelect={(value) =>
              actions.update(n.id, { topic_id: value === NO_TOPIC ? null : value })
            }
            onCreate={(name) => {
              const created = topicActions.create(n.area_id, name);
              actions.update(n.id, { topic_id: created.id });
            }}
            className={CELL_CONTROL}
          />
        );
      },
      project: (n) => (
        <ProjectField
          aria-label="Projekt"
          value={n.project_id}
          projects={projectList}
          areas={areaList}
          onSelect={(projectId) => actions.update(n.id, { project_id: projectId })}
          showArea
          className={CELL_CONTROL}
        />
      ),
      tags: (n) => (
        <CellPopover
          label={`Tags: ${n.tags.length ? n.tags.join(", ") : "keine"}`}
          content={
            <TagEditor
              id={`tags-${n.id}`}
              tags={n.tags}
              onChange={(tags) => actions.update(n.id, { tags })}
            />
          }
        >
          {n.tags.length ? (
            <span className="truncate">{n.tags.map((t) => `#${t}`).join(" ")}</span>
          ) : (
            <span className="text-faint">–</span>
          )}
        </CellPopover>
      ),
      reviewed_at: (n) => {
        const field = NOTE_FIELDS.find((f) => f.key === "reviewed_at");
        return (
          <DatePicker
            variant="quiet"
            aria-label={`Geprüft am: ${n.reviewed_at ? formatDateShort(n.reviewed_at) : "nie"}`}
            value={n.reviewed_at}
            onChange={(value) => actions.update(n.id, { reviewed_at: value })}
            className={CELL_CONTROL}
            display={field ? defaultCell(field, n, ctx, today) : null}
          />
        );
      },
    },
    move: (n, field, value) => {
      if (field === "type") actions.update(n.id, { type: value as NoteType });
      else if (field === "area" && value) moveToArea(n, value);
    },
    onAdd: (field, value) => (field === "type" ? onCreate(value as NoteType) : onCreate()),
    storageUpgrade: projectId
      ? undefined
      : { from: "sz:ansicht:notes", patch: { group: "project" } },
    groupLink: (field, key) =>
      projectGroupLink(field, key, ctx.projects) ?? typeGroupLink(field, key, ctx.types),
    groupDecor: (field, key) => {
      const areaId =
        field === "project"
          ? ctx.projects.find((p) => p.id === key)?.area_id
          : field === "area"
            ? key
            : null;
      const a = areaList.find((x) => x.id === areaId);
      return a ? <AreaDot color={a.color} /> : null;
    },
    empty: {
      title: projectId ? "Noch keine Notizen im Projekt" : "Noch keine Notizen",
      description: projectId
        ? "Protokolle, Ideen und Wissen zum Projekt landen hier."
        : "Neue Notizen starten als Idee. Hier siehst du alle als Liste, Tabelle oder Board – gruppiert nach Projekt oder Typ; Wissen zeigt nur die Typen, die als Wissen zählen.",
      icon: <FileText strokeWidth={1.5} />,
    },
  };

  return (
    <DatabaseView
      def={def}
      rows={rows}
      ctx={ctx}
      areas={areaList}
      loading={!error && queries.some((q) => q.isPending)}
      error={error}
      onRetry={() => {
        for (const q of queries) void q.refetch();
      }}
      savedViews={savedViews}
      storageKey={storageKey}
      areaFilter={!projectId}
      onCount={onCount}
    />
  );
}

/** Seite „Notizen“: Kopf mit „Neue Notiz“ und die Datenbank. */
export function NotesDatabasePage() {
  const { open } = useNoteOpener();
  const area = useUi((s) => s.area);
  const areas = useAreas();
  const actions = useNoteActions();
  const templates = useTemplates();
  const queryClient = useQueryClient();
  const [count, setCount] = useState<{ shown: number; total: number } | null>(null);
  const onCount = useCallback((shown: number, total: number) => setCount({ shown, total }), []);
  const areaList = areas.data ?? [];
  const activeArea = area && areaList.some((a) => a.id === area) ? area : null;

  const create = (type?: NoteType) => {
    const areaId = activeArea ?? areaList[0]?.id;
    if (!areaId) return;
    const note = actions.create({ title: "", area_id: areaId, type: type ?? DEFAULT_NOTE_TYPE });
    // „Neues Protokoll“ (Typ gewählt) startet mit der Vorlage dieses Typs (B11)
    const template = type ? autoNoteTemplate(templates.data ?? [], type) : undefined;
    if (template) rememberNoteTemplate(queryClient, note.id, template);
    open(note.id);
  };

  return (
    <Page>
      <PageHeader
        title="Notizen"
        meta={
          <>
            Datenbank
            {count ? (
              <span className="tabular-nums">
                {" "}
                · {count.shown} von {count.total}
              </span>
            ) : null}
          </>
        }
        actions={
          <Button variant="primary" onClick={() => create()} disabled={areaList.length === 0}>
            <Plus size={16} strokeWidth={2} aria-hidden />
            Neue Notiz
          </Button>
        }
      />
      <NoteDatabase onCreate={create} onCount={onCount} />
    </Page>
  );
}
