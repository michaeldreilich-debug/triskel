"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import { toast } from "@/components/ui/toast";
import { appPath } from "@/lib/app-links";
import { newId } from "@/lib/id";
import {
  activateTab,
  closeTab,
  describeHref,
  followHref,
  HOME_HREF,
  MAX_TABS,
  moveTab,
  normalizeHref,
  openTab,
  restoreTabs,
  sameHref,
  saveScroll,
  serializeTabs,
  setTitle,
  stepTab,
  TABS_KEY,
  type TabScroll,
  type TabsState,
} from "./model";
import { captureScroll, restoreScroll } from "./scroll";

/**
 * Reiter (#63, E36 Variante 1): Liste der offenen Seiten je Fenster. Der aktive Reiter folgt der
 * Adresse – ein Klick in der Seitenleiste oder auf einen Link öffnet also im aktuellen Reiter
 * (Browser-Gefühl); ⌘-Klick oder Mittelklick auf einen App-Link öffnet einen neuen App-Reiter
 * (⌘⇧-Klick lässt weiter den Browser einen Tab öffnen). Wechsel = Adresse des Reiters laden und
 * seine Scroll-Stelle setzen, sobald die Seite geladen ist; keine Seiten im Hintergrund.
 *
 * Speicher: sessionStorage je Fenster (übersteht Neuladen) und localStorage als Stand für neue
 * Fenster. Das `storage`-Ereignis anderer Fenster wird bewusst nicht übernommen: Jedes Fenster
 * führt seine eigene Liste; übernähme es fremde Änderungen, schöben sich zwei Fenster gegenseitig
 * Seiten unter (Flackern, Schreib-Schleife). Letzter Schreiber gewinnt nur für neue Fenster.
 */

interface TabsStoreState {
  /** null, bis die Liste nach dem Einhängen gelesen ist */
  state: TabsState | null;
}

export interface TabActions {
  switchTo: (id: string) => void;
  /** App-Adresse in einem neuen Reiter öffnen (wird aktiv) */
  open: (href: string) => void;
  /** „＋ Neuer Reiter“: Heute */
  openNew: () => void;
  close: (id: string) => void;
  /** aktiven Reiter schließen (⌘K) */
  closeActive: () => void;
  /** nächster (1) bzw. vorheriger (-1) Reiter */
  step: (dir: 1 | -1) => void;
  move: (id: string, toIndex: number) => void;
  rename: (id: string, title: string) => void;
}

interface TabsContextValue {
  store: StoreApi<TabsStoreState>;
  actions: TabActions;
}

const TabsContext = createContext<TabsContextValue | null>(null);

/** Liste der Reiter (null vor dem Lesen bzw. ohne Reiter, z. B. auf Entwicklerseiten). */
export function useTabsState(): TabsState | null {
  const ctx = useContext(TabsContext);
  const fallback = useState(() => createStore<TabsStoreState>()(() => ({ state: null })))[0];
  return useStore(ctx?.store ?? fallback, (s) => s.state);
}

/** Aktionen der Reiter; null außerhalb der App (Entwicklerseiten). */
export function useTabActions(): TabActions | null {
  return useContext(TabsContext)?.actions ?? null;
}

/**
 * „In neuem Reiter öffnen“ für Menüs (Rechtsklick, am Handy langes Drücken bzw. ⋯) – der Weg
 * ohne ⌘-Klick. null außerhalb der App: dann den Eintrag weglassen.
 */
export function useOpenInNewTab(): ((href: string) => void) | null {
  return useContext(TabsContext)?.actions.open ?? null;
}

/** Beschriftung des Menüeintrags (überall gleich). */
export const OPEN_IN_NEW_TAB = "In neuem Reiter öffnen";

const here = () =>
  normalizeHref(`${window.location.pathname}${window.location.search}${window.location.hash}`);

/** Scroll-Stelle des aktiven Reiters merken – nur, wenn wirklich seine Seite zu sehen ist. */
function rememberScroll(state: TabsState): TabsState {
  const active = state.tabs.find((t) => t.id === state.activeId);
  const current = here();
  if (!active || !current || !sameHref(active.href, current)) return state;
  return saveScroll(state, active.id, captureScroll());
}

function persist(state: TabsState) {
  const raw = serializeTabs(state);
  try {
    window.sessionStorage.setItem(TABS_KEY, raw);
  } catch {
    // kein Speicher (privates Fenster): Reiter gelten nur bis zum Neuladen
  }
  try {
    window.localStorage.setItem(TABS_KEY, raw);
  } catch {
    // nur Bequemlichkeit
  }
}

function readStored(storage: () => Storage): string | null {
  try {
    return storage().getItem(TABS_KEY);
  } catch {
    return null;
  }
}

const tabLabel = (tab: { title: string; href: string }) =>
  tab.title || describeHref(tab.href).label;

/** Neuer App-Reiter statt Browser-Tab: ⌘-/Strg-Klick oder Mittelklick, ohne ⇧ und ⌥. */
function newTabHref(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.shiftKey || event.altKey) return null;
  const middle = event.type === "auxclick" && event.button === 1;
  const modified = event.type === "click" && event.button === 0 && (event.metaKey || event.ctrlKey);
  if (!middle && !modified) return null;
  const target = event.target instanceof Element ? event.target : null;
  // [[Notiz-Links]] im Editor sind keine <a>, öffnen aber genauso
  const noteLink = target?.closest<HTMLElement>('[data-type="note-link"][data-note-id]');
  if (noteLink?.dataset.noteId) return normalizeHref(appPath.note(noteLink.dataset.noteId));
  const link = target?.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return null;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  return normalizeHref(`${url.pathname}${url.search}${url.hash}`);
}

