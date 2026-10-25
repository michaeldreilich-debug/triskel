"use client";

import { createContext, useContext, useState } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import { applyTheme, type Theme } from "./theme";
import {
  AREA_COOKIE,
  FONT_COOKIE,
  type FontSize,
  NOTE_SORT_COOKIE,
  type NoteSort,
  SIDEBAR_COOKIE,
  type UiPrefs,
  writePrefCookie,
} from "./ui-prefs";

export interface UiState extends UiPrefs {
  commandOpen: boolean;
  /** Sheet „Festhalten“ (＋ in der Handy-Leiste, E44 H3) */
  captureOpen: boolean;
  mobileNavOpen: boolean;
  /** Legende der Farben und Symbole (#25) */
  legendOpen: boolean;
  /** Ganze Breite (#31): offene Aufgabe bzw. Notiz/Projekt über die ganze Breite */
  wide: "task" | "page" | null;
  setTheme: (theme: Theme) => void;
  setArea: (area: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setNoteSort: (sort: NoteSort) => void;
  setFontSize: (size: FontSize) => void;
  setCommandOpen: (open: boolean) => void;
  setCaptureOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setLegendOpen: (open: boolean) => void;
  setWide: (wide: "task" | "page" | null) => void;
}

export function createUiStore(initial: UiPrefs): StoreApi<UiState> {
  return createStore<UiState>()((set, get) => ({
    ...initial,
    commandOpen: false,
    captureOpen: false,
    mobileNavOpen: false,
    legendOpen: false,
    wide: null,
    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme, stored: { ...get().stored, theme: true } });
    },
    setArea: (area) => {
      writePrefCookie(AREA_COOKIE, area ?? "");
      set({ area, stored: { ...get().stored, area: true } });
    },
    setSidebarCollapsed: (collapsed) => {
      writePrefCookie(SIDEBAR_COOKIE, collapsed ? "1" : "0");
      set({ sidebarCollapsed: collapsed });
    },
    toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
    setNoteSort: (noteSort) => {
      writePrefCookie(NOTE_SORT_COOKIE, noteSort);
      set({ noteSort });
    },
    setFontSize: (fontSize) => {
      document.documentElement.dataset.font = fontSize;
      writePrefCookie(FONT_COOKIE, fontSize);
      set({ fontSize });
    },
    setCommandOpen: (open) => set({ commandOpen: open }),
    setCaptureOpen: (open) => set({ captureOpen: open }),
    setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
    setLegendOpen: (open) => set({ legendOpen: open }),
    setWide: (wide) => set({ wide }),
  }));
}

const UiStoreContext = createContext<StoreApi<UiState> | null>(null);

export function UiStoreProvider({
  initial,
  children,
}: {
  initial: UiPrefs;
  children: React.ReactNode;
}) {
  const [store] = useState(() => createUiStore(initial));
  return <UiStoreContext value={store}>{children}</UiStoreContext>;
}

/** Direkter Zugriff auf den Store (z. B. aktueller Zustand in Event-Handlern). */
export function useUiStoreApi(): StoreApi<UiState> {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error("useUi braucht einen UiStoreProvider.");
  return store;
}

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(useUiStoreApi(), selector);
}
