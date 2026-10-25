"use client";

import { ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import { quietControlClasses } from "@/components/ui/input";
import {
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";

/*
 * Eigenschaften direkt in der Tabelle ändern (#87): Die Zelle zeigt den Wert wie bisher
 * (Plakette, Datum, Projekt …); ein Klick öffnet dieselbe Auswahl wie im Panel.
 */

/**
 * Für jeden Auswahl-Auslöser in einer Zelle: Der Wert steht bündig mit der Spalte, die Zeile wird
 * nicht höher, obwohl der Knopf (am Handy 44 px) größer ist als der Text, und die Schrift bleibt
 * die der Tabelle. `max-w-none`: Mit dem negativen Rand schnitte `max-w-full` den Wert sonst um
 * den Rand zu früh ab; die Spalte wird so breit wie ihr Inhalt (wie vorher die Links). `!`, weil
 * `cn` Breite und Schriftgröße der Auslöser nicht ersetzt.
 */
export const CELL_CONTROL = "-mx-2 -my-1.5 max-w-none! text-ui-sm!";

/** Auslöser wie eine ruhige Eigenschaft im Panel (Pfeil erst beim Drüberfahren). */
const triggerClasses = cn(
  quietControlClasses,
  "group inline-flex h-11 items-center gap-1.5 text-left md:h-8",
  CELL_CONTROL,
);

function Chevron() {
  return (
    <ChevronDown
      size={14}
      strokeWidth={1.5}
      aria-hidden
      className="shrink-0 text-faint pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:opacity-100 pointer-fine:group-data-[state=open]:opacity-100"
    />
  );
}

export interface CellOption {
  value: string;
  label: string;
  /** z. B. Bereichspunkt vor dem Namen */
  icon?: React.ReactNode;
}

/** Einer aus wenigen Werten (Status, Priorität, Bereich …) – Menü unter der Zelle. */
export function CellMenu({
  label,
  value,
  options,
  onChange,
  children,
}: {
  /** Name der Eigenschaft; der Knopf heißt „Status: Offen“ */
  label: string;
  value: string;
  options: CellOption[];
  onChange: (value: string) => void;
  /** Anzeige in der Zelle (z. B. die Plakette) */
  children: React.ReactNode;
}) {
  const current = options.find((o) => o.value === value)?.label ?? "–";
  return (
    <MenuRoot modal={false}>
      <MenuTrigger aria-label={`${label}: ${current}`} className={triggerClasses}>
        {children}
        <Chevron />
      </MenuTrigger>
      <MenuContent align="start" aria-label={label}>
        <MenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.icon}
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}

/** Freiere Eingabe (z. B. Tags) in einem kleinen Fenster unter der Zelle. */
export function CellPopover({
  label,
  children,
  content,
}: {
  /** Name des Knopfs, z. B. „Tags: kontakte, fw“ */
  label: string;
  /** Anzeige in der Zelle */
  children: React.ReactNode;
  /** Eingabe im Fenster */
  content: React.ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger aria-label={label} className={triggerClasses}>
        {children}
        <Chevron />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={16}
          aria-label={label}
          className="z-50 w-72 max-w-[calc(100vw-32px)] rounded-card border border-border bg-surface p-2 text-fg shadow-float data-[state=open]:animate-pop-in"
        >
          {content}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
