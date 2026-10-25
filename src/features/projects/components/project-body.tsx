"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { useId, useMemo, useRef } from "react";
import { FileDrop } from "@/components/ui/file-drop";
import { Skeleton } from "@/components/ui/skeleton";
import { useNoteActions } from "@/features/notes/api";
import { createQueryNoteDirectory } from "@/features/notes/directory";
import { useOutlineMedia } from "@/features/notes/media";
import { useNoteOpener } from "@/features/notes/peek";
import { TaskBodyEditor } from "@/features/tasks/components/task-body-editor";
import { useFreshOnOpen } from "@/lib/data/fresh";
import { projectsKey } from "../../tasks/api";
import { useProjectActions } from "../api";
import type { ProjectRow } from "../types";
import { SectionTitle } from "./steckbrief-parts";

/**
 * Freitext im Reiter Übersicht (Rückmeldung #44): eine freie Textfläche wie die Aufgaben-Notiz –
 * Formatieren per Rechtsklick, Checkliste, „((“ verlinkt Notizen, Bilder und Dateien (Ordner je
 * Projekt), Ablegen irgendwo auf der Fläche. Gespeichert in `projects.body` (Migration 24).
 */
export function ProjectBody({ project }: { project: ProjectRow }) {
  const id = useId();
  const noteOpener = useNoteOpener();
  const queryClient = useQueryClient();
  const actions = useProjectActions();
  const noteActions = useNoteActions();
  const media = useOutlineMedia(project.id);
  const editor = useRef<Editor | null>(null);
  // Freitext erst mit frischem Serverstand einhängen (D-7)
  const fresh = useFreshOnOpen(projectsKey, project.id);
  // neue Notizen aus „((“ landen im Bereich des Projekts und gehören zu ihm
  const areaId = useRef(project.area_id);
  areaId.current = project.area_id;
  const notes = useMemo(
    () =>
      createQueryNoteDirectory(queryClient, {
        create: (title) =>
          noteActions.create({ title, area_id: areaId.current, project_id: project.id }).id,
      }),
    [queryClient, noteActions, project.id],
  );

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionTitle id={id}>Freitext</SectionTitle>
      <FileDrop
        onFiles={(files) => editor.current?.chain().insertMedia(files, "end").run()}
        label="Loslassen: in den Freitext"
      >
        {fresh ? (
          <TaskBodyEditor
            key={project.id}
            initialContent={project.body}
            notes={notes}
            onOpenNote={noteOpener.open}
            onChange={(body, text) => actions.update(project.id, { body, body_text: text })}
            images={media.images}
            files={media.files}
            editorRef={editor}
            ariaLabel="Freitext des Projekts"
            placeholder="Gedanken, Absprachen, Stand … frei wie eine Notiz"
            testId="project-body"
            refreshKey={projectsKey}
          />
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </FileDrop>
    </section>
  );
}
