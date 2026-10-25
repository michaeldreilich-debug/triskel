"use client";

import { LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type TemplateRow, templateName } from "../types";

/**
 * Vorlagen zum Anwenden auf einer leeren Seite (B11): leise Knöpfe ohne Rahmen (Muster 8), einen
 * Klick entfernt. Verschwindet, sobald die Seite Inhalt hat.
 */
export function TemplateChips({
  templates,
  onApply,
  label = "Vorlage",
}: {
  templates: TemplateRow[];
  onApply: (template: TemplateRow) => void;
  label?: string;
}) {
  if (templates.length === 0) return null;
  return (
    <fieldset
      aria-label="Vorlagen"
      className="-ml-2 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-ui-sm"
    >
      <span className="flex items-center gap-1.5 px-2 text-faint">
        <LayoutTemplate size={14} strokeWidth={1.5} aria-hidden />
        {label}:
      </span>
      {templates.map((template) => (
        <Button
          key={template.id}
          variant="ghost"
          size="sm"
          onClick={() => onApply(template)}
          aria-label={`Vorlage „${templateName(template)}“ anwenden`}
        >
          {templateName(template)}
        </Button>
      ))}
    </fieldset>
  );
}
