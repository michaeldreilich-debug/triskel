"use client";

import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { AreaDot } from "@/components/ui/pill";
import { type PickerItem, SearchPicker } from "@/components/ui/search-picker";
import type { AreaSummary } from "@/features/areas/defaults";
import {
  isOpenProject,
  type MilestoneRow,
  PROJECT_STATUS_LABELS,
  type ProjectRow,
  projectTitle,
} from "@/features/projects/types";
import { appPath } from "@/lib/app-links";
import { formatDateShort } from "@/lib/dates";
import { type TaskRow, taskTitle } from "../types";

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/** Projekte nach letzter Bewegung (zuletzt benutzt zuerst). */
export function recentProjectIds(projects: ProjectRow[]): string[] {
  return [...projects]
    .sort(
      (a, b) =>
        Math.max(time(b.last_activity_at), time(b.updated_at)) -
        Math.max(time(a.last_activity_at), time(a.updated_at)),
    )
    .map((p) => p.id);
}

/** Aufgaben nach letzter Bearbeitung (zuletzt benutzt zuerst). */
export function recentTaskIds(tasks: TaskRow[]): string[] {
  return [...tasks].sort((a, b) => time(b.updated_at) - time(a.updated_at)).map((t) => t.id);
}

export const NO_PROJECT = "__ohne__";

