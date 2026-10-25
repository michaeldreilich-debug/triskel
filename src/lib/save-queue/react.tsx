"use client";

import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { attachSaveQueueLifecycle, type SaveQueue, type SaveQueueSnapshot } from "./save-queue";

const SaveQueueContext = createContext<SaveQueue | null>(null);

const SERVER_SNAPSHOT: SaveQueueSnapshot = {
  status: "idle",
  pending: 0,
  failed: 0,
  attempts: 0,
  lastError: null,
  lastSavedAt: null,
  storageError: false,
};

/** Stellt eine Warteschlange bereit, holt Unbestätigtes nach und speichert beim Verlassen der Seite. */
export function SaveQueueProvider({
  queue,
  onRestore,
  children,
}: {
  queue: SaveQueue;
  /** Anzahl der aus der letzten Sitzung übernommenen, noch ungespeicherten Änderungen */
  onRestore?: (count: number) => void;
  children: React.ReactNode;
}) {
  const restoreCallback = useRef(onRestore);
  restoreCallback.current = onRestore;
  useEffect(() => {
    void queue.restore().then((count) => {
      if (count > 0) restoreCallback.current?.(count);
    });
    return attachSaveQueueLifecycle(queue, window, document);
  }, [queue]);
  return <SaveQueueContext value={queue}>{children}</SaveQueueContext>;
}

export function useSaveQueue(): SaveQueue {
  const queue = useContext(SaveQueueContext);
  if (!queue) throw new Error("useSaveQueue braucht einen SaveQueueProvider.");
  return queue;
}

/** Status einer Warteschlange abonnieren (z. B. `useSaveStatus(useSaveQueue())`). */
export function useSaveStatus(queue: SaveQueue): SaveQueueSnapshot {
  return useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => SERVER_SNAPSHOT);
}
