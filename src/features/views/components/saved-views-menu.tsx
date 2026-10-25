"use client";

import { Bookmark, BookmarkPlus, Save, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { SAVED_VIEW_LIMIT, type SavedViewRow } from "../saved";

export function SavedViewsMenu({
  views,
  activeId,
  modified,
  areaName,
  areaCount,
  onSelect,
  onSaveChanges,
  onStartSave,
  onDelete,
}: {
  /** Ansichten dieser Datenbank im aktuellen Bereich */
  views: SavedViewRow[];
  activeId: string | null;
  modified: boolean;
  areaName: string;
  /** alle Ansichten im Bereich (für die Grenze) */
  areaCount: number;
  onSelect: (id: string | null) => void;
  onSaveChanges: () => void;
  onStartSave: () => void;
  onDelete: () => void;
}) {
  const active = views.find((v) => v.id === activeId);
  const full = areaCount >= SAVED_VIEW_LIMIT;
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("max-w-56 gap-1.5 text-muted", active && "bg-surface-2 text-fg")}
          aria-label={
            active ? `Ansicht: ${active.name}${modified ? " (geändert)" : ""}` : "Ansichten"
          }
        >
          <Bookmark size={16} strokeWidth={1.5} aria-hidden />
          <span className="truncate">{active ? active.name : "Ansichten"}</span>
          {active && modified ? (
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fg" />
          ) : null}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-72">
        <MenuLabel>Gespeicherte Ansichten · {areaName}</MenuLabel>
        <MenuRadioGroup
          value={activeId ?? "standard"}
          onValueChange={(v) => onSelect(v === "standard" ? null : v)}
        >
          <MenuRadioItem value="standard">Standardansicht</MenuRadioItem>
          {views.map((view) => (
            <MenuRadioItem key={view.id} value={view.id}>
              <span className="truncate">{view.name}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        {active ? (
          <MenuItem disabled={!modified} onSelect={onSaveChanges}>
            <Save aria-hidden />
            Änderungen in „{active.name}“ speichern
          </MenuItem>
        ) : null}
        <MenuItem disabled={full} onSelect={onStartSave}>
          <BookmarkPlus aria-hidden />
          Als neue Ansicht speichern …
        </MenuItem>
        {full ? (
          <p className="max-w-72 px-2 py-1.5 text-meta text-muted">
            Höchstens {SAVED_VIEW_LIMIT} Ansichten je Bereich ({areaName}). Lösche eine, um eine
            neue zu speichern – weniger ist übersichtlicher.
          </p>
        ) : null}
        {active ? (
          <>
            <MenuSeparator />
            <MenuItem variant="danger" onSelect={onDelete}>
              <Trash2 aria-hidden />
              Ansicht löschen
            </MenuItem>
          </>
        ) : null}
      </MenuContent>
    </MenuRoot>
  );
}

/** Name für eine neue Ansicht (inline, kein Dialog). */
export function SaveViewForm({
  areaName,
  areaCount,
  onSave,
  onCancel,
}: {
  areaName: string;
  areaCount: number;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name);
      }}
    >
      <label htmlFor={id} className="text-ui-sm text-muted">
        Ansicht speichern ({areaName}, {areaCount + 1} von {SAVED_VIEW_LIMIT})
      </label>
      <Input
        id={id}
        autoFocus
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        placeholder="z. B. Diese Woche fällig"
        className="min-w-48 flex-1"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
          Speichern
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