export function ProjectPicker({
  id,
  value,
  projects,
  areas,
  onSelect,
  onCreate,
  variant = "quiet",
  label,
  showArea = false,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string | null;
  projects: ProjectRow[];
  areas: AreaSummary[];
  onSelect: (projectId: string | null) => void;
  onCreate?: (title: string) => void;
  variant?: "quiet" | "button";
  label?: string;
  /** Bereichspunkt vor dem gewählten Projekt (Tabelle, #87) */
  showArea?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const current = projects.find((p) => p.id === value);
  const open = projects.filter((p) => isOpenProject(p) || p.id === value);
  const areaOf = (areaId: string) => areas.find((a) => a.id === areaId);
  const items: PickerItem[] = [...open]
    .sort((a, b) => projectTitle(a).localeCompare(projectTitle(b), "de"))
    .map((p) => {
      const area = areaOf(p.area_id);
      return {
        id: p.id,
        label: projectTitle(p),
        meta: [area?.name, PROJECT_STATUS_LABELS[p.status]].filter(Boolean).join(" · "),
        icon: area ? <AreaDot color={area.color} /> : undefined,
      };
    });
  const currentArea = current ? areaOf(current.area_id) : undefined;
  return (
    <SearchPicker
      id={id}
      variant={variant}
      className={className}
      aria-label={ariaLabel}
      icon={showArea && currentArea ? <AreaDot color={currentArea.color} /> : undefined}
      label={label ?? (current ? projectTitle(current) : "Kein Projekt")}
      muted={!current && variant === "quiet"}
      items={items}
      recentIds={recentProjectIds(open)}
      fixed={value ? [{ id: NO_PROJECT, label: "Kein Projekt" }] : []}
      selectedIds={value ? [value] : []}
      onSelect={(next) => onSelect(next === NO_PROJECT ? null : next)}
      onCreate={onCreate}
      createLabel={(q) => `Neues Projekt „${q}“ anlegen`}
      searchLabel="Projekt suchen"
      emptyText="Kein Projekt gefunden."
      allLabel="Alle Projekte"
    />
  );
}

/**
 * Projekt-Zuordnung mit Weg zum Projekt (Rückmeldung #26): Auswahl, daneben „Projekt öffnen“.
 * Abgeschlossene und archivierte Projekte bleiben sichtbar und sagen ihren Status.
 */
export function ProjectField({
  id,
  value,
  projects,
  areas,
  onSelect,
  onNavigate,
  showArea,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string | null;
  projects: ProjectRow[];
  areas: AreaSummary[];
  onSelect: (projectId: string | null) => void;
  /** z. B. Panel schließen, bevor die Projektseite aufgeht */
  onNavigate?: () => void;
  /** Bereichspunkt vor dem Projekt (Tabelle, #87) */
  showArea?: boolean;
  /** Klassen für den Auslöser der Auswahl */
  className?: string;
  "aria-label"?: string;
}) {
  const current = projects.find((p) => p.id === value);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0">
        <ProjectPicker
          id={id}
          value={value}
          projects={projects}
          areas={areas}
          onSelect={onSelect}
          showArea={showArea}
          className={className}
          aria-label={ariaLabel}
        />
      </div>
      {current && !isOpenProject(current) ? (
        <span data-testid="project-closed" className="shrink-0 text-meta text-faint">
          {PROJECT_STATUS_LABELS[current.status]}
        </span>
      ) : null}
      {current ? (
        <Link
          href={appPath.project(current.id)}
          onClick={onNavigate}
          aria-label={`Projekt „${projectTitle(current)}“ öffnen`}
          title="Projekt öffnen"
          className={buttonClasses("ghost", "icon-sm")}
        >
          <ArrowUpRight size={16} strokeWidth={1.5} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

export function MilestonePicker({
  id,
  value,
  milestones,
  onSelect,
  onCreate,
}: {
  id?: string;
  value: string | null;
  milestones: MilestoneRow[];
  onSelect: (milestoneId: string | null) => void;
  onCreate?: (title: string) => void;
}) {
  const current = milestones.find((m) => m.id === value);
  const items: PickerItem[] = milestones.map((m) => ({
    id: m.id,
    label: m.title.trim() || "Ohne Titel",
    meta: [m.due_date ? `fällig ${formatDateShort(m.due_date)}` : "", m.done_at ? "erreicht" : ""]
      .filter(Boolean)
      .join(" · "),
  }));
  return (
    <SearchPicker
      id={id}
      label={current ? current.title.trim() || "Ohne Titel" : "Kein Meilenstein"}
      muted={!current}
      items={items}
      recentIds={[...milestones]
        .sort((a, b) => time(b.updated_at) - time(a.updated_at))
        .map((m) => m.id)}
      fixed={value ? [{ id: NO_PROJECT, label: "Kein Meilenstein" }] : []}
      selectedIds={value ? [value] : []}
      onSelect={(next) => onSelect(next === NO_PROJECT ? null : next)}
      onCreate={onCreate}
      createLabel={(q) => `Neuer Meilenstein „${q}“`}
      searchLabel="Meilenstein suchen"
      emptyText="Kein Meilenstein gefunden."
      allLabel="Alle Meilensteine"
    />
  );
}

/**
 * Aufgabe wählen (z. B. „Blockiert durch“, „Nächster Schritt“, Abendplanung).
 * note(task) markiert Einträge, die die Aktion ablehnen wird (z. B. „bildet Kreis“).
 */
export function TaskPicker({
  id,
  label,
  tasks,
  projects,
  selectedIds = [],
  onSelect,
  note,
  variant = "button",
  closeOnSelect = true,
  searchLabel = "Aufgabe suchen",
  ariaLabel,
  onCreate,
}: {
  id?: string;
  label: string;
  tasks: TaskRow[];
  projects: ProjectRow[];
  selectedIds?: string[];
  onSelect: (taskId: string) => void;
  note?: (task: TaskRow) => string | undefined;
  variant?: "quiet" | "button" | "add";
  closeOnSelect?: boolean;
  searchLabel?: string;
  ariaLabel?: string;
  onCreate?: (title: string) => void;
}) {
  const projectOf = (projectId: string | null) => projects.find((p) => p.id === projectId);
  const items: PickerItem[] = tasks.map((t) => ({
    id: t.id,
    label: taskTitle(t),
    meta: [
      projectOf(t.project_id)?.title,
      t.due_date ? `fällig ${formatDateShort(t.due_date)}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    note: note?.(t),
  }));
  return (
    <SearchPicker
      id={id}
      aria-label={ariaLabel}
      variant={variant}
      icon={variant === "quiet" ? undefined : <Plus size={14} strokeWidth={1.5} aria-hidden />}
      label={label}
      items={items}
      recentIds={recentTaskIds(tasks)}
      selectedIds={selectedIds}
      onSelect={onSelect}
      onCreate={onCreate}
      createLabel={(q) => `Neue Aufgabe „${q}“`}
      searchLabel={searchLabel}
      emptyText="Keine Aufgabe gefunden."
      allLabel="Alle offenen Aufgaben"
      closeOnSelect={closeOnSelect}
    />
  );
}
