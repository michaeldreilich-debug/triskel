import { forwardRef } from "react";
import { cn } from "@/lib/cn";

// 16 px auf Mobil verhindert das automatische Hineinzoomen von iOS Safari
export const controlClasses = cn(
  "w-full rounded-control border border-border bg-surface px-3 text-body-lg text-fg md:text-ui",
  "placeholder:text-faint transition-colors",
  "hover:border-faint/60 focus-visible:border-muted focus-visible:outline-none",
  "aria-invalid:border-danger disabled:opacity-50",
);

/**
 * Ruhige Variante für Eigenschaften (Notion-artig): sieht aus wie ein Wert, zeigt die
 * Bedienbarkeit erst bei Hover/Fokus. Gleiche Größen wie controlClasses (44 px Touch-Ziel mobil).
 */
export const quietControlClasses = cn(
  "w-auto max-w-full rounded-control border border-transparent bg-transparent px-2 text-body-lg text-fg md:text-ui",
  "transition-colors hover:bg-surface-2 focus-visible:border-border-strong focus-visible:outline-none",
  "data-[state=open]:bg-surface-2 disabled:opacity-50",
);

/** Auswahl als Überschrift (z. B. Themen-Wechsel über der Notizliste): ruhig, Pfeil immer sichtbar. */
export const titleControlClasses = cn(
  "heading w-auto min-w-0 max-w-full rounded-control border border-transparent bg-transparent px-2 text-heading text-fg",
  "transition-colors hover:bg-surface-2 focus-visible:border-border-strong focus-visible:outline-none",
  "data-[state=open]:bg-surface-2 disabled:opacity-50",
);

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlClasses, "h-11 md:h-9", className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(controlClasses, "min-h-24 py-2", className)} {...props} />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor wird vom Aufrufer gesetzt
  return <label className={cn("text-ui-sm font-medium text-muted", className)} {...props} />;
}

export function FieldHint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-meta text-faint", className)} {...props} />;
}

export function FieldError({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p role="alert" className={cn("text-ui-sm text-danger", className)} {...props} />;
}
