"use client";

import {
  BookOpen,
  CalendarDays,
  FileText,
  Folder,
  GanttChart,
  History,
  Inbox,
  type LucideIcon,
  Plus,
  Settings,
  SquareCheck,
  Sun,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useNotes } from "@/features/notes/api";
import { noteTitle } from "@/features/notes/types";
import { useProjects } from "@/features/projects/api";
import { projectTitle } from "@/features/projects/types";
import { useRecaps } from "@/features/recaps/api";
import { recapTitle } from "@/features/recaps/model";
import { useTasks } from "@/features/tasks/api";
import { taskTitle } from "@/features/tasks/types";
import { cn } from "@/lib/cn";
import { describeHref, resolveTitle, type Tab, type TabTarget, type TitleLookup } from "./model";
import { useTabActions, useTabsState } from "./tabs-provider";

const SECTION_ICONS: Record<string, LucideIcon> = {
  heute: Sun,
  inbox: Inbox,
  kalender: CalendarDays,
  wissen: BookOpen,
  rueckblicke: History,
  wochenreview: Target,
  projekte: Folder,
  aufgaben: SquareCheck,
  notizen: FileText,
  papierkorb: Trash2,
  einstellungen: Settings,
};

function tabIcon(target: TabTarget): LucideIcon {
  if (target.kind === "task") return SquareCheck;
  if (target.kind === "note") return FileText;
  if (target.kind === "project") return Folder;
  if (target.kind === "recap") return History;
  if (target.label === "Zeitstrahl") return GanttChart;
  return SECTION_ICONS[target.section] ?? FileText;
}

/** Anzeige eines Reiters: Titel (gemerkt bzw. Platzhalter), Symbol, voller Text für den Tooltip. */
function tabView(tab: Tab) {
  const target = describeHref(tab.href);
  const label = tab.title || target.label;
  const hint = target.taskId ? `Aufgabe „${label}“ · ${target.page}` : label;
  return { label, hint, Icon: tabIcon(target) };
}

const DRAG_TYPE = "application/x-sz-reiter";

/**
 * Reiterleiste oben (Desktop ab 1024 px, #63): ruhig, 36 px hoch, klebt beim Scrollen oben.
 * Klick wechselt, ✕ oder Mittelklick schließt, Ziehen sortiert, ＋ öffnet Heute. Ohne gelesene
 * Liste bleibt die leere Leiste stehen (keine Verschiebung beim Laden).
 */
