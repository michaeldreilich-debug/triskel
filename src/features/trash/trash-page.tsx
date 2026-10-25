"use client";

import {
  CalendarDays,
  FileText,
  Flag,
  Folder,
  Hash,
  History,
  LayoutTemplate,
  type LucideIcon,
  RotateCcw,
  Search,
  Shapes,
  SquareCheck,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useAreas } from "@/features/areas/api";
import type { AreaSummary } from "@/features/areas/defaults";
import { useTopics } from "@/features/notes/api";
import { useProjects } from "@/features/projects/api";
import { berlinTime, formatListDate } from "@/lib/dates";
import { type TrashActions, useTrash, useTrashActions } from "./api";
import {
  matchesTrashQuery,
  purgeNote,
  TRASH_KIND_LABELS,
  type TrashItem,
  type TrashTable,
  trashTitle,
} from "./model";

const ICONS: Record<TrashTable, LucideIcon> = {
  tasks: SquareCheck,
  notes: FileText,
  projects: Folder,
  milestones: Flag,
  topics: Hash,
  recaps: History,
  templates: LayoutTemplate,
  saved_views: Table2,
  note_types: Shapes,
  calendar_sources: CalendarDays,
};

const ENTITY_LABELS: Record<string, string> = {
  tasks: "Aufgaben",
  notes: "Notizen",
  projects: "Projekte",
};

interface Lookup {
  areas: AreaSummary[];
  projectTitle: (id: string) => string | null;
  topicName: (id: string) => string | null;
}

/** Wo der Eintrag hingehört: Projekt, Thema, Inbox oder Bereich. */
function contextOf(item: TrashItem, lookup: Lookup): { label: string; area?: AreaSummary } {
  const area = lookup.areas.find((a) => a.id === item.areaId);
  const project = item.projectId ? lookup.projectTitle(item.projectId) : null;
  const topic = item.topicId ? lookup.topicName(item.topicId) : null;
  if (item.table === "milestones") return { label: project ?? "" };
  if (item.table === "recaps") return { label: item.period ?? "" };
  if (item.table === "templates") return { label: item.detail ?? "" };
  if (item.table === "saved_views") {
    const entity = ENTITY_LABELS[item.entity ?? ""] ?? "";
    return { label: [entity, area?.name ?? "alle Bereiche"].filter(Boolean).join(" · ") };
  }
  if (project) return { label: project, area };
  if (topic) return { label: topic, area };
  if (item.inInbox) return { label: "Inbox" };
  return { label: area?.name ?? "", area };
}

const PURGE_PROJECTS_NOTE =
  "Meilensteine der Projekte gehen mit, ihre Aufgaben und Notizen bleiben (ohne Projekt).";

const deletedLabel = (iso: string) => `gelöscht ${formatListDate(iso)}, ${berlinTime(iso)}`;

/** Rückfrage vor dem endgültigen Löschen – inline, kein Dialog (Design: „Verboten“). */
function ConfirmPurge({
  message,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  detail?: string | null;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <fieldset
      aria-label={message}
      className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-danger/50 px-3 py-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <p className="min-w-0 flex-1 basis-56 text-ui-sm">
        <span className="font-medium text-danger">{message}</span>{" "}
        <span className="text-muted">
          Lässt sich nicht rückgängig machen.{detail ? ` ${detail}` : ""}
        </span>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={cancel} size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </fieldset>
  );
}

