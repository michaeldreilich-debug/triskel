"use client";

import { Plus, Shapes, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { BufferedInput } from "@/components/ui/buffered-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FoldSection } from "@/components/ui/fold-section";
import { controlClasses, FieldHint } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useNotes } from "../api";
import { useNoteTypeActions, useNoteTypes } from "../note-types";
import { DEFAULT_NOTE_TYPE, type NoteTypeRow } from "../types";

/**
 * Einstellungen › Notiz-Typen (#34, „wie bei Notion“): anlegen, umbenennen, löschen. Beim
 * Löschen fragt die App, in welchen Typ die Notizen ziehen (Vorschlag: der Standard). „Idee“ ist
 * der Standard für neue Notizen (Rückmeldung 17.10.2026) und lässt sich nur umbenennen.
 */
export function NoteTypesSection() {
  const noteTypes = useNoteTypes();
  const actions = useNoteTypeActions();
  const notes = useNotes();
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const newId = useId();
  const counts = new Map<string, number>();
  for (const note of notes.data ?? []) counts.set(note.type, (counts.get(note.type) ?? 0) + 1);

  const add = () => {
    if (actions.create(draft)) setDraft("");
  };

  return (
    <FoldSection
      id="notiz-typen"
      icon={Shapes}
      title="Notiz-Typen"
      sub="Eigene Typen anlegen, umbenennen oder löschen – Notizen behalten beim Umbenennen ihren Typ"
      summary={
        noteTypes.loading
          ? undefined
          : `${noteTypes.types.length} Typen: ${noteTypes.types.map((t) => t.name).join(", ")}`
      }
    >
      {noteTypes.loading ? (
        <Skeleton className="h-40 w-full rounded-card" />
      ) : (
        <ul aria-label="Notiz-Typen" className="flex flex-col gap-1">
          {noteTypes.types.map((type) => (
            <TypeRow
              key={type.id}
              type={type}
              count={counts.get(type.key) ?? 0}
              others={noteTypes.types.filter((t) => t.key !== type.key)}
              deleting={deleting === type.key}
              onDelete={() => setDeleting(type.key)}
              onCancel={() => setDeleting(null)}
              onConfirm={(target) => {
                setDeleting(null);
                actions.remove(type.key, target);
              }}
              onRename={(name) => actions.rename(type.id, name)}
              onKnowledge={(value) => actions.setKnowledge(type.id, value)}
            />
          ))}
        </ul>
      )}
      <form
        className="flex max-w-md items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label htmlFor={newId} className="sr-only">
          Neuer Notiz-Typ
        </label>
        <div className="min-w-0 flex-1">
          <input
            id={newId}
            value={draft}
            maxLength={40}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Neuer Typ, z. B. Besprechung"
            className={cn(controlClasses, "h-11 md:h-9")}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!draft.trim() || noteTypes.loading}>
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          Anlegen
        </Button>
      </form>
      <FieldHint>
        Neue Typen gehen auch direkt in einer Notiz: bei „Typ“ den Namen tippen und anlegen. „Zählt
        als Wissen“: Notizen dieses Typs stehen unter Wissen (mit und ohne Projekt); alle anderen
        bleiben unter Notizen und am Projekt.
      </FieldHint>
    </FoldSection>
  );
}

function TypeRow({
  type,
  count,
  others,
  deleting,
  onDelete,
  onCancel,
  onConfirm,
  onRename,
  onKnowledge,
}: {
  type: NoteTypeRow;
  count: number;
  others: NoteTypeRow[];
  deleting: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onConfirm: (target: string) => void;
  onRename: (name: string) => void;
  onKnowledge: (value: boolean) => void;
}) {
  const [target, setTarget] = useState(DEFAULT_NOTE_TYPE);
  const targetId = useId();
  const knowledgeId = useId();
  const isDefault = type.key === DEFAULT_NOTE_TYPE;
  return (
    <li className="flex flex-col gap-2 rounded-card px-1 py-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <BufferedInput
            aria-label={`Name des Typs „${type.name}“`}
            value={type.name}
            maxLength={40}
            onValueChange={onRename}
            className="h-11 w-full min-w-0 rounded-control bg-transparent px-2 text-ui text-fg hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none md:h-9"
          />
        </div>
        <span className="shrink-0 text-meta text-faint tabular-nums">
          {count === 1 ? "1 Notiz" : `${count} Notizen`}
        </span>
        {isDefault ? (
          <span className="shrink-0 px-1 text-meta text-faint">Standard</span>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Typ „${type.name}“ löschen`}
            title="Löschen"
            onClick={onDelete}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
          </Button>
        )}
      </div>
      <label
        htmlFor={knowledgeId}
        className="ml-2 flex min-h-11 w-fit cursor-pointer items-center gap-2 text-meta text-muted md:min-h-9"
      >
        <Checkbox
          id={knowledgeId}
          checked={type.counts_as_knowledge}
          onCheckedChange={(value) => onKnowledge(value === true)}
          aria-label={`Typ „${type.name}“ zählt als Wissen`}
        />
        zählt als Wissen
      </label>
      {deleting ? (
        <fieldset
          aria-label={`„${type.name}“ löschen`}
          className="m-0 ml-2 flex min-w-0 flex-wrap items-center gap-2 rounded-card border border-border px-3 py-2"
        >
          {count > 0 ? (
            <>
              <label htmlFor={targetId} className="text-ui-sm text-muted">
                {count === 1 ? "Die Notiz zieht um nach" : `Die ${count} Notizen ziehen um nach`}
              </label>
              <div className="w-44">
                <Select
                  id={targetId}
                  value={target}
                  onValueChange={setTarget}
                  options={others.map((t) => ({ value: t.key, label: t.name }))}
                />
              </div>
            </>
          ) : (
            <span className="text-ui-sm text-muted">Keine Notiz hat diesen Typ.</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Abbrechen
            </Button>
            <Button variant="danger" size="sm" onClick={() => onConfirm(target)}>
              Löschen
            </Button>
          </div>
        </fieldset>
      ) : null}
    </li>
  );
}
