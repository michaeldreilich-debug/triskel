"use client";

import {
  BookOpen,
  FileText,
  FolderPlus,
  Hash,
  Inbox,
  Link2,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { FoldButton, Rail, useWide } from "@/components/shell/wide";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwipeRow, trashSwipe } from "@/components/ui/swipe-row";
import { useAreas } from "@/features/areas/api";
import type { AreaSummary } from "@/features/areas/defaults";
import { NoteShareMark } from "@/features/share/components/share-badge";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { formatListDate } from "@/lib/dates";
import { useLocalFlag, useLocalNumber } from "@/lib/local-pref";
import type { NoteSort } from "@/lib/ui-prefs";
import { useUi } from "@/lib/ui-store";
import { useNoteActions, useNotes, useTopicActions, useTopics } from "../api";
import { isKnowledgeNote, needsSorting, splitKnowledge } from "../knowledge";
import { useNoteTypes } from "../note-types";
import { sortNotes } from "../sort";
import { DEFAULT_NOTE_TYPE, type NoteRow, type NoteType, type TopicRow } from "../types";
import { NoteContextMenu } from "./note-context-menu";
import { NoteTypePicker } from "./note-type-picker";
import { Backlinks, NoteView } from "./note-view";
import { recentTopicIds, TopicPicker } from "./topic-picker";

/** Themenfilter in der URL: Themen-ID, „ohne“ (Notizen ohne Thema) oder nichts (alle). */
const WITHOUT_TOPIC = "ohne";
const ALL_TOPICS = "__alle__";
/** Ab so vielen Themen erscheint in der Themen-Spalte ein Filterfeld */
const TOPIC_FILTER_FROM = 8;
/** Spaltenbreiten in px (#83): am Rand ziehbar, je Gerät gemerkt */
const TOPICS_WIDTH = { initial: 240, min: 192, max: 480 };
const LIST_WIDTH = { initial: 320, min: 256, max: 640 };
const LINKS_WIDTH = { initial: 288, min: 224, max: 480 };

/** „Noch einordnen“ (Chip in der Kopfzeile) steht als `?einordnen=1` in der Adresse – dann gilt kein Thema. */
const SORTING_PARAM = "einordnen";

export function wissenHref(noteId: string | null, topic: string | null, sorting = false): string {
  const path = noteId ? appPath.note(noteId) : appPath.knowledge();
  if (sorting) return `${path}?${SORTING_PARAM}=1`;
  return topic ? `${path}?thema=${encodeURIComponent(topic)}` : path;
}

function matchesTopic(note: NoteRow, topic: string | null, topicIds: Set<string>): boolean {
  if (!topic) return true;
  if (topic === WITHOUT_TOPIC) return !note.topic_id || !topicIds.has(note.topic_id);
  return note.topic_id === topic;
}

/**
 * Wissen (B4, #56): Themen | Notizliste | Notiz (+ Rückverweise). Die Liste zeigt nur Notizen
 * von Typen, die als Wissen zählen (Einstellungen › Notiz-Typen); „Noch einordnen“ zeigt die
 * übrigen ohne Projekt (z. B. Ideen) mit schnellem Typ-Wechsel. Eine Notiz direkt zu öffnen
 * (`/wissen/[id]`) geht für jede Notiz.
 * ≥ 1280 px drei Spalten, ab 768 px Liste + Notiz (Themen als Auswahl), darunter eine Spalte
 * mit Zurück-Link. Der Bereichs-Schalter filtert Themen und Notizen.
 */
