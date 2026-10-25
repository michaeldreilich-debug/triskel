"use client";

import { Command } from "cmdk";
import { Plus, Search } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { cn } from "@/lib/cn";

export interface CommandItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface CommandGroup {
  heading: string;
  items: CommandItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandGroup[];
  placeholder?: string;
  /** Schnellerfassung (B8): getippter Text wird zur Aufgabe; preview = Ziel („Inbox“ …) */
  capture?: { preview: (text: string) => string; submit: (text: string) => void };
  /** Treffer aus den Daten (B10) unter den Befehlen; close schließt die Palette */
  results?: (text: string, close: () => void) => React.ReactNode;
}

const GROUP_CLASS =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-faint";

const ITEM_CLASS = cn(
  "flex min-h-11 cursor-default items-center gap-2 rounded-control px-2 text-ui outline-none md:min-h-9",
  "data-[selected=true]:bg-surface-2 [&_svg]:text-faint",
);

/** Gruppe in der Befehlspalette (auch für Treffer aus anderen Modulen). */
export function PaletteGroup({
  heading,
  forceMount,
  children,
}: {
  heading: string;
  forceMount?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Command.Group heading={heading} forceMount={forceMount} className={GROUP_CLASS}>
      {children}
    </Command.Group>
  );
}

/** Eintrag in der Befehlspalette; value muss in der Palette eindeutig sein. */
export function PaletteItem({
  value,
  onSelect,
  className,
  children,
}: {
  value: string;
  onSelect: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={cn(ITEM_CLASS, className)}>
      {children}
    </Command.Item>
  );
}

/** Hinweiszeile in der Liste (nicht auswählbar), z. B. „Suche …“ oder „Keine Treffer“. */
export function PaletteNote({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-ui-sm text-faint">{children}</p>;
}

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Befehl passt, wenn der getippte Text in Bezeichnung oder Stichwörtern vorkommt. */
export function commandMatches(item: Pick<CommandItem, "label" | "keywords">, text: string) {
  const query = fold(text.trim());
  if (!query) return true;
  return [item.label, ...(item.keywords ?? [])].some((s) => fold(s).includes(query));
}

/**
 * Befehlspalette (⌘K): erfassen, Seiten öffnen, Befehle ausführen und – über `results` – in
 * Projekten, Aufgaben und Notizen suchen. Gefiltert wird hier selbst (nicht von cmdk), damit
 * Treffer aus der Datenbank (Stemming, Inhalte) nicht wieder herausfallen.
 */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  placeholder = "Befehl oder Seite suchen …",
  capture,
  results,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const text = search.trim();
  const close = () => {
    setSearch("");
    onOpenChange(false);
  };
  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((i) => commandMatches(i, text)) }))
    .filter((group) => group.items.length > 0);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setSearch("");
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-4 top-[12dvh] z-50 mx-auto max-w-xl overflow-hidden rounded-card border border-border bg-surface text-fg shadow-float",
            "outline-none data-[state=open]:animate-pop-in",
          )}
        >
          <Dialog.Title className="sr-only">Befehlspalette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Suchen, Seiten öffnen und Befehle ausführen
          </Dialog.Description>
          <Command label="Befehlspalette" loop shouldFilter={false}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={capture ? "Suchen, Befehl – oder etwas erfassen …" : placeholder}
                className="h-12 w-full bg-transparent text-body-lg text-fg outline-none placeholder:text-faint md:text-ui"
              />
            </div>
            <Command.List className="max-h-[min(60dvh,420px)] overflow-y-auto p-1">
              {capture || results ? null : (
                <Command.Empty className="px-3 py-6 text-center text-ui text-faint">
                  Nichts gefunden.
                </Command.Empty>
              )}
              {capture && text ? (
                <PaletteGroup heading="Erfassen" forceMount>
                  <PaletteItem
                    value="__erfassen__"
                    onSelect={() => {
                      capture.submit(text);
                      close();
                    }}
                  >
                    <Plus size={16} strokeWidth={1.5} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">„{text}“ erfassen</span>
                    <span className="shrink-0 text-meta text-faint">→ {capture.preview(text)}</span>
                  </PaletteItem>
                </PaletteGroup>
              ) : null}
              {visibleGroups.map((group) => (
                <PaletteGroup key={group.heading} heading={group.heading}>
                  {group.items.map((item) => (
                    <PaletteItem
                      key={item.id}
                      value={`${group.heading} ${item.label}`}
                      onSelect={() => {
                        close();
                        item.onSelect();
                      }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      {item.shortcut ? (
                        <span className="ml-auto font-mono text-meta text-faint">
                          {item.shortcut}
                        </span>
                      ) : null}
                    </PaletteItem>
                  ))}
                </PaletteGroup>
              ))}
              {results && text ? results(text, close) : null}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
