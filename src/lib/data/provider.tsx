"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { newId } from "@/lib/id";
import { SaveQueueProvider } from "@/lib/save-queue/react";
import { type SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import {
  createSupabasePersister,
  isObsoleteRestore,
  isolationOrder,
  isRetryableSaveError,
  type PersisterClient,
  PURGEABLE_TABLES,
  RPC_CLOSE_RECAP,
  RPC_EMPTY_TRASH,
  RPC_NOTE_TYPE,
  RPC_TASK_STATUS,
} from "@/lib/save-queue/supabase-persister";
import { createClient, type Supabase } from "@/lib/supabase/client";

interface DataContextValue {
  userId: string;
  /** Supabase-Client im Browser (erst beim ersten Zugriff erzeugt, nie beim Server-Rendern) */
  getSupabase: () => Supabase;
}

const DataContext = createContext<DataContextValue | null>(null);

/**
 * Schlüssel der lokalen Sicherung je Nutzer – ein anderer Nutzer sieht nie fremde Entwürfe. Jeder
 * Tab spiegelt darunter unter eigener Kennung (`…:tab:<id>`, D-1).
 */
export const queueStorageKey = (userId: string) => `sz:save-queue:${userId}`;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Datenschicht der App (E1, E3): Supabase im Browser, TanStack Query als Cache und eine
 * Speicher-Warteschlange je Nutzer (localStorage-Spiegel, Flush bei pagehide, Retry).
 */
export function DataProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const onPersisted = useRef<(batch: SaveOp[]) => void>(() => {});
  onPersisted.current = (batch) => {
    // Rückverweise entstehen per DB-Trigger erst beim Speichern der Blöcke bzw. der Notiz
    // einer Aufgabe (auch Papierkorb und Zurückholen ändern sie)
    if (
      batch.some(
        (op) =>
          op.table === "note_blocks" ||
          op.table === "notes" ||
          (op.table === "tasks" && ("body" in op.values || "deleted_at" in op.values)),
      )
    ) {
      void queryClient.invalidateQueries({ queryKey: ["backlinks"] });
    }
    // Erledigen/Rückgängig: Folgeinstanz und Zeitstempel kommen vom Server
    if (batch.some((op) => op.table === RPC_TASK_STATUS)) {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
    // Rückblick abgeschlossen: Snapshot und Zeitpunkt kommen vom Server
    if (batch.some((op) => op.table === RPC_CLOSE_RECAP)) {
      void queryClient.invalidateQueries({ queryKey: ["recaps"] });
    }
    // Notiz-Typ gelöscht oder zurückgeholt (#34): Notizen, Vorlagen und Papierkorb ändern sich mit
    if (batch.some((op) => op.table === RPC_NOTE_TYPE)) {
      for (const key of ["note_types", "notes", "templates", "trash"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
    // Papierkorb (B13): Gelöschtes, Zurückgeholtes und endgültig Gelöschtes neu laden. Die Listen
    // laden nur Nicht-Gelöschtes – Zurückgeholtes kommt erst mit dem Neuladen hinein (Cache-
    // Schlüssel = Tabellenname). Endgültiges Löschen ändert per Fremdschlüssel auch andere Zeilen
    // (Meilensteine weg, project_id/topic_id leer).
    const trashOps = batch.filter(
      (op) =>
        op.table === RPC_EMPTY_TRASH ||
        ((PURGEABLE_TABLES as readonly string[]).includes(op.table) && "deleted_at" in op.values),
    );
    if (trashOps.length > 0) void queryClient.invalidateQueries({ queryKey: ["trash"] });
    const reload = new Set(
      trashOps
        .filter((op) => op.mode === "update" && op.values.deleted_at === null)
        .map((op) => op.table),
    );
    if (trashOps.some((op) => op.table === RPC_EMPTY_TRASH)) {
      for (const key of [
        "tasks",
        "task_dependencies",
        "notes",
        "projects",
        "milestones",
        "topics",
      ]) {
        reload.add(key);
      }
      void queryClient.invalidateQueries({ queryKey: ["backlinks"] });
    }
    for (const key of reload) void queryClient.invalidateQueries({ queryKey: [key] });
  };

  const [value] = useState(() => {
    let client: Supabase | null = null;
    const getSupabase = () => {
      client ??= createClient();
      return client;
    };
    const queue = new SaveQueue({
      persist: createSupabasePersister(() => getSupabase() as unknown as PersisterClient, {
        onPersisted: (batch) => onPersisted.current(batch),
      }),
      storage: browserStorage(),
      storageKey: queueStorageKey(userId),
      // je Seitenaufruf neu: übernommen wird nur, was ein geschlossener oder verwaister Tab hinterließ
      tabId: newId(),
      isRetryable: isRetryableSaveError,
      // Zurückholen (⌘Z, Papierkorb) von etwas, das es nicht mehr gibt – z. B. eben endgültig
      // gelöscht: kein Dauerfehler, die Liste lädt neu und zeigt es nicht mehr (D-9)
      isObsolete: isObsoleteRestore,
      // nach einem dauerhaften Fehler einzeln in der Reihenfolge des Persisters senden (D-10)
      order: isolationOrder,
      onObsolete: (op) => {
        void queryClient.invalidateQueries({ queryKey: [op.table] });
        void queryClient.invalidateQueries({ queryKey: ["trash"] });
        toast("Nicht zurückgeholt – das wurde schon endgültig gelöscht.", {
          id: "save-queue-obsolete",
        });
      },
      isOnline: () => typeof navigator === "undefined" || navigator.onLine,
    });
    return { context: { userId, getSupabase }, queue };
  });

  return (
    <DataContext value={value.context}>
      <SaveQueueProvider
        queue={value.queue}
        onRestore={(count) =>
          toast(
            `${count} ungespeicherte Änderung${count === 1 ? "" : "en"} aus der letzten Sitzung wiederhergestellt – wird gespeichert.`,
            { id: "save-queue-restored" },
          )
        }
      >
        {children}
      </SaveQueueProvider>
    </DataContext>
  );
}

function useDataContext(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) throw new Error("Datenzugriff braucht einen DataProvider.");
  return context;
}

/** Supabase-Client (Getter – nur in Effekten, Handlern und queryFn aufrufen). */
export function useSupabase(): () => Supabase {
  return useDataContext().getSupabase;
}

export function useUserId(): string {
  return useDataContext().userId;
}
