"use client";

import { AppWindow, BookOpen, ExternalLink, Globe, Link2, ListChecks, Trash2 } from "lucide-react";
import { OPEN_IN_NEW_TAB, useOpenInNewTab } from "@/components/shell/tabs/tabs-provider";
import { copyAppLink } from "@/components/ui/copy-link";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { AreaDot } from "@/components/ui/pill";
import { useAreas } from "@/features/areas/api";
import { useConvert } from "@/features/convert/api";
import { openNoteShare } from "@/features/share/components/share-dialog";
import { appPath } from "@/lib/app-links";
import { useNoteActions, useTopics } from "../api";
import { useNoteTypes } from "../note-types";
import { type NoteRow, noteTitle } from "../types";

/**
 * Rechtsklick-Menü einer Notiz (#35): Öffnen, Typ, Bereich, Link kopieren, öffentlich freigeben
 * (#94), Papierkorb – in der Notizen-Datenbank (Liste, Tabelle, Board) und in der Liste unter
 * Wissen.
 */
export function NoteContextMenuItems({
  note,
  onOpen,
  openLabel = "Öffnen",
  onOpenInKnowledge,
  onTrashed,
}: {
  note: NoteRow;
  onOpen: () => void;
  openLabel?: string;
  /** zusätzlich „Im Wissen öffnen“, wenn „Öffnen“ ein Panel zeigt (#88) */
  onOpenInKnowledge?: () => void;
  /** z. B. die gerade offene Notiz schließen */
  onTrashed?: () => void;
}) {
  const actions = useNoteActions();
  const areas = useAreas().data ?? [];
  const topics = useTopics().data ?? [];
  const noteTypes = useNoteTypes();
  const convert = useConvert();
  const openInNewTab = useOpenInNewTab();
  const moveToArea = (areaId: string) => {
    // das Thema bleibt nur, wenn es zum neuen Bereich gehört
    const keepTopic = topics.find((t) => t.id === note.topic_id)?.area_id === areaId;
    actions.update(note.id, { area_id: areaId, ...(keepTopic ? {} : { topic_id: null }) });
  };
  return (
    <>
      <ContextMenuItem onSelect={onOpen}>
        <ExternalLink aria-hidden />
        {openLabel}
      </ContextMenuItem>
      {onOpenInKnowledge ? (
        <ContextMenuItem onSelect={onOpenInKnowledge}>
          <BookOpen aria-hidden />
          Im Wissen öffnen
        </ContextMenuItem>
      ) : null}
      {openInNewTab ? (
        <ContextMenuItem onSelect={() => openInNewTab(appPath.note(note.id))}>
          <AppWindow aria-hidden />
          {OPEN_IN_NEW_TAB}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSub>
        <ContextMenuSubTrigger>Typ</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={note.type}
            onValueChange={(value) => actions.update(note.id, { type: value })}
          >
            {noteTypes.types.map((t) => (
              <ContextMenuRadioItem key={t.key} value={t.key}>
                {t.name}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Bereich</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={note.area_id} onValueChange={moveToArea}>
            {areas.map((a) => (
              <ContextMenuRadioItem key={a.id} value={a.id}>
                <span className="inline-flex items-center gap-2">
                  <AreaDot color={a.color} />
                  {a.name}
                </span>
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => void convert.noteToTask(note.id)}>
        <ListChecks aria-hidden />
        In Aufgabe umwandeln
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => copyAppLink(appPath.note(note.id))}>
        <Link2 aria-hidden />
        Link kopieren
      </ContextMenuItem>
      {/* öffentlich per Link (#94): eigener Punkt, „Link kopieren“ bleibt intern */}
      <ContextMenuItem onSelect={() => openNoteShare(note.id)}>
        <Globe aria-hidden />
        Öffentlich freigeben …
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="danger" onSelect={() => actions.trash(note.id, onTrashed)}>
        <Trash2 aria-hidden />
        In den Papierkorb
      </ContextMenuItem>
    </>
  );
}

/** Listenzeile mit Rechtsklick-Menü (am Handy wischt die Zeile, Desktop: Rechtsklick). */
export function NoteContextMenu({
  note,
  children,
  ...items
}: React.ComponentProps<typeof NoteContextMenuItems> & { children: React.ReactNode }) {
  return (
    <ContextMenuRoot modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`Notiz „${noteTitle(note)}“`}>
        <NoteContextMenuItems note={note} {...items} />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
