/**
 * Gruppenkopf mit Weg zum Eintrag der Gruppe (#48): Wer nach Projekt gruppiert, kommt mit einem
 * Klick ins Projekt (Muster #26 „Projekt öffnen“).
 */
import { type ProjectRow, projectTitle } from "@/features/projects/types";
import { appPath } from "@/lib/app-links";

export interface GroupLinkTarget {
  href: string;
  /** zugänglicher Name, z. B. „Projekt „Steuer 2024“ öffnen“ */
  label: string;
}

export function projectGroupLink(
  field: string,
  key: string,
  projects: Pick<ProjectRow, "id" | "title">[],
): GroupLinkTarget | null {
  if (field !== "project" || !key) return null;
  const project = projects.find((p) => p.id === key);
  return project
    ? { href: appPath.project(project.id), label: `Projekt „${projectTitle(project)}“ öffnen` }
    : null;
}

/**
 * Notizen nach Typ gruppiert (#56): Typen, die als Wissen zählen, führen mit einem Klick ins
 * Wissen (dort stehen sie nach Themen); andere Typen haben kein eigenes Ziel.
 */
export function typeGroupLink(
  field: string,
  key: string,
  types: ReadonlyArray<{ key: string; name: string; counts_as_knowledge?: boolean }>,
): GroupLinkTarget | null {
  if (field !== "type" || !key) return null;
  const type = types.find((t) => t.key === key);
  return type?.counts_as_knowledge
    ? { href: appPath.knowledge(), label: `„${type.name}“ im Wissen ansehen` }
    : null;
}
