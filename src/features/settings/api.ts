"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useSupabase } from "@/lib/data/provider";
import { overlayUnconfirmed } from "@/lib/data/unconfirmed";
import { useSaveQueue } from "@/lib/save-queue/react";
import { parseTheme, type Theme } from "@/lib/theme";
import { useUiStoreApi } from "@/lib/ui-store";
import { readPendingSettings, writePendingSettings } from "./pending";

export const settingsKey = ["user_settings"] as const;

export interface UserSettings {
  id: string;
  theme: Theme;
  active_area_id: string | null;
  evening_time: string;
  /** letzter Markdown-Export (B14) */
  last_export_at: string | null;
  /** letzte nächtliche Sicherung (E32, schreibt nur das Skript auf dem Mac) */
  last_backup_at: string | null;
  last_backup_summary: unknown;
}

export function useUserSettings() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: settingsKey,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<UserSettings | null> => {
      const { data, error } = await getSupabase()
        .from("user_settings")
        .select(
          "id, theme, active_area_id, evening_time, last_export_at, last_backup_at, last_backup_summary",
        )
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const [row] = overlayUnconfirmed(queue, "user_settings", [data], { dropDeleted: false });
      return { ...(row ?? data), theme: parseTheme(row?.theme ?? data.theme) };
    },
  });
}

/**
 * Theme und Bereich zusätzlich in user_settings speichern (Plan A2, Schritt 3).
 * - Cookie = Gerätewert, damit der Server ohne Aufblitzen rendert.
 * - Hat dieses Gerät noch keinen Wert gewählt (kein Cookie), wird der gespeicherte Wert aus
 *   user_settings übernommen (neues Gerät, neuer Browser).
 * - Jede Änderung durch den Nutzer geht über die Speicher-Warteschlange nach user_settings.
 */
export function SettingsSync() {
  const store = useUiStoreApi();
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  const settings = useUserSettings();
  const settingsRef = useRef<UserSettings | null>(null);
  const applying = useRef(false);
  const adopted = useRef(false);
  /** Änderungen, bevor die Einstellungen geladen waren */
  const early = useRef<Partial<Pick<UserSettings, "theme" | "active_area_id">>>({});

  useEffect(() => {
    const save = (values: Partial<Pick<UserSettings, "theme" | "active_area_id">>) => {
      const current = settingsRef.current;
      if (!current) {
        // noch keine Zeilen-ID: merken – auch über ein Neuladen hinweg (localStorage, N4)
        Object.assign(early.current, values);
        writePendingSettings(early.current);
        return;
      }
      queue.enqueue({ table: "user_settings", id: current.id, mode: "update", values });
      const next = { ...current, ...values };
      settingsRef.current = next;
      queryClient.setQueryData(settingsKey, next);
    };
    return store.subscribe((state, previous) => {
      if (applying.current) return;
      const values: Partial<Pick<UserSettings, "theme" | "active_area_id">> = {};
      if (state.theme !== previous.theme) values.theme = state.theme;
      if (state.area !== previous.area) values.active_area_id = state.area;
      if (Object.keys(values).length > 0) save(values);
    });
  }, [store, queue, queryClient]);

  useEffect(() => {
    const data = settings.data;
    if (!data) return;
    settingsRef.current = data;
    if (adopted.current) return;
    adopted.current = true;

    const state = store.getState();
    // vor dem Laden gewählt – auf dieser Seite oder vor einem Neuladen (N4)
    const changed = { ...readPendingSettings(), ...early.current };
    applying.current = true;
    try {
      if (changed.theme === undefined && !state.stored.theme && data.theme !== state.theme) {
        state.setTheme(data.theme);
      }
      if (
        changed.active_area_id === undefined &&
        !state.stored.area &&
        data.active_area_id &&
        data.active_area_id !== state.area
      ) {
        state.setArea(data.active_area_id);
      }
    } finally {
      applying.current = false;
    }
    if (Object.keys(changed).length > 0) {
      queue.enqueue({ table: "user_settings", id: data.id, mode: "update", values: changed });
      early.current = {};
      writePendingSettings({});
    }
  }, [settings.data, store, queue]);

  return null;
}

/** Einstellungen ändern (B11, z. B. die Abendzeit) – optimistisch über die Warteschlange. */
export function useSettingsActions() {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      update(values: Partial<Pick<UserSettings, "evening_time" | "last_export_at">>) {
        const current = queryClient.getQueryData<UserSettings | null>(settingsKey);
        if (!current) return;
        queryClient.setQueryData(settingsKey, { ...current, ...values });
        queue.enqueue({ table: "user_settings", id: current.id, mode: "update", values });
      },
    }),
    [queue, queryClient],
  );
}
