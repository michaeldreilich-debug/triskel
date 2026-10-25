"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** Gruppen in Liste und Tabelle auf- und zuklappen (#73). */
export interface GroupFold {
  isOpen: (key: string) => boolean;
  /** `all`: ⌥-Klick klappt alle Gruppen der Ansicht wie diese */
  toggle: (key: string, all: boolean) => void;
}

const read = (key: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
};

/**
 * Zugeklappte Gruppen je Gerät, Ansicht und Gruppierung (`storageKey`, null = nicht gruppiert).
 * Beim Suchen ist alles offen – ein Treffer steckt nie in einer zugeklappten Gruppe.
 * `startClosed` (#79): Gruppen, die beim Öffnen der Ansicht immer zu sind (z. B. Projekte in der
 * Aufgaben-Übersicht) – dann merkt sich das Gerät nichts, Auf- und Zuklappen gilt bis zum Verlassen.
 */
export function useGroupFold(
  storageKey: string | null,
  keys: string[],
  searching: boolean,
  startClosed?: (key: string) => boolean,
): GroupFold {
  const fixed = startClosed !== undefined;
  const [closed, setClosed] = useState<string[]>([]);
  // nur mit startClosed: Gruppen, die gerade anders stehen als beim Öffnen
  const [flipped, setFlipped] = useState<string[]>([]);
  useEffect(() => {
    setClosed(storageKey && !fixed ? read(storageKey) : []);
    setFlipped([]);
  }, [storageKey, fixed]);
  const isClosed = (key: string) =>
    startClosed ? startClosed(key) !== flipped.includes(key) : closed.includes(key);
  const save = (next: string[]) => {
    setClosed(next);
    try {
      if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // nur Bequemlichkeit
    }
  };
  return {
    isOpen: (key) => searching || !isClosed(key),
    toggle: (key, all) => {
      const close = !isClosed(key);
      const affected = all ? keys : [key];
      if (startClosed) {
        setFlipped([
          ...flipped.filter((k) => !affected.includes(k)),
          ...affected.filter((k) => startClosed(k) !== close),
        ]);
        return;
      }
      save(
        close
          ? [...closed, ...affected.filter((k) => !closed.includes(k))]
          : closed.filter((k) => !affected.includes(k)),
      );
    },
  };
}

/** Klappknopf im Gruppenkopf: Pfeil, dann Inhalt des Kopfs (Symbol, Name, Anzahl). */
export function GroupFoldButton({
  open,
  onToggle,
  disabled,
  children,
}: {
  open: boolean;
  onToggle: (all: boolean) => void;
  /** beim Suchen bleibt alles offen */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      disabled={disabled}
      title={disabled ? undefined : "⌥-Klick: alle Gruppen"}
      onClick={(event) => onToggle(event.altKey)}
      className="-my-1 -ml-1.5 flex min-w-0 items-center gap-2 rounded-control px-1.5 py-1 text-left hover:bg-surface-2 disabled:hover:bg-transparent max-md:min-h-11"
    >
      <ChevronRight
        size={14}
        strokeWidth={1.75}
        aria-hidden
        className={cn("shrink-0 text-faint transition-transform", open && "rotate-90")}
      />
      {children}
    </button>
  );
}
