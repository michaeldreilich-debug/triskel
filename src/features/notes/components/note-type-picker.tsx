"use client";

import { Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { SearchPicker } from "@/components/ui/search-picker";
import { appPath } from "@/lib/app-links";
import { useNoteTypeActions, useNoteTypes } from "../note-types";
import type { NoteType } from "../types";

const MANAGE = "__typen-bearbeiten__";

/**
 * Typ einer Notiz wählen (#34, „wie bei Notion“): suchen, einen neuen Typ gleich anlegen
 * („Typ „Besprechung“ anlegen“) oder zu Einstellungen › Notiz-Typen springen.
 */
export function NoteTypePicker({
  id,
  value,
  onSelect,
  "aria-label": ariaLabel,
  label,
  className,
}: {
  id?: string;
  "aria-label"?: string;
  value: NoteType;
  onSelect: (type: NoteType) => void;
  /** Inhalt des Auslösers statt des Namens (z. B. als Plakette in der Tabelle, #87) */
  label?: React.ReactNode;
  className?: string;
}) {
  const noteTypes = useNoteTypes();
  const actions = useNoteTypeActions();
  const router = useRouter();
  return (
    <SearchPicker
      id={id}
      aria-label={ariaLabel}
      variant="quiet"
      label={label ?? noteTypes.name(value)}
      className={className}
      items={noteTypes.types.map((t) => ({ id: t.key, label: t.name }))}
      fixed={[
        {
          id: MANAGE,
          label: "Typen bearbeiten …",
          icon: <Settings2 size={16} strokeWidth={1.5} aria-hidden />,
        },
      ]}
      selectedIds={[value]}
      onSelect={(key) => {
        if (key === MANAGE) router.push(appPath.settings("notiz-typen"));
        else onSelect(key);
      }}
      onCreate={(name) => {
        const created = actions.create(name);
        if (created) onSelect(created.key);
      }}
      createLabel={(query) => `Typ „${query}“ anlegen`}
      searchLabel="Typ suchen oder anlegen"
      placeholder="Typ suchen oder neu …"
      emptyText="Kein Typ gefunden."
      allLabel="Alle Typen"
    />
  );
}