export function TabBar() {
  const state = useTabsState();
  const actions = useTabActions();
  const [dragging, setDragging] = useState<string | null>(null);

  return (
    <nav
      aria-label="Reiter"
      className="sticky top-0 z-30 hidden h-(--tabbar-h) shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2 lg:flex"
    >
      {state && actions ? (
        <>
          <ul className="flex min-w-0 items-center gap-1">
            {state.tabs.map((tab, index) => {
              const { label, hint, Icon } = tabView(tab);
              const active = tab.id === state.activeId;
              return (
                <li
                  key={tab.id}
                  draggable
                  data-active={active || undefined}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, tab.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(tab.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    const id = event.dataTransfer.getData(DRAG_TYPE);
                    if (!id) return;
                    event.preventDefault();
                    const box = event.currentTarget.getBoundingClientRect();
                    const after = event.clientX > box.left + box.width / 2;
                    actions.move(id, after ? index + 1 : index);
                    setDragging(null);
                  }}
                  onMouseDown={(event) => {
                    // Mittelklick: kein Auto-Scrollen, schließt beim Loslassen
                    if (event.button === 1) event.preventDefault();
                  }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    actions.close(tab.id);
                  }}
                  className={cn(
                    "flex h-7 w-48 min-w-0 shrink items-center overflow-hidden rounded-control border text-ui-sm transition-colors",
                    active
                      ? "border-border bg-surface font-medium text-fg"
                      : "border-transparent text-muted hover:bg-surface-2 hover:text-fg",
                    dragging === tab.id && "opacity-60",
                  )}
                >
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    title={hint}
                    onClick={() => actions.switchTo(tab.id)}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 pl-2 text-left focus-visible:outline-offset-[-2px]"
                  >
                    <Icon size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
                    <span className="truncate">{label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Reiter „${label}“ schließen`}
                    title="Schließen (Mittelklick)"
                    onClick={() => actions.close(tab.id)}
                    className="mr-1 grid size-5 shrink-0 place-items-center rounded-control text-faint hover:bg-surface-2 hover:text-fg focus-visible:outline-offset-[-2px]"
                  >
                    <X size={12} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:size-7"
            aria-label="Neuer Reiter"
            title="Neuer Reiter: Heute (⌘-Klick auf einen Link öffnet ihn in einem neuen Reiter)"
            onClick={actions.openNew}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        </>
      ) : null}
    </nav>
  );
}

/**
 * Handy und Tablet (< 1024 px): keine Leiste, sondern ein Zähler in der Kopfzeile; Tippen öffnet
 * die Liste der offenen Seiten (wechseln, schließen, neu), Zeilen ≥ 44 px.
 */
export function TabCounter() {
  const state = useTabsState();
  const actions = useTabActions();
  const [open, setOpen] = useState(false);
  if (!state || !actions) return <span aria-hidden className="size-11 shrink-0" />;
  const count = state.tabs.length;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Offene Reiter (${count})`}
        aria-haspopup="dialog"
        title="Offene Reiter"
        onClick={() => setOpen(true)}
      >
        <span className="grid h-5.5 min-w-5.5 place-items-center rounded-control border-[1.5px] border-muted px-1 text-meta font-semibold text-fg tabular-nums">
          {count}
        </span>
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        title="Offene Reiter"
        description="Wechseln, schließen oder einen neuen öffnen"
      >
        <ul aria-label="Offene Reiter" className="flex flex-col gap-px">
          {state.tabs.map((tab) => {
            const { label, hint, Icon } = tabView(tab);
            const active = tab.id === state.activeId;
            return (
              <li key={tab.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  title={hint}
                  onClick={() => {
                    setOpen(false);
                    actions.switchTo(tab.id);
                  }}
                  className={cn(
                    "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 text-left text-ui",
                    active ? "bg-surface-2 font-medium text-fg" : "text-muted",
                  )}
                >
                  <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
                  <span className="truncate">{label}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Reiter „${label}“ schließen`}
                  onClick={() => actions.close(tab.id)}
                >
                  <X size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
        <Button
          variant="secondary"
          className="mt-3 w-full justify-start"
          onClick={() => {
            setOpen(false);
            actions.openNew();
          }}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          Neuer Reiter
        </Button>
      </Sheet>
    </>
  );
}

/** Rückblick-Titel nur laden, wenn ein Reiter einen Rückblick zeigt. */
function RecapTitles({ onChange }: { onChange: (titles: Map<string, string>) => void }) {
  const recaps = useRecaps().data;
  useEffect(() => {
    onChange(new Map((recaps ?? []).map((r) => [r.id, recapTitle(r)])));
  }, [recaps, onChange]);
  return null;
}

/**
 * Titel der Reiter aus den Daten nachführen (Umbenennen wirkt sofort, auch in anderen Reitern);
 * der gemerkte Titel gilt, solange der Eintrag nicht geladen oder im Papierkorb ist.
 */
export function TabTitleSync() {
  const state = useTabsState();
  const actions = useTabActions();
  const notes = useNotes().data;
  const projects = useProjects().data;
  const tasks = useTasks().data;
  const [recaps, setRecaps] = useState<Map<string, string>>(() => new Map());
  const needsRecaps = Boolean(
    state?.tabs.some((t) => {
      const target = describeHref(t.href);
      return target.kind === "recap" && target.id;
    }),
  );

  useEffect(() => {
    if (!state || !actions) return;
    const lookup: TitleLookup = {
      note: (id) => {
        const note = notes?.find((n) => n.id === id);
        return note ? noteTitle(note) : undefined;
      },
      project: (id) => {
        const project = projects?.find((p) => p.id === id);
        return project ? projectTitle(project) : undefined;
      },
      task: (id) => {
        const task = tasks?.find((t) => t.id === id);
        return task ? taskTitle(task) : undefined;
      },
      recap: (id) => recaps.get(id),
    };
    for (const tab of state.tabs) {
      const title = resolveTitle(describeHref(tab.href), lookup);
      if (title !== null && title !== tab.title) actions.rename(tab.id, title);
    }
  }, [state, actions, notes, projects, tasks, recaps]);

  return needsRecaps ? <RecapTitles onChange={setRecaps} /> : null;
}