export function KnowledgeView({ noteId }: { noteId: string | null }) {
  const router = useRouter();
  const wide = useWide();
  const searchParams = useSearchParams();
  const sorting = searchParams.get(SORTING_PARAM) === "1";
  const topicParam = sorting ? null : searchParams.get("thema");
  const area = useUi((s) => s.area);
  const noteSort = useUi((s) => s.noteSort);
  const setNoteSort = useUi((s) => s.setNoteSort);
  const setArea = useUi((s) => s.setArea);
  const areas = useAreas();
  const topics = useTopics();
  const notes = useNotes();
  const noteTypes = useNoteTypes();
  const noteActions = useNoteActions();
  const topicActions = useTopicActions();
  const [types, setTypes] = useState<NoteType[]>([]);
  const [query, setQuery] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);
  const [renamingTopic, setRenamingTopic] = useState(false);
  // Spalten einzeln einklappen (#80), je Gerät
  const [topicsFolded, setTopicsFolded] = useLocalFlag("sz:wissen-themen-zu", false);
  const [listFolded, setListFolded] = useLocalFlag("sz:wissen-liste-zu", false);
  const [linksFolded, setLinksFolded] = useLocalFlag("sz:wissen-verknuepfungen-zu", false);
  // Spalten breiter oder schmaler ziehen (#83), je Gerät
  const [topicsWidth, setTopicsWidth] = useLocalNumber(
    "sz:wissen-themen-breite",
    TOPICS_WIDTH.initial,
    TOPICS_WIDTH,
  );
  const [listWidth, setListWidth] = useLocalNumber(
    "sz:wissen-liste-breite",
    LIST_WIDTH.initial,
    LIST_WIDTH,
  );
  const [linksWidth, setLinksWidth] = useLocalNumber(
    "sz:wissen-verknuepfungen-breite",
    LINKS_WIDTH.initial,
    LINKS_WIDTH,
  );

  const areaList = areas.data ?? [];
  const activeArea = area && areaList.some((a) => a.id === area) ? area : null;
  const allTopics = topics.data ?? [];
  const topicIds = useMemo(() => new Set(allTopics.map((t) => t.id)), [allTopics]);
  const visibleTopics = allTopics.filter((t) => !activeArea || t.area_id === activeArea);
  const topic = topicParam === WITHOUT_TOPIC || topicIds.has(topicParam ?? "") ? topicParam : null;
  const currentTopic = allTopics.find((t) => t.id === topic);

  const inArea = (notes.data ?? []).filter((n) => !activeArea || n.area_id === activeArea);
  const q = query.trim().toLocaleLowerCase("de");
  const knowledge = noteTypes.knowledge;
  const split = splitKnowledge(inArea, knowledge);
  // Typ-Filter bietet nur Typen der laufenden Liste an (Wissen-Typen bzw. in „Noch einordnen“ die übrigen)
  const typeOptions = noteTypes.types.filter((t) => knowledge.has(t.key) !== sorting);
  const activeTypes = types.filter((t) => typeOptions.some((o) => o.key === t));
  const inList = (n: NoteRow) =>
    sorting ? needsSorting(n, knowledge) : isKnowledgeNote(n, knowledge);
  const matchesList = (n: NoteRow) =>
    inList(n) &&
    matchesTopic(n, topic, topicIds) &&
    (activeTypes.length === 0 || activeTypes.includes(n.type)) &&
    (!q ||
      n.title.toLocaleLowerCase("de").includes(q) ||
      n.snippet.toLocaleLowerCase("de").includes(q));
  const listed = sortNotes(inArea.filter(matchesList), noteSort);
  const unsortedCount = split.unsorted.length;
  // Notizen, die nur der Bereichs-Schalter ausblendet (Hinweis unter der Liste)
  const hiddenByArea = activeArea
    ? (notes.data ?? []).filter((n) => n.area_id !== activeArea && matchesList(n)).length
    : 0;

  const note = noteId ? notes.data?.find((n) => n.id === noteId) : undefined;
  const loadError =
    (notes.isError && !notes.data) ||
    (topics.isError && !topics.data) ||
    (areas.isError && !areas.data);
  const loading = !loadError && (notes.isPending || topics.isPending || areas.isPending);
  const retry = () => {
    void notes.refetch();
    void topics.refetch();
    void areas.refetch();
  };
  const hrefFor = (id: string) => wissenHref(id, topic, sorting);
  const backHref = wissenHref(null, topic, sorting);
  const listTitle = sorting
    ? "Noch einordnen"
    : (currentTopic?.name ?? (topic === WITHOUT_TOPIC ? "Ohne Thema" : "Alles Wissen"));

  const createNote = () => {
    const areaId = currentTopic?.area_id ?? activeArea ?? areaList[0]?.id;
    if (!areaId) return;
    // Neue Notizen bleiben „Idee“ (Standard, Entscheidung #56): schnell aufschreiben, später
    // einordnen. Damit sie nicht aus der Liste „verschwindet“, öffnet sie in „Noch einordnen“.
    const created = noteActions.create({
      title: "",
      area_id: areaId,
      topic_id: sorting ? null : (currentTopic?.id ?? null),
      type: DEFAULT_NOTE_TYPE,
    });
    router.push(wissenHref(created.id, null, true));
  };

  return (
    <div
      // Höhe = Fenster minus Kopfzeile bzw. Reiterleiste; im App-Modus/iPad auch minus der Ränder
      // oben (Kopfzeile wächst darum) und unten (Platz in <main>), sonst scrollte die ganze Seite
      className="flex min-h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh_-_3.5rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] lg:h-[calc(100dvh_-_var(--tabbar-h,0px)_-_env(safe-area-inset-bottom))]"
      style={
        {
          "--themen-w": `${topicsWidth}px`,
          "--liste-w": `${listWidth}px`,
          "--verknuepfungen-w": `${linksWidth}px`,
        } as React.CSSProperties
      }
    >
      {/* ganze Breite (#31) oder einzeln eingeklappt (#80): Themen und Liste als senkrechte Reiter */}
      {wide.page || topicsFolded ? (
        <Rail
          label="Themen"
          icon={Hash}
          side="left"
          onClick={() => {
            wide.setWide(null);
            setTopicsFolded(false);
          }}
          className="hidden xl:flex"
        />
      ) : null}
      <nav
        aria-label="Themen"
        data-tab-scroll="themen"
        className={cn(
          "hidden w-(--themen-w) shrink-0 flex-col gap-6 overflow-y-auto border-r border-border px-3 py-6",
          !wide.page && !topicsFolded && "xl:flex",
        )}
      >
        <TopicNav
          onFold={() => setTopicsFolded(true)}
          areas={areaList}
          activeArea={activeArea}
          topics={visibleTopics}
          notes={split.knowledge}
          topicIds={topicIds}
          topic={sorting ? SORTING_PARAM : topic}
          noteId={noteId}
          loading={loading}
        />
        <TypeFilter options={typeOptions} types={activeTypes} onChange={setTypes} />
      </nav>
      {/* Griff auf der Trennlinie (#83): eigenes Element ohne Breite, scrollt nicht mit der Spalte */}
      <div className={cn("relative hidden", !wide.page && !topicsFolded && "xl:block")}>
        <ResizeHandle
          label="Breite der Themen"
          value={topicsWidth}
          min={TOPICS_WIDTH.min}
          max={TOPICS_WIDTH.max}
          onChange={setTopicsWidth}
          onReset={() => setTopicsWidth(TOPICS_WIDTH.initial)}
        />
      </div>

      {wide.page || listFolded ? (
        <Rail
          label={listTitle}
          icon={FileText}
          side="left"
          count={loading ? undefined : listed.length}
          onClick={() => {
            wide.setWide(null);
            setListFolded(false);
          }}
        />
      ) : null}
      <section
        aria-label="Notizliste"
        data-tab-scroll="notizliste"
        className={cn(
          "w-full shrink-0 flex-col gap-3 overflow-y-auto border-border px-3 py-5 md:flex md:w-80 md:border-r lg:w-(--liste-w)",
          noteId ? "hidden" : "flex",
          (wide.page || listFolded) && "lg:hidden",
        )}
      >
        <div className="flex min-h-11 items-center justify-between gap-2 px-1.5 md:min-h-9">
          {/* ab xl Überschrift neben der Themen-Spalte, darunter ist die Themen-Auswahl der Titel */}
          <h1 className="heading min-w-0 flex-1 truncate text-heading max-xl:sr-only">
            {listTitle}
          </h1>
          <div className="-ml-2 flex min-w-0 flex-1 items-center gap-1 xl:hidden">
            {renamingTopic && currentTopic ? (
              <Input
                autoFocus
                defaultValue={currentTopic.name}
                aria-label="Thema umbenennen"
                className="heading text-heading md:text-heading"
                onBlur={(event) => {
                  topicActions.rename(currentTopic.id, event.target.value);
                  setRenamingTopic(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setRenamingTopic(false);
                }}
              />
            ) : (
              <TopicPicker
                variant="title"
                aria-label="Thema wählen"
                value={topic ?? ALL_TOPICS}
                label={listTitle}
                topics={visibleTopics}
                areas={areaList}
                recentIds={recentTopicIds(inArea)}
                fixed={[
                  { value: ALL_TOPICS, label: "Alles Wissen" },
                  { value: WITHOUT_TOPIC, label: "Ohne Thema" },
                ]}
                onSelect={(value) =>
                  router.replace(wissenHref(noteId, value === ALL_TOPICS ? null : value))
                }
              />
            )}
          </div>
          <span className="shrink-0 text-meta text-faint tabular-nums">
            {loading ? null : (
              <>
                {listed.length}
                {/* neben der Themen-Auswahl nur die Zahl, sonst wird der Titel zu knapp */}
                <span className="max-xl:sr-only">
                  {listed.length === 1 ? " Notiz" : " Notizen"}
                </span>
              </>
            )}
          </span>
          <div className="flex shrink-0 items-center xl:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Neues Thema"
              aria-expanded={addingTopic}
              onClick={() => setAddingTopic((v) => !v)}
              disabled={loading}
            >
              <FolderPlus size={16} strokeWidth={1.5} aria-hidden />
            </Button>
            {currentTopic && !renamingTopic ? (
              <MenuRoot>
                <MenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Thema ${currentTopic.name}: Aktionen`}
                  >
                    <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
                  </Button>
                </MenuTrigger>
                {/* kein Fokus zurück auf den Auslöser: beim Umbenennen bekommt das Feld den Fokus */}
                <MenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                  <MenuItem onSelect={() => setRenamingTopic(true)}>
                    <Pencil aria-hidden />
                    Umbenennen
                  </MenuItem>
                  <MenuItem
                    variant="danger"
                    onSelect={() => {
                      topicActions.trash(currentTopic.id);
                      router.replace(wissenHref(noteId, null));
                    }}
                  >
                    <Trash2 aria-hidden />
                    In den Papierkorb
                  </MenuItem>
                </MenuContent>
              </MenuRoot>
            ) : null}
          </div>
          <FoldButton
            label="Notizliste"
            onClick={() => setListFolded(true)}
            className="shrink-0 max-lg:hidden"
          />
        </div>
        {note && !loading && !loadError && !inList(note) ? (
          <OpenNoteHint
            note={note}
            typeName={noteTypes.name(note.type)}
            sorting={sorting}
            knowledge={isKnowledgeNote(note, knowledge)}
            unsorted={needsSorting(note, knowledge)}
          />
        ) : null}
        {addingTopic ? (
          <NewTopicForm
            areas={areaList}
            activeArea={activeArea}
            className="xl:hidden"
            onDone={(created) => {
              setAddingTopic(false);
              // offene Notiz bleibt offen, die Liste zeigt das neue Thema
              if (created) router.replace(wissenHref(noteId, created.id));
            }}
          />
        ) : null}
        {!loading && !loadError && (sorting || unsortedCount > 0) ? (
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            {sorting ? (
              <Link
                href={wissenHref(noteId, null)}
                className="inline-flex min-h-9 items-center rounded-full border border-border-strong px-3 text-meta text-muted transition-colors hover:text-fg"
              >
                ← Zurück zum Wissen
              </Link>
            ) : null}
            <Link
              href={wissenHref(noteId, null, true)}
              aria-current={sorting ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-meta transition-colors",
                sorting
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border-strong text-muted hover:text-fg",
              )}
            >
              <Inbox size={14} strokeWidth={1.5} aria-hidden />
              Noch einordnen · {unsortedCount}
            </Link>
          </div>
        ) : null}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Suchen"
              aria-label="Notizen durchsuchen"
              className="pl-9"
            />
          </div>
          <ListOptionsMenu
            sort={noteSort}
            onSortChange={setNoteSort}
            options={typeOptions}
            types={activeTypes}
            onTypesChange={setTypes}
          />
          <Button variant="primary" onClick={createNote} disabled={loading} aria-label="Neue Notiz">
            <Plus size={16} strokeWidth={2} aria-hidden />
            <span className="max-md:sr-only">Neu</span>
          </Button>
        </div>

        {loadError ? (
          <LoadError onRetry={retry} />
        ) : loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only">Notizen werden geladen</span>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-card" />
            ))}
          </div>
        ) : listed.length === 0 ? (
          <EmptyState
            icon={<BookOpen strokeWidth={1.5} />}
            title={
              q || activeTypes.length
                ? "Nichts gefunden"
                : sorting
                  ? "Alles eingeordnet"
                  : "Noch kein Wissen"
            }
            description={
              q || activeTypes.length
                ? "Suche oder Typ-Filter anpassen."
                : sorting
                  ? "Keine Notiz wartet auf einen Typ."
                  : knowledge.size === 0
                    ? "Kein Typ zählt als Wissen – das stellst du unter Einstellungen › Notiz-Typen ein."
                    : split.notKnowledge > 0
                      ? "Notizen vom Typ Wissen oder Anleitung stehen hier. Ideen ordnest du über „Noch einordnen“ ein."
                      : "Lege die erste Notiz an – mit (( verlinkst du andere Notizen."
            }
            action={
              q || activeTypes.length || sorting ? undefined : (
                <Button variant="secondary" onClick={createNote}>
                  <Plus size={16} strokeWidth={1.5} aria-hidden />
                  Neue Notiz
                </Button>
              )
            }
          />
        ) : (
          <ul aria-label="Notizen" className="flex flex-col gap-1">
            {listed.map((n) => (
              <li key={n.id}>
                <SwipeRow left={trashSwipe(() => noteActions.trash(n.id))}>
                  <NoteContextMenu
                    note={n}
                    onOpen={() => router.push(hrefFor(n.id))}
                    onTrashed={n.id === noteId ? () => router.replace(backHref) : undefined}
                  >
                    {sorting ? (
                      <div className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                          <NoteCard note={n} href={hrefFor(n.id)} active={n.id === noteId} />
                        </div>
                        <div className="shrink-0">
                          {/* Typ umstellen: zählt er als Wissen, rutscht die Notiz ins Wissen */}
                          <NoteTypePicker
                            aria-label="Typ ändern"
                            value={n.type}
                            onSelect={(type) => noteActions.update(n.id, { type })}
                          />
                        </div>
                      </div>
                    ) : (
                      <NoteCard note={n} href={hrefFor(n.id)} active={n.id === noteId} />
                    )}
                  </NoteContextMenu>
                </SwipeRow>
              </li>
            ))}
          </ul>
        )}
        {!loading && !loadError && !sorting && split.notKnowledge > 0 ? (
          <p className="px-1.5 text-ui-sm text-faint">
            {split.notKnowledge === 1
              ? "1 weitere Notiz zählt"
              : `${split.notKnowledge} weitere Notizen zählen`}{" "}
            nicht als Wissen (z. B. Ideen, Protokolle).{" "}
            <Link
              href={appPath.notes()}
              className="text-muted underline underline-offset-2 hover:text-fg"
            >
              Alle Notizen
            </Link>
          </p>
        ) : null}
        {!loading && hiddenByArea > 0 ? (
          <p className="px-1.5 text-ui-sm text-faint">
            {hiddenByArea === 1 ? "1 weitere Notiz" : `${hiddenByArea} weitere Notizen`} in anderen
            Bereichen.{" "}
            <button
              type="button"
              onClick={() => setArea(null)}
              className="text-muted underline underline-offset-2 hover:text-fg"
            >
              Alle Bereiche zeigen
            </button>
          </p>
        ) : null}
      </section>
      <div className={cn("relative hidden", !wide.page && !listFolded && "lg:block")}>
        <ResizeHandle
          label="Breite der Notizliste"
          value={listWidth}
          min={LIST_WIDTH.min}
          max={LIST_WIDTH.max}
          onChange={setListWidth}
          onReset={() => setListWidth(LIST_WIDTH.initial)}
        />
      </div>

      <div
        data-tab-scroll="notiz"
        className={cn("min-w-0 flex-1 overflow-y-auto", noteId ? "block" : "hidden md:block")}
      >
        {note ? (
          <NoteView
            key={note.id}
            note={note}
            notes={notes.data ?? []}
            areas={areaList}
            topics={allTopics}
            backHref={backHref}
            hrefFor={hrefFor}
            onOpenNote={(id) => router.push(hrefFor(id))}
            onTrashed={() => router.replace(backHref)}
            backlinksInColumn={!linksFolded}
          />
        ) : noteId && loadError ? (
          <div className="p-8">
            <LoadError onRetry={retry} />
          </div>
        ) : noteId && !notes.isPending ? (
          <div className="p-8">
            <EmptyState
              title="Notiz nicht gefunden"
              description="Sie liegt im Papierkorb oder existiert nicht mehr."
              action={
                <Link href={backHref} className="text-ui underline">
                  Zur Notizliste
                </Link>
              }
            />
          </div>
        ) : noteId ? (
          <div className="flex flex-col gap-4 px-10 py-8" aria-busy="true">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <p className="text-ui text-faint">Notiz auswählen oder neu anlegen.</p>
          </div>
        )}
      </div>

      {note && linksFolded ? (
        <Rail
          label="Verknüpfungen"
          icon={Link2}
          side="right"
          onClick={() => setLinksFolded(false)}
          className="mt-4 mr-2 hidden 4xl:flex"
        />
      ) : note ? (
        <>
          <div className="relative hidden 4xl:block">
            <ResizeHandle
              label="Breite der Verknüpfungen"
              edge="left"
              value={linksWidth}
              min={LINKS_WIDTH.min}
              max={LINKS_WIDTH.max}
              onChange={setLinksWidth}
              onReset={() => setLinksWidth(LINKS_WIDTH.initial)}
            />
          </div>
          <aside
            aria-label="Verknüpfungen"
            className="hidden w-(--verknuepfungen-w) shrink-0 overflow-y-auto border-l border-border px-5 py-7 4xl:block"
          >
            <Backlinks
              noteId={note.id}
              notes={notes.data ?? []}
              topics={allTopics}
              hrefFor={hrefFor}
              action={
                <FoldButton
                  label="Verknüpfungen"
                  side="right"
                  onClick={() => setLinksFolded(true)}
                  className="-my-2 shrink-0"
                />
              }
            />
          </aside>
        </>
      ) : null}
    </div>
  );
}

/**
 * Die offene Notiz steht nicht in der Liste, weil ihr Typ nicht passt (N4, #56): Direkt-Link,
 * „Zuletzt bearbeitet“ oder Typ gerade umgestellt – leiser Hinweis mit dem Weg dorthin, wo sie
 * steht, damit nichts „verschwunden“ wirkt.
 */
function OpenNoteHint({
  note,
  typeName,
  sorting,
  knowledge,
  unsorted,
}: {
  note: NoteRow;
  typeName: string;
  sorting: boolean;
  knowledge: boolean;
  unsorted: boolean;
}) {
  const title = `„${note.title.trim() || "Ohne Titel"}“`;
  const link = (href: string, label: string) => (
    <Link href={href} className="text-muted underline underline-offset-2 hover:text-fg">
      {label}
    </Link>
  );
  return (
    <p data-testid="open-note-hint" className="px-1.5 text-ui-sm text-faint">
      {knowledge ? (
        <>
          {title} zählt jetzt als Wissen. {link(wissenHref(note.id, null), "Im Wissen zeigen")}
        </>
      ) : unsorted && !sorting ? (
        <>
          {title} (Typ {typeName}) zählt nicht als Wissen.{" "}
          {link(wissenHref(note.id, null, true), "Noch einordnen")}
        </>
      ) : (
        <>
          {title} (Typ {typeName}) hängt an einem Projekt und zählt nicht als Wissen.{" "}
          {link(appPath.notes(), "Alle Notizen")}
        </>
      )}
    </p>
  );
}

/** Ruhige Listenzeile: Titel und Datum (zuletzt bearbeitet), darunter Typ (nur wenn nicht „Idee“) und Anfang des Textes. */
function NoteCard({
  note,
  href,
  active,
  ...rest
}: { note: NoteRow; href: string; active: boolean } & Omit<
  React.ComponentProps<typeof Link>,
  "href"
>) {
  const noteTypes = useNoteTypes();
  const typeLabel = note.type === DEFAULT_NOTE_TYPE ? null : noteTypes.name(note.type);
  return (
    <Link
      {...rest}
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col gap-0.5 rounded-card px-3 py-2.5 transition-colors",
        active ? "bg-surface-2" : "hover:bg-surface",
      )}
    >
      <span className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-ui font-medium">
          {note.title.trim() || "Ohne Titel"}
        </span>
        <NoteShareMark noteId={note.id} />
        <span className="shrink-0 text-meta text-faint tabular-nums">
          {formatListDate(note.edited_at)}
        </span>
      </span>
      {typeLabel || note.snippet ? (
        <span className="truncate text-meta text-muted">
          {typeLabel ? (
            <span className="text-faint">
              {typeLabel}
              {note.snippet ? " · " : ""}
            </span>
          ) : null}
          {note.snippet}
        </span>
      ) : null}
    </Link>
  );
}

function TopicNav({
  onFold,
  areas,
  activeArea,
  topics,
  notes,
  topicIds,
  topic,
  noteId,
  loading,
}: {
  /** Themen-Spalte zum Reiter einklappen (#80) */
  onFold: () => void;
  areas: AreaSummary[];
  activeArea: string | null;
  topics: TopicRow[];
  notes: NoteRow[];
  topicIds: Set<string>;
  topic: string | null;
  noteId: string | null;
  loading: boolean;
}) {
  const actions = useTopicActions();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const areaName = areas.find((a) => a.id === activeArea)?.name ?? "Alle Bereiche";
  const count = (filter: string | null) =>
    notes.filter((n) => matchesTopic(n, filter, topicIds)).length;
  const withoutCount = count(WITHOUT_TOPIC);

  const item = (key: string | null, label: string, n: number) => (
    <Link
      key={key ?? "alle"}
      href={wissenHref(noteId, key)}
      aria-current={topic === key ? "page" : undefined}
      className={cn(
        "flex min-h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-control px-2.5 text-ui",
        topic === key ? "bg-surface-2 text-fg" : "text-fg/85 hover:bg-surface-2",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="text-meta text-faint tabular-nums">{n}</span>
    </Link>
  );

  // Zeilen ohne Menü bekommen einen Platzhalter, damit alle Zahlen bündig untereinander stehen
  const plain = (key: string | null, label: string, n: number) => (
    <div key={key ?? "alle"} className="flex items-center gap-0.5">
      {item(key, label, n)}
      <span aria-hidden className="size-11 shrink-0 md:size-8" />
    </div>
  );
  const needle = filter.trim().toLocaleLowerCase("de");
  const shownTopics = needle
    ? topics.filter((t) => t.name.toLocaleLowerCase("de").includes(needle))
    : topics;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 pb-1 pl-2.5">
        <p className="truncate text-meta uppercase tracking-widest text-faint">
          Themen · {areaName}
        </p>
        <FoldButton label="Themen" onClick={onFold} className="-my-2 shrink-0" />
      </div>
      {loading ? (
        <div className="flex flex-col gap-1.5 px-2.5">
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      ) : (
        <>
          {plain(null, "Alles Wissen", notes.length)}
          {topics.length > TOPIC_FILTER_FROM ? (
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Themen filtern"
              aria-label="Themen filtern"
              className="my-1 h-9 md:h-8"
            />
          ) : null}
          {shownTopics.map((t) =>
            renaming === t.id ? (
              <Input
                key={t.id}
                autoFocus
                defaultValue={t.name}
                aria-label="Thema umbenennen"
                onBlur={(event) => {
                  actions.rename(t.id, event.target.value);
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <div key={t.id} className="group flex items-center gap-0.5">
                {item(t.id, t.name, count(t.id))}
                <MenuRoot>
                  <MenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Thema ${t.name}: Aktionen`}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem onSelect={() => setRenaming(t.id)}>
                      <Pencil aria-hidden />
                      Umbenennen
                    </MenuItem>
                    <MenuItem
                      variant="danger"
                      onSelect={() => {
                        actions.trash(t.id);
                        if (topic === t.id) router.replace(wissenHref(noteId, null));
                      }}
                    >
                      <Trash2 aria-hidden />
                      In den Papierkorb
                    </MenuItem>
                  </MenuContent>
                </MenuRoot>
              </div>
            ),
          )}
          {withoutCount > 0 ? plain(WITHOUT_TOPIC, "Ohne Thema", withoutCount) : null}
        </>
      )}

      {adding ? (
        <NewTopicForm
          areas={areas}
          activeArea={activeArea}
          className="mt-2"
          onDone={(created) => {
            setAdding(false);
            if (created) router.replace(wissenHref(noteId, created.id));
          }}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 justify-start"
          onClick={() => setAdding(true)}
          disabled={loading}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          Neues Thema
        </Button>
      )}
    </div>
  );
}

