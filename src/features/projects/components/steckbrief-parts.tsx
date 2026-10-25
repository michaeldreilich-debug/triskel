"use client";

import { Globe, Mail, Pencil, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { BufferedInput } from "@/components/ui/buffered-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { notifyWithUndo, toast } from "@/components/ui/toast";
import { TaskPicker } from "@/features/tasks/components/pickers";
import { TaskDropZone, useDraggedTask } from "@/features/tasks/components/task-dnd";
import { useTaskPeek } from "@/features/tasks/peek";
import { PRIORITY_LABELS, type TaskRow, taskTitle } from "@/features/tasks/types";
import { cn } from "@/lib/cn";
import { formatDayShort } from "@/lib/dates";
import { newId } from "@/lib/id";
import { linkHost, linkLabel, normalizeLinkUrl, type ProjectLink } from "../links";
import type { OutcomeItem, ProjectRow } from "../types";

export function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-meta uppercase tracking-widest text-faint">
      {children}
    </h2>
  );
}

const rowInput =
  "min-h-11 w-full min-w-0 rounded-control bg-transparent px-1 text-body-lg text-fg placeholder:text-faint hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none md:min-h-8 md:text-ui";

/** „Fertig ist es, wenn …“ – Punkte abhaken, Text inline bearbeiten, hinzufügen, entfernen. */
export function OutcomeList({
  items,
  onChange,
}: {
  items: OutcomeItem[];
  onChange: (items: OutcomeItem[]) => void;
}) {
  const headingId = useId();
  const [focusId, setFocusId] = useState<string | null>(null);
  const patch = (id: string, values: Partial<OutcomeItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...values } : item)));
  const add = () => {
    const item = { id: newId(), text: "", done: false };
    onChange([...items, item]);
    setFocusId(item.id);
  };
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <SectionTitle id={headingId}>Fertig ist es, wenn …</SectionTitle>
      <ul className="flex flex-col">
        {items.map((item, index) => (
          <li key={item.id} className="group flex items-center gap-2">
            <Checkbox
              checked={item.done}
              aria-label={`Ergebnis ${index + 1} erreicht`}
              onCheckedChange={(checked) => patch(item.id, { done: checked === true })}
              className="size-4"
            />
            <BufferedInput
              ref={(el) => {
                if (el && focusId === item.id) {
                  el.focus();
                  setFocusId(null);
                }
              }}
              aria-label={`Ergebnis ${index + 1}`}
              value={item.text}
              placeholder="Was ist dann erreicht?"
              onValueChange={(text) => patch(item.id, { text })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
                if (event.key === "Backspace" && item.text === "") {
                  event.preventDefault();
                  onChange(items.filter((i) => i.id !== item.id));
                }
              }}
              className={cn(rowInput, item.done && "text-faint line-through")}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Ergebnis ${index + 1} entfernen`}
              onClick={() => onChange(items.filter((i) => i.id !== item.id))}
              className="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-1 text-ui-sm text-faint hover:text-fg md:min-h-8"
      >
        <Plus size={14} strokeWidth={1.5} aria-hidden />
        Punkt hinzufügen
      </button>
    </section>
  );
}

const revealOnHover =
  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100";

/**
 * Links im Steckbrief (Entscheidung 17.10.2026, Migration 22): Name + Adresse, ein Klick öffnet
 * im neuen Tab. Bearbeiten und Entfernen leise in der Zeile (am Handy sichtbar), Entfernen mit
 * „Rückgängig“.
 */
export function LinkList({
  links,
  onChange,
}: {
  links: ProjectLink[];
  onChange: (links: ProjectLink[]) => void;
}) {
  const headingId = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const save = (id: string, name: string, url: string) => {
    onChange(
      links.some((l) => l.id === id)
        ? links.map((l) => (l.id === id ? { ...l, name, url } : l))
        : [...links, { id, name, url }],
    );
    setEditing(null);
  };
  const remove = (link: ProjectLink) => {
    const before = links;
    onChange(links.filter((l) => l.id !== link.id));
    notifyWithUndo(`Link „${linkLabel(link)}“ entfernt`, () => onChange(before));
  };
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <SectionTitle id={headingId}>Links</SectionTitle>
      {links.length ? (
        <ul className="flex flex-col">
          {links.map((link) => {
            const label = linkLabel(link);
            if (editing === link.id) {
              return (
                <li key={link.id}>
                  <LinkForm
                    initial={link}
                    onSave={(name, url) => save(link.id, name, url)}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              );
            }
            const href = normalizeLinkUrl(link.url);
            const Icon = href?.startsWith("mailto:") ? Mail : Globe;
            return (
              <li key={link.id} className="group flex items-center gap-1">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-ui text-link hover:underline md:min-h-8"
                  >
                    <Icon size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-faint" />
                    <span className="min-w-0 truncate">{label}</span>
                    {link.name.trim() ? (
                      // die Kurzform weicht zuerst, der Name bleibt lesbar
                      <span className="min-w-0 shrink-[4] truncate text-meta text-faint">
                        {linkHost(href)}
                      </span>
                    ) : null}
                  </a>
                ) : (
                  <span
                    title="Adresse ungültig"
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-1 text-ui text-faint md:min-h-8"
                  >
                    <Globe size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
                    <span className="truncate">{label}</span>
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Link „${label}“ bearbeiten`}
                  onClick={() => setEditing(link.id)}
                  className={revealOnHover}
                >
                  <Pencil size={14} strokeWidth={1.5} aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Link „${label}“ entfernen`}
                  onClick={() => remove(link)}
                  className={revealOnHover}
                >
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {editing === "neu" ? (
        <LinkForm
          onSave={(name, url) => save(newId(), name, url)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing("neu")}
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-1 text-ui-sm text-faint hover:text-fg md:min-h-8"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden />
          Link hinzufügen
        </button>
      )}
    </section>
  );
}

/** Name und Adresse eines Links; Enter speichert, Escape bricht ab. */
function LinkForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ProjectLink;
  onSave: (name: string, url: string) => void;
  onCancel: () => void;
}) {
  const errorId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [invalid, setInvalid] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <form
      aria-label={initial ? `Link „${linkLabel(initial)}“ bearbeiten` : "Neuer Link"}
      className="flex flex-col gap-2 rounded-card border border-border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        const safe = normalizeLinkUrl(url);
        if (!safe) {
          setInvalid(true);
          return;
        }
        onSave(name.trim(), safe);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <Input
        ref={first}
        aria-label="Name"
        placeholder="Name, z. B. Elster"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        aria-label="Adresse"
        placeholder="Adresse, z. B. elster.de"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={url}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          setUrl(event.target.value);
          setInvalid(false);
        }}
      />
      {invalid ? (
        <p id={errorId} className="px-1 text-ui-sm text-danger">
          Bitte eine Web- oder E-Mail-Adresse eingeben.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button variant="primary" size="sm" type="submit">
          Speichern
        </Button>
      </div>
    </form>
  );
}

/**
 * „Nächster Schritt“-Box (Entwurf 05): Aufgabe des Projekts, ändern per Suche, neu anlegen – oder
 * eine offene Aufgabe des Projekts (Fahrplan, Reiter „Aufgaben“, Kopf des Aufgaben-Panels) per
 * Ziehen hineinlegen (#89). Beim Ziehen zeigt der Kasten, dass er annimmt; Erledigte und
 * Aufgaben anderer Projekte lehnt er mit Hinweis ab.
 */
export function NextStepBox({
  project,
  tasks,
  projects,
  onChoose,
  onCreate,
}: {
  project: ProjectRow;
  tasks: TaskRow[];
  projects: ProjectRow[];
  onChoose: (taskId: string | null) => void;
  onCreate: (title: string) => void;
}) {
  const peek = useTaskPeek();
  const dragged = useDraggedTask();
  const next = tasks.find((t) => t.id === project.next_task_id && t.status !== "erledigt");
  const candidates = tasks.filter((t) => t.project_id === project.id && t.status !== "erledigt");
  const accepts = (task: TaskRow) =>
    task.project_id === project.id && task.status !== "erledigt" && task.id !== next?.id;
  const reject = (task: TaskRow) => {
    if (task.status === "erledigt") toast("Erledigte Aufgaben können kein nächster Schritt sein.");
    else if (task.project_id !== project.id) {
      toast("Nur Aufgaben dieses Projekts können der nächste Schritt sein.");
    }
    // schon der nächste Schritt: nichts zu tun
  };
  const drop = (task: TaskRow) => {
    const before = project.next_task_id;
    onChoose(task.id);
    notifyWithUndo(`Nächster Schritt: „${taskTitle(task)}“`, () => onChoose(before));
  };
  return (
    <TaskDropZone
      as="section"
      id={`nextstep:${project.id}`}
      accepts={accepts}
      onDropTask={drop}
      onReject={reject}
      readyClassName="outline outline-2 outline-offset-2 outline-dashed outline-next-step-label"
      overClassName="outline outline-2 outline-offset-2 outline-next-step-label"
      aria-label="Nächster Schritt"
      className="flex flex-col gap-2 rounded-card border border-next-step-border bg-next-step-bg p-4"
    >
      <p className="text-meta font-medium uppercase tracking-widest text-next-step-label">
        Nächster Schritt
      </p>
      {next ? (
        <>
          <Link
            href={peek.hrefFor(next.id)}
            scroll={false}
            className="text-body font-medium text-fg hover:underline"
          >
            {taskTitle(next)}
          </Link>
          {next.due_date || next.priority ? (
            <p className="text-meta text-muted tabular-nums">
              {[
                next.due_date ? `fällig ${formatDayShort(next.due_date)}` : null,
                next.priority ? PRIORITY_LABELS[next.priority] : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-ui text-muted">
          Noch kein nächster Schritt – sonst ist es festgefahren.
        </p>
      )}
      {dragged && accepts(dragged) ? (
        <p
          data-testid="nextstep-drop-hint"
          className="flex min-h-8 items-center text-ui-sm font-medium text-next-step-label"
        >
          Hier ablegen: wird der nächste Schritt
        </p>
      ) : (
        <div>
          <TaskPicker
            variant="add"
            label={next ? "Ändern" : "Nächsten Schritt festlegen"}
            ariaLabel={next ? "Nächsten Schritt ändern" : "Nächsten Schritt festlegen"}
            tasks={candidates}
            projects={projects}
            selectedIds={next ? [next.id] : []}
            onSelect={onChoose}
            onCreate={onCreate}
            searchLabel="Aufgabe des Projekts suchen"
          />
        </div>
      )}
    </TaskDropZone>
  );
}