const POPSTATE_WINDOW_MS = 2000;

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [store] = useState(() => createStore<TabsStoreState>()(() => ({ state: null })));
  const cancelRestore = useRef<(() => void) | null>(null);
  const poppedAt = useRef(0);

  const actions = useMemo<TabActions>(() => {
    const get = () => store.getState().state;
    const set = (state: TabsState) => store.setState({ state });
    const go = (href: string, scroll: TabScroll | null | undefined) => {
      cancelRestore.current?.();
      router.push(href, { scroll: false });
      cancelRestore.current = restoreScroll(scroll, href);
    };
    const open = (href: string) => {
      const s = get();
      const target = normalizeHref(href);
      if (!s || !target) {
        router.push(href);
        return;
      }
      const { state, evicted } = openTab(rememberScroll(s), target, {
        id: newId(),
        now: Date.now(),
      });
      set(state);
      if (evicted) {
        toast(`Höchstens ${MAX_TABS} Reiter`, {
          description: `„${tabLabel(evicted)}“ wurde geschlossen (am längsten nicht benutzt).`,
        });
      }
      go(target, null);
    };
    const switchTo = (id: string) => {
      const s = get();
      const target = s?.tabs.find((t) => t.id === id);
      if (!s || !target || id === s.activeId) return;
      set(activateTab(rememberScroll(s), id, Date.now()));
      go(target.href, target.scroll);
    };
    const close = (id: string) => {
      const s = get();
      if (!s) return;
      const { state, activate } = closeTab(s, id, { now: Date.now(), makeId: newId });
      set(state);
      if (activate) go(activate.href, activate.scroll);
    };
    return {
      switchTo,
      open,
      openNew: () => open(HOME_HREF),
      close,
      closeActive: () => {
        const s = get();
        if (s) close(s.activeId);
      },
      step: (dir) => {
        const s = get();
        const id = s ? stepTab(s, dir) : null;
        if (id) switchTo(id);
      },
      move: (id, toIndex) => {
        const s = get();
        if (s) set(moveTab(s, id, toIndex));
      },
      rename: (id, title) => {
        const s = get();
        if (s) set(setTitle(s, id, title));
      },
    };
  }, [router, store]);

  // Einhängen: eigene Liste bzw. letzten Stand lesen, die Adresse im Browser gewinnt
  useEffect(() => {
    const restored = restoreTabs(
      {
        session: readStored(() => window.sessionStorage),
        local: readStored(() => window.localStorage),
      },
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
      { now: Date.now(), makeId: newId },
    );
    if (!restored) return;
    store.setState({ state: restored.state });
    persist(restored.state);
    const active = restored.state.tabs.find((t) => t.id === restored.state.activeId);
    const scroll = restored.scroll;
    if (active && scroll && (scroll.y > 0 || Object.keys(scroll.areas).length > 0)) {
      cancelRestore.current = restoreScroll(scroll, active.href);
    }
  }, [store]);

  // jede Änderung speichern (nur eigene – fremde Fenster werden nicht übernommen, s. o.)
  useEffect(
    () =>
      store.subscribe((next, prev) => {
        if (next.state && next.state !== prev.state) persist(next.state);
      }),
    [store],
  );

  // Der aktive Reiter folgt der Adresse. Zurück/Vor im Browser auf eine Adresse, die ein
  // anderer Reiter zeigt, wechselt zu diesem Reiter (statt ihn zu verdoppeln).
  const query = params.toString();
  const href = normalizeHref(query ? `${pathname}?${query}` : pathname);
  useEffect(() => {
    const s = store.getState().state;
    if (!href || !s) return;
    if (Date.now() - poppedAt.current < POPSTATE_WINDOW_MS) {
      poppedAt.current = 0;
      const other = s.tabs.find((t) => t.id !== s.activeId && sameHref(t.href, href));
      const active = s.tabs.find((t) => t.id === s.activeId);
      if (other && active && !sameHref(active.href, href)) {
        store.setState({ state: activateTab(s, other.id, Date.now()) });
        return;
      }
    }
    store.setState({ state: followHref(s, href) });
  }, [href, store]);

  useEffect(() => {
    const onPop = () => {
      poppedAt.current = Date.now();
      cancelRestore.current?.();
    };
    // Neuladen, Schließen, App im Hintergrund: Scroll-Stelle des aktiven Reiters merken
    const remember = () => {
      const s = store.getState().state;
      if (s) store.setState({ state: rememberScroll(s) });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") remember();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pagehide", remember);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pagehide", remember);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelRestore.current?.();
    };
  }, [store]);

  // ⌃⌥← / ⌃⌥→ wechselt (⌘⇧[ ] und ⌃Tab behält der Browser), ⌘-/Mittelklick = neuer Reiter
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
      if (event.defaultPrevented) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (!store.getState().state) return;
      event.preventDefault();
      actions.step(event.key === "ArrowRight" ? 1 : -1);
    };
    const onClick = (event: MouseEvent) => {
      if (!store.getState().state) return;
      const target = newTabHref(event);
      if (!target) return;
      event.preventDefault();
      // nur der neue Reiter – nicht zusätzlich der Klick-Handler des Elements (öffnete hier)
      event.stopPropagation();
      actions.open(target);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [actions, store]);

  const value = useMemo(() => ({ store, actions }), [store, actions]);
  return <TabsContext value={value}>{children}</TabsContext>;
}