function TypeFilter({
  options,
  types,
  onChange,
}: {
  options: ReadonlyArray<{ key: NoteType; name: string }>;
  types: NoteType[];
  onChange: (types: NoteType[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="px-2.5 text-meta uppercase tracking-widest text-faint">Notiz-Typen</p>
      <div className="flex flex-wrap gap-1.5 px-2.5">
        {options.map(({ key: type, name }) => {
          const active = types.includes(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? types.filter((t) => t !== type) : [...types, type])}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-meta transition-colors",
                active
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border-strong text-muted hover:text-fg",
              )}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Sortierung und Typ-Filter der Notizliste in einem Menü (auch neben der Themen-Spalte, dort
 * zusätzlich zu den Typ-Pillen). Das Menü bleibt beim Umschalten offen.
 */
function ListOptionsMenu({
  sort,
  onSortChange,
  options,
  types,
  onTypesChange,
}: {
  sort: NoteSort;
  onSortChange: (sort: NoteSort) => void;
  options: ReadonlyArray<{ key: NoteType; name: string }>;
  types: NoteType[];
  onTypesChange: (types: NoteType[]) => void;
}) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          aria-label={
            types.length
              ? `Sortieren und filtern (${types.length} Filter aktiv)`
              : "Sortieren und filtern"
          }
          className={cn("relative", types.length > 0 && "bg-surface-2 text-fg")}
        >
          <ListFilter size={16} strokeWidth={1.5} aria-hidden />
          {types.length > 0 ? (
            <span aria-hidden className="absolute top-2 right-2 size-1.5 rounded-full bg-fg" />
          ) : null}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Sortierung</MenuLabel>
        <MenuRadioGroup
          value={sort}
          onValueChange={(value) => onSortChange(value === "az" ? "az" : "neueste")}
        >
          <MenuRadioItem value="neueste" onSelect={(event) => event.preventDefault()}>
            Neueste zuerst
          </MenuRadioItem>
          <MenuRadioItem value="az" onSelect={(event) => event.preventDefault()}>
            A–Z
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Notiz-Typen</MenuLabel>
        {options.map(({ key: type, name }) => (
          <MenuCheckboxItem
            key={type}
            checked={types.includes(type)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onTypesChange(checked ? [...types, type] : types.filter((t) => t !== type))
            }
          >
            {name}
          </MenuCheckboxItem>
        ))}
        {types.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => onTypesChange([])}>Filter zurücksetzen</MenuItem>
          </>
        ) : null}
      </MenuContent>
    </MenuRoot>
  );
}

function NewTopicForm({
  areas,
  activeArea,
  onDone,
  className,
}: {
  areas: AreaSummary[];
  activeArea: string | null;
  onDone: (created: TopicRow | null) => void;
  className?: string;
}) {
  const actions = useTopicActions();
  const inputId = useId();
  const [name, setName] = useState("");
  const [targetArea, setTargetArea] = useState<string | null>(null);

  return (
    <form
      className={cn("flex flex-col gap-2", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const areaId = activeArea ?? targetArea ?? areas[0]?.id;
        onDone(name.trim() && areaId ? actions.create(areaId, name) : null);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Name des neuen Themas
      </label>
      <Input
        id={inputId}
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone(null);
        }}
        placeholder="Name des Themas"
      />
      {!activeArea ? (
        <Select
          aria-label="Bereich des Themas"
          value={targetArea ?? areas[0]?.id ?? ""}
          onValueChange={setTargetArea}
          options={areas.map((a) => ({ value: a.id, label: a.name }))}
        />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary">
          Anlegen
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-card border border-danger/50 p-4 text-ui"
    >
      <p className="text-danger">Notizen konnten nicht geladen werden. Verbindung prüfen.</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Erneut laden
      </Button>
    </div>
  );
}
