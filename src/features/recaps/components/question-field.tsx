"use client";

import { useId } from "react";
import { useBufferedText } from "@/components/ui/buffered";
import { BufferedInput } from "@/components/ui/buffered-input";
import { controlClasses } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { AnswerValue } from "../model";
import type { RecapQuestion } from "../types";

const SCALE = [1, 2, 3, 4, 5] as const;

/**
 * Eine Leitfrage des Rückblicks: Skala 1–5 (nochmal tippen = leeren), Text, Zahl oder Liste.
 * Texte laufen über den Eingabe-Puffer (useBufferedText), jede Änderung geht sofort in die
 * Speicher-Warteschlange.
 */
export function QuestionField({
  question,
  value,
  onChange,
}: {
  question: RecapQuestion;
  value: AnswerValue;
  onChange: (next: (current: AnswerValue) => AnswerValue) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const label = (
    <span id={labelId} className="text-ui font-medium">
      {question.label}
    </span>
  );

  if (question.type === "scale") {
    const current = typeof value === "number" ? value : null;
    return (
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-ui font-medium">{question.label}</legend>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {SCALE.map((n) => (
              <label key={n} className="relative">
                <input
                  type="radio"
                  name={id}
                  value={n}
                  checked={current === n}
                  onChange={() => onChange(() => n)}
                  onClick={() => {
                    if (current === n) onChange(() => null);
                  }}
                  aria-label={`${n} von 5`}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "grid size-11 cursor-pointer place-items-center rounded-control border text-ui tabular-nums transition-colors md:size-9",
                    "peer-focus-visible:ring-2 peer-focus-visible:ring-muted",
                    current === n
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-border text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {n}
                </span>
              </label>
            ))}
          </div>
          <span className="hidden text-meta text-faint sm:inline">1 schwach · 5 sehr gut</span>
        </div>
      </fieldset>
    );
  }

  if (question.type === "number") {
    const current = typeof value === "number" ? String(value).replace(".", ",") : "";
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor={id}>{label}</label>
        <div className="w-32">
          <BufferedInput
            id={id}
            inputMode="decimal"
            value={current}
            onValueChange={(raw) => {
              const text = raw.trim().replace(",", ".");
              if (text === "") return onChange(() => null);
              const n = Number(text);
              if (Number.isFinite(n) && n >= 0 && n < 10_000)
                onChange(() => Math.round(n * 10) / 10);
            }}
            placeholder="z. B. 3"
            className={cn(controlClasses, "h-11 md:h-9")}
          />
        </div>
      </div>
    );
  }

  if (question.type === "list") {
    const items = Array.isArray(value) ? value : [];
    const count = question.count ?? 3;
    return (
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-ui font-medium">{question.label}</legend>
        <ol className="flex flex-col gap-2">
          {Array.from({ length: count }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: feste Plätze, Reihenfolge zählt
            <li key={i} className="flex items-center gap-2.5">
              <span className="w-4 text-ui-sm font-semibold text-muted tabular-nums">{i + 1}</span>
              <BufferedInput
                value={items[i] ?? ""}
                aria-label={`${question.label}, Punkt ${i + 1}`}
                onValueChange={(text) =>
                  onChange((latest) => {
                    const next = Array.isArray(latest) ? [...latest] : [];
                    while (next.length < count) next.push("");
                    next[i] = text;
                    // leere Plätze am Ende nicht speichern
                    while (next.length > 0 && !next[next.length - 1]?.trim()) next.pop();
                    return next.slice(0, count);
                  })
                }
                className={cn(controlClasses, "h-11 md:h-9")}
              />
            </li>
          ))}
        </ol>
      </fieldset>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id}>{label}</label>
      <TextAnswer id={id} value={typeof value === "string" ? value : ""} onChange={onChange} />
    </div>
  );
}

function TextAnswer({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: (current: AnswerValue) => AnswerValue) => void;
}) {
  const field = useBufferedText(value, (text) => onChange(() => text));
  return (
    <textarea
      id={id}
      value={field.value}
      onChange={field.onChange}
      onFocus={field.onFocus}
      onBlur={field.onBlur}
      rows={2}
      className={cn(
        controlClasses,
        "field-sizing-content min-h-20 resize-none py-2 leading-relaxed",
      )}
    />
  );
}
