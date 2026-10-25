"use client";

import { Check, ChevronRight, Dot } from "lucide-react";
import { ContextMenu as RadixContextMenu, DropdownMenu as RadixDropdownMenu } from "radix-ui";
import { cn } from "@/lib/cn";

const contentClasses = cn(
  "z-50 min-w-48 overflow-hidden rounded-card border border-border bg-surface p-1 text-fg shadow-float",
  "data-[state=open]:animate-pop-in",
);
const itemClasses = cn(
  "relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-control px-2 py-1.5 text-ui outline-none md:min-h-8",
  "data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  "data-[variant=danger]:text-danger [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-faint",
);
const labelClasses = "px-2 pt-2 pb-1 text-meta uppercase tracking-widest text-faint";
const separatorClasses = "-mx-1 my-1 h-px bg-border";

type ItemProps = { variant?: "danger"; shortcut?: string };

function Shortcut({ children }: { children?: string }) {
  return children ? (
    <span className="ml-auto pl-4 font-mono text-meta text-muted">{children}</span>
  ) : null;
}

/* ---------------- Dropdown-Menü ---------------- */

export const MenuRoot = RadixDropdownMenu.Root;
export const MenuTrigger = RadixDropdownMenu.Trigger;

export function MenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        // scrollbar → per Tastatur erreichbar (axe: scrollable-region-focusable)
        tabIndex={0}
        // lange Menüs (z. B. Formatieren) passen immer ins Fenster und scrollen in sich
        className={cn(
          contentClasses,
          "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto",
          className,
        )}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
}

export function MenuItem({
  variant,
  shortcut,
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixDropdownMenu.Item> & ItemProps) {
  return (
    <RadixDropdownMenu.Item
      data-variant={variant}
      className={cn(itemClasses, className)}
      {...props}
    >
      {children}
      <Shortcut>{shortcut}</Shortcut>
    </RadixDropdownMenu.Item>
  );
}

/** Umschaltbarer Eintrag (z. B. Filter); Haken rechts, Menü bleibt mit preventDefault offen. */
export function MenuCheckboxItem({
  className,
  children,
  shortcut,
  ...props
}: React.ComponentProps<typeof RadixDropdownMenu.CheckboxItem> & { shortcut?: string }) {
  return (
    <RadixDropdownMenu.CheckboxItem className={cn(itemClasses, "pr-8", className)} {...props}>
      {children}
      <Shortcut>{shortcut}</Shortcut>
      <RadixDropdownMenu.ItemIndicator className="absolute right-2 inline-flex items-center [&_svg]:text-fg">
        <Check aria-hidden />
      </RadixDropdownMenu.ItemIndicator>
    </RadixDropdownMenu.CheckboxItem>
  );
}

export const MenuRadioGroup = RadixDropdownMenu.RadioGroup;

/** Einer aus mehreren (z. B. Sortierung); Punkt rechts. */
export function MenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixDropdownMenu.RadioItem>) {
  return (
    <RadixDropdownMenu.RadioItem className={cn(itemClasses, "pr-8", className)} {...props}>
      {children}
      <RadixDropdownMenu.ItemIndicator className="absolute right-2 inline-flex items-center [&_svg]:text-fg">
        <Dot aria-hidden />
      </RadixDropdownMenu.ItemIndicator>
    </RadixDropdownMenu.RadioItem>
  );
}

/**
 * „Alle auswählen“ / „Alle abwählen“ über einer Liste mit Häkchen (#78) – das Menü bleibt offen,
 * gesperrt ist, was schon gilt.
 */
export function MenuSelectAll({
  all,
  none,
  onAll,
  onNone,
}: {
  all: boolean;
  none: boolean;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <>
      <MenuItem
        disabled={all}
        onSelect={(event) => {
          event.preventDefault();
          onAll();
        }}
      >
        Alle auswählen
      </MenuItem>
      <MenuItem
        disabled={none}
        onSelect={(event) => {
          event.preventDefault();
          onNone();
        }}
      >
        Alle abwählen
      </MenuItem>
      <MenuSeparator />
    </>
  );
}

export function MenuLabel(props: React.ComponentProps<typeof RadixDropdownMenu.Label>) {
  return <RadixDropdownMenu.Label className={labelClasses} {...props} />;
}

export function MenuSeparator() {
  return <RadixDropdownMenu.Separator className={separatorClasses} />;
}

export const MenuSub = RadixDropdownMenu.Sub;

export function MenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixDropdownMenu.SubTrigger>) {
  return (
    <RadixDropdownMenu.SubTrigger
      className={cn(itemClasses, "data-[state=open]:bg-surface-2", className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto" />
    </RadixDropdownMenu.SubTrigger>
  );
}

export function MenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof RadixDropdownMenu.SubContent>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.SubContent
        sideOffset={4}
        collisionPadding={8}
        className={cn(contentClasses, "max-h-[min(60dvh,420px)] overflow-y-auto", className)}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
}

/* ---------------- Kontextmenü (Rechtsklick / langes Drücken) ---------------- */

export const ContextMenuRoot = RadixContextMenu.Root;
export const ContextMenuTrigger = RadixContextMenu.Trigger;

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof RadixContextMenu.Content>) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content
        collisionPadding={8}
        tabIndex={0}
        className={cn(
          contentClasses,
          "max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto",
          className,
        )}
        {...props}
      />
    </RadixContextMenu.Portal>
  );
}

export function ContextMenuItem({
  variant,
  shortcut,
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixContextMenu.Item> & ItemProps) {
  return (
    <RadixContextMenu.Item data-variant={variant} className={cn(itemClasses, className)} {...props}>
      {children}
      <Shortcut>{shortcut}</Shortcut>
    </RadixContextMenu.Item>
  );
}

export function ContextMenuSeparator() {
  return <RadixContextMenu.Separator className={separatorClasses} />;
}

export function ContextMenuLabel(props: React.ComponentProps<typeof RadixContextMenu.Label>) {
  return <RadixContextMenu.Label className={labelClasses} {...props} />;
}

export const ContextMenuSub = RadixContextMenu.Sub;
export const ContextMenuRadioGroup = RadixContextMenu.RadioGroup;

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixContextMenu.SubTrigger>) {
  return (
    <RadixContextMenu.SubTrigger
      className={cn(itemClasses, "data-[state=open]:bg-surface-2", className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto" />
    </RadixContextMenu.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof RadixContextMenu.SubContent>) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.SubContent
        sideOffset={4}
        collisionPadding={8}
        className={cn(contentClasses, className)}
        {...props}
      />
    </RadixContextMenu.Portal>
  );
}

export function ContextMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixContextMenu.RadioItem>) {
  return (
    <RadixContextMenu.RadioItem className={cn(itemClasses, "pr-8", className)} {...props}>
      {children}
      <RadixContextMenu.ItemIndicator className="absolute right-2 inline-flex items-center [&_svg]:text-fg">
        <Dot aria-hidden />
      </RadixContextMenu.ItemIndicator>
    </RadixContextMenu.RadioItem>
  );
}
