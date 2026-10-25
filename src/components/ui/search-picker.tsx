"use client";

import { Command } from "cmdk";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { buttonClasses } from "./button";
import { quietControlClasses, titleControlClasses } from "./input";

export interface PickerItem {
  id: string;
  label: string;
  /** zweite Zeile bzw. Kontext rechts (z. B. Projekt, Status) */
  meta?: string;
  icon?: React.ReactNode;
  keywords?: string[];
  /** Hinweis rechts, z. B. „bildet Kreis“ (Eintrag bleibt wählbar, die Aktion lehnt ab) */
  note?: string;
}

export interface SearchPickerProps {
  id?: string;
  "aria-label"?: string;
  /** Text im Auslöser */
  label: React.ReactNode;
  /** Auslöser grau (z. B. „Kein Projekt“) */
  muted?: boolean;
  /** quiet = Eigenschaft, title = Überschrift, button = Knopf, add = ruhiges „+ …“ in Eigenschaften */
  variant?: "quiet" | "title" | "button" | "add";
  icon?: React.ReactNode;
  items: PickerItem[];
  /** zuletzt benutzte IDs zuerst (höchstens recentLimit) */
  recentIds?: string[];
  recentLimit?: number;
  /** feste Einträge über der Liste (z. B. „Kein Projekt“) */
  fixed?: PickerItem[];
  /** markierte Einträge (Haken) */
  selectedIds?: string[];
  onSelect: (id: string) => void;
  /** wenn gesetzt: „… anlegen“, falls kein Eintrag genau passt */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  searchLabel: string;
  placeholder?: string;
  emptyText?: string;
  allLabel?: string;
  /** Mehrfachauswahl: nach der Wahl offen bleiben */
  closeOnSelect?: boolean;
  align?: "start" | "end";
  className?: string;
  disabled?: boolean;
}

const itemClasses = cn(
  "flex min-h-11 cursor-default items-center gap-2 rounded-control px-2 text-ui outline-none md:min-h-8",
  "data-[selected=true]:bg-surface-2 aria-[current=true]:font-medium",
);
const groupClasses =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-faint";

/** Suche über Name und Stichwörter (nicht über IDs): Wortanfang vor Teilwort, Groß/klein egal. */
export function matchKeywords(_value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLocaleLowerCase("de");
  if (!needle) return 1;
  const text = (keywords ?? []).join(" ").toLocaleLowerCase("de");
  if (text.startsWith(needle)) return 1;
  if (text.split(/\s+/).some((word) => word.startsWith(needle))) return 0.8;
  return text.includes(needle) ? 0.5 : 0;
}

/**
 * Auswahl mit vielen Einträgen per Tastatur (Rückmeldung #5): Suchfeld, zuletzt
 * benutzte oben, Enter übernimmt, optional „… anlegen“, wenn nichts genau passt.
 */
export function SearchPicker({
  id,
  label,
  muted,
  variant = "quiet",
  icon,
  items,
  recentIds = [],
  recentLimit = 5,
  fixed = [],
  selectedIds = [],
  onSelect,
  onCreate,
  createLabel = (query) => `„${query}“ anlegen`,
  searchLabel,
  placeholder,
  emptyText = "Nichts gefunden.",
  allLabel = "Alle",
  closeOnSelect = true,
  align = "start",
  className,
  disabled,
  ...props
}: SearchPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim();
  const byId = new Map(items.map((item) => [item.id, item]));
  const recent = query
    ? []
    : recentIds
        .map((itemId) => byId.get(itemId))
        .filter((item): item is PickerItem => Boolean(item))
        .slice(0, recentLimit);
  const rest = items.filter((item) => !recent.includes(item));
  const exact = items.some(
    (item) => item.label.toLocaleLowerCase("de") === query.toLocaleLowerCase("de"),
  );

  const choose = (next: string) => {
    if (closeOnSelect) {
      setOpen(false);
      setSearch("");
    }
    onSelect(next);
  };

  const renderItem = (item: PickerItem, prefix: string) => (
    <Command.Item
      key={`${prefix}-${item.id}`}
      value={`${prefix}-${item.id}`}
      keywords={[item.label, ...(item.meta ? [item.meta] : []), ...(item.keywords ?? [])]}
      onSelect={() => choose(item.id)}
      aria-current={selectedIds.includes(item.id) ? "true" : undefined}
      className={itemClasses}
    >
      {item.icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{item.label}</span>
        {item.meta ? <span className="truncate text-meta text-faint">{item.meta}</span> : null}
      </span>
      {item.note ? <span className="shrink-0 text-meta text-faint">{item.note}</span> : null}
      {selectedIds.includes(item.id) ? (
        <Check size={14} strokeWidth={2} className="shrink-0 text-fg" aria-hidden />
      ) : null}
    </Command.Item>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <Popover.Trigger
        id={id}
        aria-label={props["aria-label"]}
        disabled={disabled}
        className={cn(
          variant === "button"
            ? buttonClasses("secondary", "sm")
            : variant === "add"
              ? cn(
                  quietControlClasses,
                  "inline-flex h-11 items-center gap-1.5 text-left text-faint hover:text-fg md:h-8",
                )
              : cn(
                  variant === "title" ? titleControlClasses : quietControlClasses,
                  "group inline-flex h-11 items-center gap-2 text-left",
                  variant === "title" ? "md:h-9" : "md:h-8",
                ),
          className,
        )}
      >
        {icon}
        <span className={cn("min-w-0 truncate", muted && "text-faint")}>{label}</span>
        {variant === "button" || variant === "add" ? null : (
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            aria-hidden
            className={cn(
              "shrink-0 text-faint",
              variant === "quiet" &&
                "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:opacity-100",
            )}
          />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={4}
          collisionPadding={16}
          className="z-50 w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-card border border-border bg-surface text-fg shadow-float data-[state=open]:animate-pop-in"
        >
          <Command label={searchLabel} loop filter={matchKeywords}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={placeholder ?? `${searchLabel} …`}
                aria-label={searchLabel}
                className="h-11 w-full bg-transparent text-body-lg text-fg outline-none placeholder:text-faint md:h-10 md:text-ui"
              />
            </div>
            <Command.List className="max-h-[min(50dvh,340px)] overflow-y-auto p-1">
              <Command.Empty className="px-2 py-3 text-ui-sm text-faint">{emptyText}</Command.Empty>
              {fixed.map((item) => renderItem(item, "fest"))}
              {recent.length > 0 ? (
                <Command.Group heading="Zuletzt benutzt" className={groupClasses}>
                  {recent.map((item) => renderItem(item, "zuletzt"))}
                </Command.Group>
              ) : null}
              {rest.length > 0 ? (
                <Command.Group
                  heading={recent.length > 0 ? allLabel : undefined}
                  className={groupClasses}
                >
                  {rest.map((item) => renderItem(item, "alle"))}
                </Command.Group>
              ) : null}
              {onCreate && query && !exact ? (
                <Command.Item
                  forceMount
                  value="__anlegen__"
                  onSelect={() => {
                    setOpen(false);
                    setSearch("");
                    onCreate(query);
                  }}
                  className={itemClasses}
                >
                  <Plus size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
                  <span className="truncate">{createLabel(query)}</span>
                </Command.Item>
              ) : null}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
