"use client";

import { ArrowDown, ArrowUp, Check, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { useId, useState } from "react";
import { BufferedInput } from "@/components/ui/buffered-input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { useTaskActions } from "@/features/tasks/api";
import { addKeyIntent } from "@/features/tasks/components/quick-add";
import { TaskDragSource } from "@/features/tasks/components/task-dnd";
import { type TaskContext, TaskItem } from "@/features/tasks/components/task-item";
import { useTaskPeek } from "@/features/tasks/peek";
import type { TaskRow } from "@/features/tasks/types";
import { cn } from "@/lib/cn";
import { useProjectActions } from "../api";
import type { MilestoneRow, ProjectRow } from "../types";
import { SectionTitle } from "./steckbrief-parts";

const rowInput =
  "min-h-11 w-full min-w-0 rounded-control bg-transparent px-1 text-body-lg text-fg placeholder:text-faint hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none md:min-h-8 md:text-ui";

const bySort = (a: MilestoneRow, b: MilestoneRow) =>
  a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0;

/** Offene Aufgaben: zuerst fällige, dann nach Priorität */
export const byUrgency = (a: TaskRow, b: TaskRow) =>
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
  (a.priority ?? 9) - (b.priority ?? 9);

/**
 * Eingabezeile „… hinzufügen“: Enter legt an (bei Aufgaben: und öffnet sie, ⇧Enter nur anlegen),
 * das Feld bleibt für den nächsten Eintrag offen.
 */
function AddRow({
  label,
  placeholder,
  onAdd,
  className,
}: {
  label: string;
  placeholder: string;
  onAdd: (title: string, options: { open: boolean }) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const submit = (options: { open: boolean }) => {
    if (!draft.trim()) return;
    onAdd(draft.trim(), options);
    setDraft("");
  };
  return (
    <form
      className={cn("flex items-center gap-1.5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        submit({ open: true });
      }}
    >
      <Plus size={14} strokeWidth={1.5} className="ml-1 shrink-0 text-faint" aria-hidden />
      <input
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          const intent = addKeyIntent(event);
          if (!intent) return;
          event.preventDefault();
          submit(intent);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className={rowInput}
      />
    </form>
  );
}

/**
 * Meilensteine als nummerierter Fahrplan (Rückmeldung 12.10.2026: „Meilenstein 1, 2 …“, damit man
 * – und später die KI – die Etappen der Reihe nach abarbeiten kann). Je Meilenstein: erreicht,
 * Titel, Fällig, Fortschritt, offene Aufgaben und neue Aufgabe direkt darunter.
 */
export function MilestonePlan({
  project,
  milestones,
  tasks,
  ctx,
  draggable = false,
}: {
  project: ProjectRow;
  milestones: MilestoneRow[];
  /** Aufgaben des Projekts */
  tasks: TaskRow[];
  ctx: TaskContext;
  /** offene Aufgaben lassen sich auf „Nächster Schritt“ ziehen (#89, Laptop aufwärts) */
  draggable?: boolean;
}) {
  const headingId = useId();
  const actions = useProjectActions();
  const taskActions = useTaskActions();
  const peek = useTaskPeek();
  const sorted = [...milestones].sort(bySort);
  const reached = sorted.filter((m) => m.done_at).length;
  // im Meilenstein-Block steht der Meilenstein schon in der Überschrift
  const rowCtx = { ...ctx, milestones: [] };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle id={headingId}>Meilensteine</SectionTitle>
        {sorted.length ? (
          <span className="text-meta text-faint tabular-nums">
            {reached} von {sorted.length} erreicht
          </span>
        ) : null}
      </div>
      {sorted.length === 0 ? (
        <p className="text-ui-sm text-faint">
          Etappen des Projekts der Reihe nach – Meilenstein 1, 2, … Aufgaben ordnest du direkt
          darunter zu.
        </p>
      ) : (
        <ol aria-label="Meilensteine" className="flex flex-col divide-y divide-border">
          {sorted.map((m, index) => {
            const title = m.title.trim() || "Ohne Titel";
            const own = tasks.filter((t) => t.milestone_id === m.id);
            const done = own.filter((t) => t.status === "erledigt").length;
            const open = own.filter((t) => t.status !== "erledigt").sort(byUrgency);
            return (
              <li key={m.id} className="flex flex-col gap-0.5 py-2">
                <div className="group flex items-center gap-1.5">
                  <RadixCheckbox.Root
                    checked={Boolean(m.done_at)}
                    onCheckedChange={() => actions.toggleMilestone(m.id)}
                    aria-label={`Meilenstein „${title}“ erreicht`}
                    // #60: mit Aufgaben schließt und öffnet er sich selbst (Migration 35)
                    title={
                      own.length
                        ? "Erreicht, sobald alle Aufgaben erledigt sind – du kannst auch selbst abhaken"
                        : "Ohne Aufgaben: selbst abhaken"
                    }
                    className="group/check inline-flex size-11 shrink-0 items-center justify-center md:size-8"
                  >
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full border text-meta font-medium tabular-nums transition-colors",
                        m.done_at
                          ? "border-success text-success"
                          : "border-border-strong text-muted group-hover/check:border-muted group-hover/check:text-fg",
                      )}
                    >
                      {m.done_at ? (
                        <Check size={14} strokeWidth={2} aria-hidden />
                      ) : (
                        <span aria-hidden>{index + 1}</span>
                      )}
                    </span>
                  </RadixCheckbox.Root>
                  <BufferedInput
                    aria-label="Meilenstein"
                    value={m.title}
                    placeholder="Meilenstein benennen"
                    onValueChange={(value) => actions.updateMilestone(m.id, { title: value })}
                    className={cn(rowInput, "font-medium", m.done_at && "text-faint")}
                  />
                  <MenuRoot>
                    <MenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Meilenstein „${title}“: Aktionen`}
                      >
                        <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem
                        disabled={index === 0}
                        onSelect={() => actions.moveMilestone(m.id, -1)}
                      >
                        <ArrowUp aria-hidden />
                        Nach oben
                      </MenuItem>
                      <MenuItem
                        disabled={index === sorted.length - 1}
                        onSelect={() => actions.moveMilestone(m.id, 1)}
                      >
                        <ArrowDown aria-hidden />
                        Nach unten
                      </MenuItem>
                      <MenuItem variant="danger" onSelect={() => actions.trashMilestone(m.id)}>
                        <Trash2 aria-hidden />
                        In den Papierkorb
                      </MenuItem>
                    </MenuContent>
                  </MenuRoot>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 pl-13.5 md:pl-10.5">
                  <DatePicker
                    variant="quiet"
                    value={m.due_date}
                    placeholder="Kein Datum"
                    aria-label={`Fällig: ${title}`}
                    onChange={(value) => actions.updateMilestone(m.id, { due_date: value })}
                    className="-ml-2 text-ui-sm"
                  />
                  <span className="text-meta text-faint tabular-nums">
                    {own.length
                      ? `${done} von ${own.length} ${own.length === 1 ? "Aufgabe" : "Aufgaben"} erledigt`
                      : "noch keine Aufgaben"}
                  </span>
                </div>
                {m.done_at ? null : (
                  <div className="flex flex-col pl-11 md:pl-8">
                    {open.length ? (
                      <ul aria-label={`Offene Aufgaben in „${title}“`} className="flex flex-col">
                        {open.map((t) => (
                          <li key={t.id}>
                            <TaskDragSource task={t} scope="plan" disabled={!draggable}>
                              <TaskItem task={t} ctx={rowCtx} showProject={false} />
                            </TaskDragSource>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <AddRow
                      label={`Neue Aufgabe in „${title}“`}
                      placeholder="Aufgabe hinzufügen …"
                      className="pl-1.5"
                      onAdd={(text, { open }) => {
                        const task = taskActions.create({
                          title: text,
                          project_id: project.id,
                          milestone_id: m.id,
                          area_id: project.area_id,
                          in_inbox: false,
                        });
                        if (open) peek.open(task.id);
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <AddRow
        label="Neuer Meilenstein"
        placeholder="Meilenstein hinzufügen …"
        onAdd={(text) => actions.createMilestone(project.id, text)}
      />
    </section>
  );
}
