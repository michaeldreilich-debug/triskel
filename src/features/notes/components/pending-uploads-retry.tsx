"use client";

import { useEffect } from "react";
import { toast } from "@/components/ui/toast";
import { useSaveQueue } from "@/lib/save-queue/react";
import { pendingUploads, retryPendingUploads } from "../pending-uploads";

/**
 * Offene Uploads nachholen (Review Teil B, V-1): beim Start der App, bei Netz-Rückkehr und wenn die
 * Seite wieder sichtbar wird. Solange etwas offen ist, zeigt der Speicherstatus „wartet“.
 * Rendert nichts.
 */
export function PendingUploadsRetry() {
  const queue = useSaveQueue();
  useEffect(() => {
    let running = false;
    const token = {};
    const run = async () => {
      if (running) return;
      running = true;
      try {
        const store = pendingUploads();
        if ((await store.list()).length === 0) return;
        queue.markDirty(token, true);
        const result = await retryPendingUploads(store);
        if (result.done.length > 0) {
          toast(
            `${result.done.length} Datei${result.done.length === 1 ? "" : "en"} nachträglich hochgeladen.`,
          );
        }
        for (const entry of result.rejected) {
          toast.error(`„${entry.name}“ hat der Speicher endgültig abgelehnt – bitte neu einfügen.`);
        }
        queue.markDirty(token, result.open.length > 0);
      } catch {
        // nächster Anlass versucht es wieder
      } finally {
        running = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    void run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      queue.markDirty(token, false);
    };
  }, [queue]);
  return null;
}
