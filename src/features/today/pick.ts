"use client";

import { useMemo } from "react";
import { notifyWithUndo, toast } from "@/components/ui/toast";
import { useTaskActions } from "@/features/tasks/api";
import { usePeek } from "@/features/tasks/peek";
import { isForMe, type TaskRow, taskTitle } from "@/features/tasks/types";
import { FOCUS_LIMIT, type TodayData } from "./select";

/**
 * Aufgabenspalte zum Wählen (#90): `?waehlen=morgen|heute` an /heute – „Andere Aufgabe wählen“
 * (Abendplanung, Fokus morgen) bzw. „Fokus wählen“ (Fokus heute) öffnen sie rechts im
 * Panel-Platz; `waehlen-zu=1` = zum Reiter eingeklappt (#80). „Zurück“ schließt sie.
 */
export const PICK_PARAM = "waehlen";
export const PICK_FOLD_PARAM = "waehlen-zu";
export type PickTarget = "morgen" | "heute";

export function usePick() {
  const peek = usePeek(PICK_PARAM, PICK_FOLD_PARAM);
  const target: PickTarget | null = peek.id === "morgen" || peek.id === "heute" ? peek.id : null;
  return useMemo(
    () => ({
      target,
      folded: target !== null && peek.folded,
      open: (next: PickTarget) => peek.open(next),
      close: peek.close,
      fold: peek.fold,
    }),
    [target, peek],
  );
}

/** Wie viele Plätze hat der Tag, und was spricht gegen diese Aufgabe? Ein Ort für Zeile, Klick und Ziehen. */
export function useFocusPlacement(data: TodayData) {
  const actions = useTaskActions();
  return useMemo(() => {
    const count = (target: PickTarget) =>
      target === "heute" ? data.focus.length : data.planned.length;
    const day = (target: PickTarget) => (target === "heute" ? data.today : data.tomorrow);
    const full = (target: PickTarget) => count(target) >= FOCUS_LIMIT;
    /** null = geht; sonst der Hinweis, warum nicht */
    const problem = (task: TaskRow, target: PickTarget): string | null => {
      if (task.status === "erledigt") return "Erledigte Aufgaben kommen nicht in den Fokus.";
      if (!isForMe(task)) return "KI-Arbeitsschritte kommen nicht in den Fokus.";
      if (task.focus_date === day(target)) {
        return target === "heute" ? "Schon im Fokus von heute." : "Schon für morgen gewählt.";
      }
      if (full(target)) {
        return target === "heute"
          ? `Fokus heute ist voll – höchstens ${FOCUS_LIMIT}.`
          : `Morgen ist voll – höchstens ${FOCUS_LIMIT}. Erst eine herausnehmen.`;
      }
      return null;
    };
    /** Aufgabe in den Fokus des Tages legen; bei einem Hindernis Hinweis statt Änderung – mit Rückgängig (U-7) */
    const place = (task: TaskRow, target: PickTarget): boolean => {
      const why = problem(task, target);
      if (why) {
        toast(why);
        return false;
      }
      const before = task.focus_date;
      actions.setFocus(task.id, day(target));
      notifyWithUndo(
        target === "heute"
          ? `„${taskTitle(task)}“ im Fokus heute`
          : `„${taskTitle(task)}“ für morgen gewählt`,
        () => actions.setFocus(task.id, before),
      );
      return true;
    };
    return { count, full, problem, place };
  }, [data, actions]);
}
