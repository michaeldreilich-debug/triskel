"use client";

import { TagEditor } from "@/features/notes/components/tag-editor";
import { useRecapActions, useRecaps } from "../api";
import { answerOf, groupBySection, previousHints, previousRecap } from "../model";
import type { RecapQuestion, RecapRow } from "../types";
import { QuestionField } from "./question-field";

/**
 * Leitfragen eines Rückblicks als Felder, auf Wunsch mit „Themen und Muster“ – dieselben Felder
 * auf der Rückblick-Seite und im geführten Wochenreview (S1c).
 */
export function ReflectionFields({
  recap,
  questions,
  themes = true,
}: {
  recap: RecapRow;
  questions: RecapQuestion[];
  themes?: boolean;
}) {
  const actions = useRecapActions();
  const fields = (list: RecapQuestion[]) =>
    list.map((question) => (
      <div key={question.key} className="flex min-w-0 flex-col gap-2">
        <QuestionField
          question={question}
          value={answerOf(recap, question)}
          onChange={(next) => actions.answer(recap.id, question, next)}
        />
        {question.key === "last_week" ? <PreviousHints recap={recap} /> : null}
      </div>
    ));
  return (
    <div className="flex flex-col gap-6">
      {groupBySection(questions).map((group, index) =>
        group.section ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: Reihenfolge der Abschnitte ist fest
            key={`${group.section}-${index}`}
            className="flex min-w-0 flex-col gap-6 border-t border-border pt-5"
          >
            <h3 className="heading text-body-lg/snug">{group.section}</h3>
            {fields(group.questions)}
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: Reihenfolge der Abschnitte ist fest
          <div key={`plain-${index}`} className="flex flex-col gap-6">
            {fields(group.questions)}
          </div>
        ),
      )}
      {themes ? (
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={`themen-${recap.id}`} className="text-ui font-medium">
            Themen und Muster
          </label>
          <div className="-mx-2">
            <TagEditor
              id={`themen-${recap.id}`}
              tags={recap.themes}
              onChange={(next) => actions.update(recap.id, { themes: next })}
            />
          </div>
          <p className="text-meta text-faint">
            Was kehrt wieder? Als Tags, damit es über die Wochen sichtbar wird.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Zum Nachlesen beim „Bezug zur Vorwoche“: Fokus und Mitnehmen des Rückblicks davor, eingeklappt. */
function PreviousHints({ recap }: { recap: RecapRow }) {
  const recaps = useRecaps();
  const hints = previousHints(previousRecap(recaps.data ?? [], recap));
  if (!hints) return null;
  const month = recap.kind === "monat";
  return (
    <details data-testid="previous-hints" className="group text-ui-sm text-muted">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-faint hover:text-fg md:min-h-0">
        {month ? "Zum Nachlesen: Vormonat" : "Zum Nachlesen: Vorwoche"}
      </summary>
      <div className="mt-1 flex flex-col gap-2 border-l border-border pl-3">
        {hints.focus.length ? (
          <div>
            <p className="text-meta text-faint">Fokus</p>
            <ul className="list-disc pl-4">
              {hints.focus.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {hints.takeaway ? (
          <div>
            <p className="text-meta text-faint">Mitnehmen</p>
            <p className="whitespace-pre-wrap">{hints.takeaway}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