function TrashRow({
  item,
  lookup,
  actions,
}: {
  item: TrashItem;
  lookup: Lookup;
  actions: TrashActions;
}) {
  const [confirming, setConfirming] = useState(false);
  const Icon = ICONS[item.table];
  const title = trashTitle(item);
  const context = contextOf(item, lookup);
  // Datum vor dem Kontext: lange Projektnamen werden am Handy abgeschnitten, nicht das Datum
  const meta = [TRASH_KIND_LABELS[item.table], deletedLabel(item.deletedAt), context.label]
    .filter(Boolean)
    .join(" · ");

  return (
    <ContextMenuRoot modal={false}>
      <ContextMenuTrigger asChild>
        <div
          data-trash-id={item.id}
          className="flex flex-col gap-2 rounded-card px-2.5 py-2 hover:bg-surface"
        >
          <div className="flex min-h-9 items-center gap-3">
            <Icon size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-ui font-medium">{title}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-meta text-faint">
                {context.area ? <AreaDot color={context.area.color} /> : null}
                <span className="truncate tabular-nums">{meta}</span>
              </span>
            </div>
            {confirming ? null : (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => actions.restore(item)}
                  aria-label={`„${title}“ wiederherstellen`}
                  title="Wiederherstellen"
                  className="max-md:w-11 max-md:px-0"
                >
                  <RotateCcw size={16} strokeWidth={1.5} aria-hidden />
                  <span className="max-md:hidden">Wiederherstellen</span>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setConfirming(true)}
                  aria-label={`„${title}“ endgültig löschen`}
                  title="Endgültig löschen"
                  className="hover:text-danger"
                >
                  <X size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              </div>
            )}
          </div>
          {confirming ? (
            <ConfirmPurge
              message={`„${title}“ endgültig löschen?`}
              detail={purgeNote(item.table)}
              confirmLabel="Endgültig löschen"
              onConfirm={() => actions.purge([item])}
              onCancel={() => setConfirming(false)}
            />
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${TRASH_KIND_LABELS[item.table]} „${title}“`}>
        <ContextMenuItem onSelect={() => actions.restore(item)}>
          <RotateCcw aria-hidden />
          Wiederherstellen
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="danger" onSelect={() => setConfirming(true)}>
          <X aria-hidden />
          Endgültig löschen …
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}

/**
 * Papierkorb (B13, E9): alles Gelöschte, neueste zuerst. Wiederherstellen holt es an seinen Platz
 * zurück (Notizen samt Inhalt). Endgültig löschen nur nach Rückfrage – einzeln oder alles, was
 * gerade angezeigt wird (mit Suche: nur die Treffer). Der Bereichs-Schalter filtert hier nicht.
 */
export function TrashPage() {
  const trash = useTrash();
  const actions = useTrashActions();
  const areas = useAreas();
  const projects = useProjects();
  const topics = useTopics();
  const [query, setQuery] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);

  const items = trash.data ?? [];
  const shown = items.filter((item) => matchesTrashQuery(item, query));
  const filtered = query.trim() !== "";
  const lookup: Lookup = {
    areas: areas.data ?? [],
    projectTitle: (id) => {
      const title =
        projects.data?.find((p) => p.id === id)?.title ??
        items.find((i) => i.table === "projects" && i.id === id)?.title;
      return title === undefined ? null : title.trim() || "Ohne Titel";
    },
    topicName: (id) =>
      topics.data?.find((t) => t.id === id)?.name ??
      items.find((i) => i.table === "topics" && i.id === id)?.title ??
      null,
  };
  const count = (n: number) => (n === 1 ? "1 Eintrag" : `${n} Einträge`);
  const withProjects = shown.some((i) => i.table === "projects");

  return (
    <Page>
      <PageHeader
        title="Papierkorb"
        meta={
          trash.isPending
            ? "Gelöschtes"
            : filtered
              ? `${shown.length} von ${items.length === 1 ? "1 Eintrag" : `${items.length} Einträgen`}`
              : count(items.length)
        }
        actions={
          shown.length > 0 && !confirmAll ? (
            <Button variant="danger" onClick={() => setConfirmAll(true)}>
              <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              {filtered ? "Treffer endgültig löschen" : "Papierkorb leeren"}
            </Button>
          ) : null
        }
      />
      <p className="-mt-3 text-ui-sm text-faint">
        Gelöschtes bleibt hier, bis du es endgültig löschst. „Wiederherstellen“ holt es an seinen
        Platz zurück.
      </p>

      {confirmAll && shown.length > 0 ? (
        <ConfirmPurge
          message={`${count(shown.length)} endgültig löschen?`}
          detail={withProjects ? PURGE_PROJECTS_NOTE : null}
          confirmLabel={filtered ? "Treffer löschen" : "Alles löschen"}
          onConfirm={() => {
            actions.purge(shown);
            setConfirmAll(false);
          }}
          onCancel={() => setConfirmAll(false)}
        />
      ) : null}

      {items.length > 0 ? (
        <div className="relative w-full md:w-72">
          <Search
            size={16}
            strokeWidth={1.5}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setConfirmAll(false);
            }}
            placeholder="Suchen"
            aria-label="Papierkorb durchsuchen"
            className="pl-9"
          />
        </div>
      ) : null}

      {trash.isError ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-card border border-danger/50 p-4 text-ui"
        >
          <p className="text-danger">Papierkorb konnte nicht geladen werden. Verbindung prüfen.</p>
          <Button size="sm" onClick={() => void trash.refetch()}>
            Erneut laden
          </Button>
        </div>
      ) : trash.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">Papierkorb wird geladen</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Trash2 strokeWidth={1.5} />}
          title="Papierkorb leer"
          description="Was du löschst, landet hier und lässt sich zurückholen."
        />
      ) : shown.length === 0 ? (
        <EmptyState title="Nichts gefunden" description="Suche anpassen." />
      ) : (
        <ul aria-label="Papierkorb" className="flex flex-col gap-0.5">
          {shown.map((item) => (
            <li key={`${item.table}:${item.id}`}>
              <TrashRow item={item} lookup={lookup} actions={actions} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
