"use client";

import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Beim Öffnen einer Detailansicht einmal frisch laden (D-7): Erst danach hängt ein Editor ein,
 * der die ganze Spalte schreibt (Aufgaben-Notiz, Projekt-Freitext) – sonst schickte der erste
 * Tastendruck einen veralteten Stand (z. B. ohne das PDF, das die KI eben angehängt hat).
 * Offline bzw. bei langsamem Netz nach `timeoutMs` mit dem bekannten Stand weiter.
 */
/**
 * Zurück am Fenster (Fokus, wieder sichtbar, Netz wieder da): frisch laden, solange lokal nichts
 * ungespeichert ist (V-2/V-6) – unabhängig von `staleTime`. Ein offener Editor übernimmt den
 * neuen Stand dann wie bei D-7; tippt der Nutzer gerade (`isDirty`), bleibt sein Stand unangetastet.
 */
export function useRefreshOnReturn(queryKey: QueryKey, isDirty: () => boolean): void {
  const queryClient = useQueryClient();
  // biome-ignore lint/correctness/useExhaustiveDependencies: der Schlüssel ist als Text stabil
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      if (document.visibilityState === "hidden" || isDirty()) return;
      void queryClient.refetchQueries({ queryKey, type: "active" }).catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queryClient, JSON.stringify(queryKey)]);
}

export function useFreshOnOpen(queryKey: QueryKey, id: string, timeoutMs = 2000): boolean {
  const queryClient = useQueryClient();
  const [fresh, setFresh] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: je geöffnetem Datensatz einmal
  useEffect(() => {
    let done = false;
    setFresh(false);
    const finish = () => {
      if (done) return;
      done = true;
      setFresh(true);
    };
    const timer = setTimeout(finish, timeoutMs);
    void queryClient
      .refetchQueries({ queryKey, type: "active" })
      .catch(() => {})
      .finally(finish);
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [queryClient, id, timeoutMs]);
  return fresh;
}
