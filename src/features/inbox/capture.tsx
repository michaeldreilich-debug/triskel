"use client";

import { CornerDownLeft, FileText, Inbox, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { AreaDot } from "@/components/ui/pill";
import { notifyWithUndo } from "@/components/ui/toast";
import { useAreas } from "@/features/areas/api";
import type { AreaSummary } from "@/features/areas/defaults";
import { useNoteActions } from "@/features/notes/api";
import { useNoteTypes } from "@/features/notes/note-types";
import { preferredNoteType } from "@/features/notes/types";
import { useProjects } from "@/features/projects/api";
import { type ProjectRow, projectTitle } from "@/features/projects/types";
import { useTaskActions } from "@/features/tasks/api";
import { taskHrefHere } from "@/features/tasks/peek";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import type { IsoDate } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import {
  applyChoices,
  type CaptureChoices,
  type CaptureResult,
  normalize,
  parseCapture,
  resolveProjectToken,
} from "./parse";

/** Kürzel für die Hilfe, z. B. „#job #privat“ aus den Bereichen. */
export function areaShortcuts(areas: AreaSummary[]): string {
  return areas
    .map((a) => (normalize(a.name) === "beruf" ? "#job" : `#${normalize(a.name).split(" ")[0]}`))
    .join(" ");
}

/**
 * Bereich einer Notiz ohne #-Kürzel: der gewählte Bereich (Bereichs-Schalter), sonst der erste.
 * Notizen brauchen immer einen Bereich, eine Notiz-Inbox gibt es nicht.
 */
export function noteAreaFor(
  result: Pick<CaptureResult, "areaId">,
  areas: AreaSummary[],
  activeArea: string | null,
): AreaSummary | undefined {
  return (
    areas.find((a) => a.id === result.areaId) ?? areas.find((a) => a.id === activeArea) ?? areas[0]
  );
}

/** Wohin kommt der Eintrag? „Inbox“, „Privat · Bewerbung Musterfirma“ oder „Notiz in Beruf“ */
export function describeTarget(
  result: CaptureResult,
  areas: AreaSummary[],
  projects: ProjectRow[],
  activeArea: string | null = null,
): string {
  const project = projects.find((p) => p.id === result.projectId);
  const area = areas.find((a) => a.id === result.areaId);
  if (result.kind === "note") {
    const noteArea = noteAreaFor(result, areas, activeArea);
    return `Notiz in ${noteArea?.name ?? "Wissen"}${project ? ` · ${projectTitle(project)}` : ""}`;
  }
  if (project) return `${area?.name ?? ""}${area ? " · " : ""}${projectTitle(project)}`;
  if (area) return area.name;
  return "Inbox";
}

/**
 * Erfassen: Kürzel auswerten und Aufgabe anlegen (ohne Kürzel in die Inbox); mit „#notiz“ eine
 * Notiz (Typ Idee) im Bereich aus dem Kürzel bzw. im gewählten Bereich. Die Meldung bietet
 * „Öffnen“ (#75) – Erfassen selbst bleibt schnell und öffnet nichts.
 */
export function useCapture() {
  const router = useRouter();
  const areas = useAreas();
  const projects = useProjects();
  const actions = useTaskActions();
  const noteActions = useNoteActions();
  const noteTypes = useNoteTypes();
  const activeArea = useUi((s) => s.area);
  const areaList = areas.data ?? [];
  const projectList = projects.data ?? [];
  // erst auswerten, wenn Bereiche und Projekte da sind (sonst würden Kürzel übergangen)
  const ready = !areas.isPending && !projects.isPending;
  return useMemo(() => {
    const ctx = { areas: areaList, projects: projectList };
    const parse = (text: string) => parseCapture(text, ctx);
    const describe = (result: CaptureResult) =>
      describeTarget(result, areaList, projectList, activeArea);
    return {
      ready,
      areas: areaList,
      projects: projectList,
      parse,
      describe,
      /** Vorschau mit den Knöpfen des Sheets „Festhalten“ (Kürzel im Text gehen vor) */
      parseWith: (text: string, choices: CaptureChoices) =>
        applyChoices(parse(text), choices, projectList),
      submit(
        text: string,
        extra: CaptureChoices & { dueDate?: IsoDate | null } = {},
      ): { id: string } | null {
        const result = applyChoices(parse(text), extra, projectList);
        if (!result.title) return null;
        if (result.kind === "note") {
          const area = noteAreaFor(result, areaList, activeArea);
          if (!area) return null;
          const note = noteActions.create({
            title: result.title,
            area_id: area.id,
            project_id: result.projectId,
            type: preferredNoteType("idee", noteTypes.types),
          });
          notifyWithUndo(
            `„${result.title}“ → ${describe(result)}`,
            () => noteActions.trash(note.id),
            { onOpen: () => router.push(appPath.note(note.id)) },
          );
          return note;
        }
        const task = actions.create({
          title: result.title,
          area_id: result.areaId,
          project_id: result.projectId,
          in_inbox: !result.areaId && !result.projectId,
          ...(extra.dueDate ? { due_date: extra.dueDate } : {}),
        });
        const target = describe(result);
        notifyWithUndo(
          target === "Inbox" ? `In der Inbox: „${result.title}“` : `„${result.title}“ → ${target}`,
          () => actions.trash(task.id),
          { onOpen: () => router.push(taskHrefHere(task.id), { scroll: false }) },
        );
        return task;
      },
    };
  }, [ready, areaList, projectList, actions, noteActions, activeArea, noteTypes.types, router]);
}

/**
 * Kürzel-Hilfe in einer ruhigen Zeile (Rückmeldung #18): je Kürzel ein Kästchen und das Ziel,
 * Umbruch nur zwischen den Paaren.
 */
function CaptureHint({ shortcuts }: { shortcuts: string }) {
  const pairs: { keys: string[]; label: string; title?: string }[] = [
    { keys: shortcuts.split(" ").filter(Boolean), label: "Bereich" },
    {
      keys: ["@Projekt"],
      label: "Projekt",
      title: 'Teil des Namens reicht, mehrere Wörter: @"…"',
    },
    { keys: ["#notiz"], label: "Notiz" },
  ];
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {pairs.map((pair) => (
        <span
          key={pair.label}
          title={pair.title}
          className="inline-flex items-center gap-1 whitespace-nowrap"
        >
          {pair.keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
          <span>{pair.label}</span>
        </span>
      ))}
      <span className="whitespace-nowrap">ohne Kürzel: Inbox</span>
    </span>
  );
}

/**
 * Feld der Schnellerfassung (Heute, Inbox): Vorschau, wohin der Eintrag kommt; bei mehreren
 * passenden Projekten Auswahl per Klick; Kürzel werden direkt erklärt (feedback.md #8).
 */
export function CaptureField({
  className,
  autoFocus,
}: {
  className?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const hintId = useId();
  const capture = useCapture();
  const [text, setText] = useState("");
  // Enter, bevor Bereiche/Projekte geladen sind: Eintrag annehmen, merken und danach in
  // Reihenfolge erfassen (Kürzel werden dann richtig ausgewertet, nichts geht verloren)
  const [waiting, setWaiting] = useState<string[]>([]);
  const result = text.trim() ? capture.parse(text) : null;

  useEffect(() => {
    if (waiting.length === 0 || !capture.ready) return;
    for (const entry of waiting) capture.submit(entry);
    setWaiting([]);
  }, [waiting, capture]);
  const shortcuts = areaShortcuts(capture.areas);

  const resolve = (token: string, project: ProjectRow) => {
    setText((current) => resolveProjectToken(current, token, projectTitle(project)));
  };

  return (
    <form
      className={cn("flex flex-col gap-1.5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        if (!capture.ready) {
          setWaiting((list) => [...list, text]);
          setText("");
          return;
        }
        if (capture.submit(text)) setText("");
      }}
    >
      <label htmlFor={id} className="sr-only">
        Schnellerfassung
      </label>
      <div className="flex min-h-11 items-center gap-2 rounded-card border border-border bg-surface px-3 transition-colors focus-within:border-muted md:min-h-10">
        <Plus size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
        <input
          id={id}
          value={text}
          // biome-ignore lint/a11y/noAutofocus: nur auf der Inbox-Seite, dort ist Erfassen die Hauptaufgabe
          autoFocus={autoFocus}
          aria-describedby={hintId}
          onChange={(event) => setText(event.target.value)}
          placeholder="Was willst du aus dem Kopf haben?"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 bg-transparent text-body-lg text-fg outline-none placeholder:text-faint md:h-10 md:text-ui"
        />
        <Kbd className="hidden shrink-0 md:inline-flex">
          <CornerDownLeft size={12} strokeWidth={1.5} aria-label="Enter" />
        </Kbd>
      </div>
      <div
        id={hintId}
        aria-live="polite"
        className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 px-1 text-meta text-faint"
      >
        {result?.ambiguous ? (
          <>
            <span className="text-warning">
              @{result.ambiguous.token} passt zu {result.ambiguous.candidates.length} Projekten:
            </span>
            {result.ambiguous.candidates.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => resolve(result.ambiguous?.token ?? "", project as ProjectRow)}
                className="rounded-full border border-border-strong px-2 py-0.5 text-fg/85 hover:bg-surface-2"
              >
                {projectTitle(project as ProjectRow)}
              </button>
            ))}
          </>
        ) : result ? (
          <span className="inline-flex items-center gap-1.5" data-testid="capture-target">
            {result.kind === "note" ? (
              <FileText size={12} strokeWidth={1.5} aria-hidden />
            ) : result.projectId || result.areaId ? (
              <AreaDot color={capture.areas.find((a) => a.id === result.areaId)?.color ?? "blue"} />
            ) : (
              <Inbox size={12} strokeWidth={1.5} aria-hidden />
            )}
            → {capture.describe(result)}
            {result.unknownProject ? (
              <span className="text-warning"> · kein Projekt „{result.unknownProject}“</span>
            ) : null}
          </span>
        ) : (
          <CaptureHint shortcuts={shortcuts} />
        )}
      </div>
    </form>
  );
}
