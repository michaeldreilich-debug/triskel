"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Aufgabe als Seitenpanel öffnen (wie Notions „Side Peek“): `?aufgabe=<id>` an der aktuellen Seite.
 * So bleibt der Zusammenhang (Heute, Projekt, Datenbank) erhalten, „Zurück“ schließt das Panel.
 */
export const TASK_PARAM = "aufgabe";
/**
 * Panel zum Reiter am rechten Rand eingeklappt (#80). Steht in der Adresse, damit es einen
 * Reiterwechsel übersteht; jedes Öffnen einer Aufgabe (auch derselben) klappt wieder auf.
 */
export const TASK_FOLD_PARAM = "eingeklappt";

export function useTaskPeek() {
  const peek = usePeek(TASK_PARAM, TASK_FOLD_PARAM);
  return useMemo(() => ({ ...peek, taskId: peek.id }), [peek]);
}

/** Wann ein offenes Panel neben dem Inhalt steht (darunter: Sheet bzw. eigene Seite). */
export const PEEK_PANEL_QUERY = "(min-width: 1280px)";

const NONE: readonly string[] = [];

/**
 * Eintrag als Seitenpanel über die Adresse: `param` = ID, `foldParam` = zum Reiter eingeklappt
 * (#80). `clear`: Parameter, die beim Öffnen entfallen (z. B. ein Panel, das sonst davor stünde) –
 * als feste Liste übergeben, damit die Rückgaben stabil bleiben.
 */
export function usePeek(param: string, foldParam: string, clear: readonly string[] = NONE) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = params.get(param);
  const folded = Boolean(id) && params.get(foldParam) === "1";

  const build = useCallback(
    (next: string | null, fold: boolean) => {
      const query = new URLSearchParams(params.toString());
      if (next) {
        query.set(param, next);
        for (const key of clear) query.delete(key);
      } else query.delete(param);
      if (next && fold) query.set(foldParam, "1");
      else query.delete(foldParam);
      const text = query.toString();
      return text ? `${pathname}?${text}` : pathname;
    },
    [params, pathname, param, foldParam, clear],
  );
  const hrefFor = useCallback((next: string | null) => build(next, false), [build]);

  return useMemo(
    () => ({
      id,
      folded,
      hrefFor,
      open: (next: string) => router.push(hrefFor(next), { scroll: false }),
      close: () => router.push(hrefFor(null), { scroll: false }),
      /** ein- bzw. ausklappen ersetzt die Adresse (kein eigener Schritt für „Zurück“) */
      fold: (on: boolean) => {
        if (id) router.replace(build(id, on), { scroll: false });
      },
    }),
    [id, folded, build, hrefFor, router],
  );
}

/**
 * Adresse der Aufgabe als Panel an der Seite, die gerade offen ist – erst beim Klick ausgewertet
 * (Knopf „Öffnen“ in einer Meldung, #75: inzwischen kann eine andere Seite offen sein).
 */
export function taskHrefHere(id: string): string {
  const params = new URLSearchParams(window.location.search);
  params.set(TASK_PARAM, id);
  params.delete(TASK_FOLD_PARAM);
  return `${window.location.pathname}?${params.toString()}`;
}

/** Media-Query im Client (beim Server-Rendern: false). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
