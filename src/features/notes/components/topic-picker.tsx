"use client";

import { Command } from "cmdk";
import { ChevronDown, Plus, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { quietControlClasses, titleControlClasses } from "@/components/ui/input";
import { AreaDot } from "@/components/ui/pill";
import type { AreaSummary } from "@/features/areas/defaults";
import { cn } from "@/lib/cn";
import type { TopicRow } from "../types";

/** Wie viele zuletzt benutzte Themen oben stehen */
const RECENT_LIMIT = 5;

export interface TopicPickerProps {
  id?: string;
  "aria-label"?: string;
  /** gewählter Wert: Themen-ID oder einer der festen Einträge */
  value: string;
  /** Text im Auslöser */
  label: React.ReactNode;
  /** Text grau (z. B. „Kein Thema“) */
  muted?: boolean;
  topics: TopicRow[];
  areas: AreaSummary[];
  /** Themen-IDs, zuletzt benutzte zuerst */
  recentIds: string[];
  /** feste Einträge über den Themen, z. B. „Kein Thema“ oder „Alle Notizen“ */
  fixed: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
  /** wenn gesetzt: „Neues Thema „…“ anlegen“, falls kein Thema genau passt */
  onCreate?: (name: string) => void;
  variant?: "quiet" | "title";
  className?: string;
}

const itemClasses = cn(
  "flex min-h-11 cursor-default items-center gap-2 rounded-control px-2 text-ui outline-none md:min-h-8",
  "data-[selected=true]:bg-surface-2 aria-[current=true]:font-medium",
);
const groupClasses =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-faint";

/**
 * Thema per Tastatur wählen: Suchfeld, zuletzt benutzte Themen oben, Enter übernimmt,
 * „Neues Thema „…“ anlegen“, wenn nichts genau passt (Rückmeldung 11.10.2026).
 */
export function TopicPicker({
  id,
  value,
  label,
  muted,
  topics,
  areas,
  recentIds,
  fixed,
  onSelect,
  onCreate,
  variant = "quiet",
  className,
  ...props
}: TopicPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim();
  const colorOf = (areaId: string) => areas.find((a) => a.id === areaId)?.color;
  const byName = [...topics].sort((a, b) => a.name.localeCompare(b.name, "de"));
  const recent = query
    ? []
    : recentIds
        .map((topicId) => topics.find((t) => t.id === topicId))
        .filter((t): t is TopicRow => Boolean(t))
        .slice(0, RECENT_LIMIT);
  const rest = byName.filter((t) => !recent.includes(t));
  const exact = topics.some(
    (t) => t.name.toLocaleLowerCase("de") === query.toLocaleLowerCase("de"),
  );

  const choose = (next: string) => {
    setOpen(false);
    setSearch("");
    onSelect(next);
  };

  const topicItem = (topic: TopicRow) => {
    const color = colorOf(topic.area_id);
    return (
      <Command.Item
        key={topic.id}
        value={topic.id}
        keywords={[topic.name]}
        onSelect={() => choose(topic.id)}
        aria-current={topic.id === value ? "true" : undefined}
        className={itemClasses}
      >
        {color ? <AreaDot color={color} /> : null}
        <span className="truncate">{topic.name}</span>
      </Command.Item>
    );
  };

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
        className={cn(
          variant === "title" ? titleControlClasses : quietControlClasses,
          "group inline-flex h-11 items-center gap-2 text-left",
          variant === "title" ? "md:h-9" : "md:h-8",
          className,
        )}
      >
        <span className={cn("min-w-0 truncate", muted && "text-faint")}>{label}</span>
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
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={16}
          className="z-50 w-72 max-w-[calc(100vw-32px)] overflow-hidden rounded-card border border-border bg-surface text-fg shadow-float data-[state=open]:animate-pop-in"
        >
          <Command label="Thema suchen" loop filter={matchName}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={onCreate ? "Thema suchen oder anlegen …" : "Thema suchen …"}
                aria-label="Thema suchen"
                className="h-11 w-full bg-transparent text-body-lg text-fg outline-none placeholder:text-faint md:h-10 md:text-ui"
              />
            </div>
            <Command.List className="max-h-[min(50dvh,320px)] overflow-y-auto p-1">
              <Command.Empty className="px-2 py-3 text-ui-sm text-faint">
                Kein Thema gefunden.
              </Command.Empty>
              {fixed.map((item) => (
                <Command.Item
                  key={item.value}
                  value={item.value}
                  keywords={[item.label]}
                  onSelect={() => choose(item.value)}
                  aria-current={item.value === value ? "true" : undefined}
                  className={itemClasses}
                >
                  {item.label}
                </Command.Item>
              ))}
              {recent.length > 0 ? (
                <Command.Group heading="Zuletzt benutzt" className={groupClasses}>
                  {recent.map(topicItem)}
                </Command.Group>
              ) : null}
              {rest.length > 0 ? (
                <Command.Group
                  heading={recent.length > 0 ? "Alle Themen" : undefined}
                  className={groupClasses}
                >
                  {rest.map(topicItem)}
                </Command.Group>
              ) : null}
              {onCreate && query && !exact ? (
                <Command.Item
                  forceMount
                  value="__neues-thema__"
                  onSelect={() => {
                    setOpen(false);
                    setSearch("");
                    onCreate(query);
                  }}
                  className={itemClasses}
                >
                  <Plus size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
                  <span className="truncate">Neues Thema „{query}“ anlegen</span>
                </Command.Item>
              ) : null}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Suche über den Namen (nicht über IDs): Wortanfang vor Teilwort, Groß/klein egal. */
function matchName(_value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLocaleLowerCase("de");
  if (!needle) return 1;
  const name = (keywords ?? []).join(" ").toLocaleLowerCase("de");
  if (name.startsWith(needle)) return 1;
  return name.includes(needle) ? 0.5 : 0;
}

/** Themen-IDs nach letzter Bearbeitung ihrer Notizen (zuletzt benutzte zuerst). */
export function recentTopicIds(
  notes: Array<{ topic_id: string | null; edited_at: string }>,
): string[] {
  const latest = new Map<string, number>();
  for (const note of notes) {
    if (!note.topic_id) continue;
    const time = Date.parse(note.edited_at) || 0;
    if (time > (latest.get(note.topic_id) ?? -1)) latest.set(note.topic_id, time);
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([topicId]) => topicId);
}
