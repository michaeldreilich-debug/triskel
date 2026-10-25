"use client";

import { CornerDownLeft, Plus } from "lucide-react";
import { useId, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";

/**
 * #75: Enter legt die Aufgabe an und öffnet sie (Eigenschaften gleich eintragen), ⇧Enter legt nur
 * an – für mehrere hintereinander. null = keine Anlege-Taste.
 */
export function addKeyIntent(event: React.KeyboardEvent): { open: boolean } | null {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return null;
  return { open: !event.shiftKey };
}

/** Hinweis im Feld (Desktop, sobald etwas getippt ist): ⇧↵ legt an, ohne zu öffnen. */
export function KeepClosedHint({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "hidden shrink-0 items-center gap-1 text-meta text-faint md:inline-flex",
        className,
      )}
    >
      <Kbd>⇧</Kbd>
      <Kbd>
        <CornerDownLeft size={12} strokeWidth={1.5} aria-label="Enter" />
      </Kbd>
      ohne Öffnen
    </span>
  );
}

/**
 * Eingabefeld „Neue Aufgabe …“: Enter legt an und öffnet die Aufgabe, ⇧Enter legt nur an; das
 * Feld bleibt für die nächste Eingabe offen.
 */
export function QuickAdd({
  onSubmit,
  placeholder = "Neue Aufgabe …",
  label = "Neue Aufgabe",
  hint,
  className,
}: {
  onSubmit: (text: string, options: { open: boolean }) => void;
  placeholder?: string;
  label?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const submit = (options: { open: boolean }) => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text, options);
    setValue("");
  };
  return (
    <form
      className={cn("flex flex-col gap-1", className)}
      onSubmit={(event) => {
        // Rückweg, falls ein Gerät ohne Tastendruck absendet: wie Enter
        event.preventDefault();
        submit({ open: true });
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex min-h-11 items-center gap-2 rounded-card border border-border bg-surface px-3 transition-colors focus-within:border-muted md:min-h-10">
        <Plus size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
        <input
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            const intent = addKeyIntent(event);
            if (!intent) return;
            event.preventDefault();
            submit(intent);
          }}
          placeholder={placeholder}
          autoComplete="off"
          className="h-11 min-w-0 flex-1 bg-transparent text-body-lg text-fg outline-none placeholder:text-faint md:h-10 md:text-ui"
        />
        {value.trim() ? <KeepClosedHint /> : null}
      </div>
      {hint ? <div className="px-1 text-meta text-faint">{hint}</div> : null}
    </form>
  );
}
