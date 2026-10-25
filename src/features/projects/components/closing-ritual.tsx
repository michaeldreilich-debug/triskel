"use client";

import { Archive, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { formatListDate } from "@/lib/dates";
import type { ClosingReflection, ProjectRow } from "../types";

const QUESTIONS: Array<{ key: keyof ClosingReflection; label: string; hint: string }> = [
  {
    key: "worked",
    label: "Was hat geklappt?",
    hint: "Worauf bist du stolz, was würdest du wieder so machen?",
  },
  { key: "takeaway", label: "Was nehme ich mit?", hint: "Erkenntnisse für das nächste Projekt." },
  {
    key: "open",
    label: "Was blieb offen?",
    hint: "Unerledigtes, Ideen, Fragen – bewusst loslassen oder übergeben.",
  },
];

/**
 * Abschluss-Ritual (Brief, Fokus-Regel 6): drei Fragen, dann ins Archiv. Antworten werden beim
 * Tippen gespeichert (Entwurf), „Abschließen“ setzt den Status auf Archiv.
 */
export function ClosingRitual({
  project,
  openCount,
  onSave,
  onClose,
  onReopen,
}: {
  project: ProjectRow;
  openCount: number;
  onSave: (reflection: ClosingReflection) => void;
  onClose: (reflection: ClosingReflection) => void;
  onReopen: () => void;
}) {
  const baseId = useId();
  const [answers, setAnswers] = useState<ClosingReflection>(
    project.closing_reflection ?? { worked: "", takeaway: "", open: "" },
  );
  const archived = project.status === "archiv";
  const complete = QUESTIONS.every((q) => answers[q.key].trim() !== "");

  const change = (key: keyof ClosingReflection, value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    onSave(next);
  };

  return (
    <section aria-label="Abschluss-Ritual" className="flex max-w-page flex-col gap-6">
      {archived ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border px-4 py-3">
          <p className="text-ui">
            Abgeschlossen und archiviert
            <span className="text-faint"> · {formatListDate(project.updated_at)}</span>
          </p>
          <Button size="sm" variant="ghost" onClick={onReopen}>
            <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
            Wieder aktivieren
          </Button>
        </div>
      ) : (
        <p className="text-ui text-muted">
          Drei Fragen, dann kommt das Projekt ins Archiv.
          {openCount > 0
            ? ` ${openCount === 1 ? "Eine offene Aufgabe bleibt" : `${openCount} offene Aufgaben bleiben`} im Projekt erhalten.`
            : ""}
        </p>
      )}
      {QUESTIONS.map((q) => (
        <div key={q.key} className="flex flex-col gap-1.5">
          <label htmlFor={`${baseId}-${q.key}`} className="heading text-heading">
            {q.label}
          </label>
          <p className="text-ui-sm text-faint">{q.hint}</p>
          <Textarea
            id={`${baseId}-${q.key}`}
            value={answers[q.key]}
            onChange={(event) => change(q.key, event.target.value)}
            className="[field-sizing:content]"
          />
        </div>
      ))}
      {archived ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!complete} onClick={() => onClose(answers)}>
            <Archive size={16} strokeWidth={1.5} aria-hidden />
            Abschließen und archivieren
          </Button>
          {!complete ? (
            <p className="text-ui-sm text-faint">Erst alle drei Fragen beantworten.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
