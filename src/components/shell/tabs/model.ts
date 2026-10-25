/**
 * Reiter in der App (Rückmeldung #63, E36 Variante 1) als reines Modell ohne Browser-Code
 * (getestet in model.test.ts). Ein Reiter merkt sich nur Adresse, Titel und Scroll-Stelle –
 * keine Inhalte, keine Seiten im Hintergrund. Die Liste liegt je Gerät im Browser:
 * sessionStorage je Fenster (übersteht Neuladen), localStorage als Stand für neue Fenster.
 */
import { recapTitle } from "@/features/recaps/model";

/** Höchstens so viele Reiter; beim nächsten schließt der am längsten nicht benutzte. */
export const MAX_TABS = 8;
export const TABS_KEY = "sz-tabs";
/** „＋ Neuer Reiter“ und der letzte geschlossene Reiter landen hier. */
export const HOME_HREF = "/heute";
const FORMAT = 1;
const MAX_TITLE = 200;

export interface ScrollSpot {
  top: number;
  left: number;
}

/** Scroll-Stelle: Fenster (`y`) und in sich scrollende Bereiche (`data-tab-scroll`). */
export interface TabScroll {
  y: number;
  areas: Record<string, ScrollSpot>;
}

export interface Tab {
  id: string;
  /** App-Pfad samt Abfrage, z. B. `/kalender?ansicht=woche&tag=2026-10-19&aufgabe=…` */
  href: string;
  /** zuletzt bekannter Titel (für die Anzeige, bevor die Daten da sind) */
  title: string;
  /** zuletzt aktiv (ms) – entscheidet, welcher Reiter über der Obergrenze weicht */
  usedAt: number;
  scroll?: TabScroll;
}

export interface TabsState {
  tabs: Tab[];
  activeId: string;
}

/** Bereiche der App, die ein Reiter sein können (öffentliche Seiten wie Login nie). */
const SECTIONS: Record<string, string> = {
  heute: "Heute",
  inbox: "Inbox",
  kalender: "Kalender",
  wissen: "Wissen",
  rueckblicke: "Rückblicke",
  wochenreview: "Wochenreview",
  projekte: "Projekte",
  aufgaben: "Aufgaben",
  notizen: "Notizen",
  papierkorb: "Papierkorb",
  einstellungen: "Einstellungen",
};

const PROBE_ORIGIN = "http://app.invalid";

/**
 * App-Pfad eines Reiters oder null (fremde Adresse, öffentliche Seite, Login/MFA, Schnittstellen).
 * Die Abfrage wird einheitlich kodiert, damit dieselbe Seite immer gleich aussieht.
 */
export function normalizeHref(raw: string | null | undefined): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen gezielt abweisen
  if (!raw?.startsWith("/") || raw.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(raw)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  const section = url.pathname.split("/")[1] ?? "";
  if (!Object.hasOwn(SECTIONS, section)) return null;
  const query = new URLSearchParams(url.search).toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

const withoutHash = (href: string) => href.split("#")[0] ?? href;
const pathOf = (href: string) => withoutHash(href).split("?")[0] ?? href;

/** Gleiche Seite (ohne Sprungmarke)? */
export const sameHref = (a: string, b: string) => withoutHash(a) === withoutHash(b);

export type TabKind = "page" | "note" | "project" | "recap" | "task";

export interface TabTarget {
  /** erster Pfadteil, z. B. „wissen“ – bestimmt das Symbol einer Seite */
  section: string;
  kind: TabKind;
  /** Notiz, Projekt oder Rückblick */
  id: string | null;
  /** offene Aufgabe (`?aufgabe=`) */
  taskId: string | null;
  /** Name der Seite bzw. Platzhalter, solange der Titel unbekannt ist */
  label: string;
  /** Seite unter einer offenen Aufgabe (für den Tooltip) */
  page: string;
}

const RECAP_SLUG = /^(woche)-(\d{4}-\d{2}-\d{2})$|^(monat)-(\d{4}-\d{2})$/;

/** Was hinter einer Adresse steht (ohne Daten). */
export function describeHref(href: string): TabTarget {
  const url = new URL(href, PROBE_ORIGIN);
  const [, section = "", rest = ""] = url.pathname.split("/");
  const taskId = url.searchParams.get("aufgabe");
  const pageLabel = SECTIONS[section] ?? "Seite";
  let kind: TabKind = "page";
  let id: string | null = null;
  let label = pageLabel;
  if (section === "wissen" && rest) {
    kind = "note";
    id = rest;
    label = "Notiz";
  } else if (section === "projekte" && rest === "zeitstrahl") {
    label = "Zeitstrahl";
  } else if (section === "projekte" && rest) {
    kind = "project";
    id = rest;
    label = "Projekt";
  } else if (section === "rueckblicke" && rest) {
    kind = "recap";
    const slug = RECAP_SLUG.exec(rest);
    if (slug?.[1]) label = recapTitle({ kind: "woche", period_start: slug[2] as string });
    else if (slug?.[3]) label = recapTitle({ kind: "monat", period_start: `${slug[4]}-01` });
    else {
      id = rest;
      label = "Rückblick";
    }
  }
  const page = label;
  if (taskId) {
    kind = "task";
    label = "Aufgabe";
  }
  return { section, kind, id, taskId, label, page };
}

/** Titel aus den Daten (Notiz, Projekt, Aufgabe, Rückblick); undefined = unbekannt. */
export interface TitleLookup {
  note: (id: string) => string | undefined;
  project: (id: string) => string | undefined;
  task: (id: string) => string | undefined;
  recap: (id: string) => string | undefined;
}

/**
 * Titel eines Reiters: offene Aufgabe vor der Seite, sonst Notiz/Projekt/Rückblick bzw. der
 * Seitenname. null = noch unbekannt (Daten laden, Eintrag im Papierkorb) – dann gilt der
 * zuletzt gemerkte Titel.
 */
export function resolveTitle(target: TabTarget, lookup: TitleLookup): string | null {
  if (target.taskId) return lookup.task(target.taskId) ?? null;
  if (!target.id) return target.label;
  const found =
    target.kind === "note"
      ? lookup.note(target.id)
      : target.kind === "project"
        ? lookup.project(target.id)
        : lookup.recap(target.id);
  return found ?? null;
}

const clampTitle = (title: string) => title.slice(0, MAX_TITLE);

/** Neuer Reiter rechts neben dem aktiven; über der Obergrenze weicht der am längsten unbenutzte. */
export function openTab(
  state: TabsState,
  href: string,
  {
    id,
    now,
    title = "",
    activate = true,
  }: { id: string; now: number; title?: string; activate?: boolean },
): { state: TabsState; evicted: Tab | null } {
  const tab: Tab = { id, href, title: clampTitle(title), usedAt: now };
  let tabs = [...state.tabs];
  let evicted: Tab | null = null;
  if (tabs.length >= MAX_TABS) {
    const candidates = tabs.filter((t) => t.id !== state.activeId);
    evicted = candidates.reduce<Tab | null>(
      (oldest, t) => (!oldest || t.usedAt < oldest.usedAt ? t : oldest),
      null,
    );
    if (evicted) tabs = tabs.filter((t) => t.id !== evicted?.id);
  }
  const at = tabs.findIndex((t) => t.id === state.activeId);
  tabs.splice(at === -1 ? tabs.length : at + 1, 0, tab);
  return { state: { tabs, activeId: activate ? id : state.activeId }, evicted };
}

export function activateTab(state: TabsState, id: string, now: number): TabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return {
    activeId: id,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, usedAt: now } : t)),
  };
}

/**
 * Reiter schließen. War er aktiv, wird der zuletzt benutzte andere aktiv (`activate` = wohin
 * jetzt navigieren). Der letzte Reiter macht Platz für „Heute“.
 */
export function closeTab(
  state: TabsState,
  id: string,
  { now, makeId }: { now: number; makeId: () => string },
): { state: TabsState; activate: Tab | null } {
  if (!state.tabs.some((t) => t.id === id)) return { state, activate: null };
  const rest = state.tabs.filter((t) => t.id !== id);
  if (rest.length === 0) {
    const home: Tab = { id: makeId(), href: HOME_HREF, title: "Heute", usedAt: now };
    return { state: { tabs: [home], activeId: home.id }, activate: home };
  }
  if (id !== state.activeId) return { state: { ...state, tabs: rest }, activate: null };
  const next = rest.reduce((best, t) => (t.usedAt > best.usedAt ? t : best));
  return {
    state: activateTab({ tabs: rest, activeId: next.id }, next.id, now),
    activate: next,
  };
}

/** Der aktive Reiter folgt der Adresse (Link, Seitenleiste, Panel); neue Seite = neue Scroll-Stelle. */
export function followHref(state: TabsState, href: string): TabsState {
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (!active || active.href === href) return state;
  const samePage = sameHref(active.href, href);
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === active.id ? { ...t, href, scroll: samePage ? t.scroll : undefined } : t,
    ),
  };
}

export function setTitle(state: TabsState, id: string, title: string): TabsState {
  const next = clampTitle(title);
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.title === next) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: next } : t)) };
}

export function saveScroll(state: TabsState, id: string, scroll: TabScroll): TabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, scroll } : t)) };
}

/** Reiter an eine andere Stelle ziehen. */
export function moveTab(state: TabsState, id: string, toIndex: number): TabsState {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from === -1) return state;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(from, 1);
  const to = Math.max(0, Math.min(tabs.length, from < toIndex ? toIndex - 1 : toIndex));
  if (to === from || !tab) return state;
  tabs.splice(to, 0, tab);
  return { ...state, tabs };
}

/** Nächster bzw. vorheriger Reiter (im Kreis), null bei nur einem. */
export function stepTab(state: TabsState, dir: 1 | -1): string | null {
  if (state.tabs.length < 2) return null;
  const at = state.tabs.findIndex((t) => t.id === state.activeId);
  const next = (at + dir + state.tabs.length) % state.tabs.length;
  return state.tabs[next]?.id ?? null;
}

export function serializeTabs(state: TabsState): string {
  return JSON.stringify({ v: FORMAT, activeId: state.activeId, tabs: state.tabs });
}

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parseScroll(raw: unknown): TabScroll | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { y, areas } = raw as { y?: unknown; areas?: unknown };
  if (!isNumber(y) || y < 0) return undefined;
  const spots: Record<string, ScrollSpot> = {};
  if (areas && typeof areas === "object") {
    for (const [key, spot] of Object.entries(areas as Record<string, unknown>)) {
      const { top, left } = (spot ?? {}) as { top?: unknown; left?: unknown };
      if (isNumber(top) && isNumber(left) && key.length <= 40) spots[key] = { top, left };
    }
  }
  return { y, areas: spots };
}

/**
 * Gespeicherte Liste lesen – robust gegen Fremdes (älteres/neueres Format, kaputtes JSON,
 * fremde Adressen): Ungültiges fällt weg, nichts wirft. null = nichts Brauchbares.
 */
export function parseTabs(raw: string | null | undefined): TabsState | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { v, activeId, tabs } = data as { v?: unknown; activeId?: unknown; tabs?: unknown };
  if (v !== FORMAT || !Array.isArray(tabs)) return null;
  const seen = new Set<string>();
  const valid: Tab[] = [];
  for (const entry of tabs) {
    if (!entry || typeof entry !== "object") continue;
    const t = entry as Record<string, unknown>;
    const href = typeof t.href === "string" ? normalizeHref(t.href) : null;
    if (typeof t.id !== "string" || !t.id || seen.has(t.id) || !href) continue;
    seen.add(t.id);
    valid.push({
      id: t.id,
      href,
      title: typeof t.title === "string" ? clampTitle(t.title) : "",
      usedAt: isNumber(t.usedAt) ? t.usedAt : 0,
      scroll: parseScroll(t.scroll),
    });
  }
  if (valid.length === 0) return null;
  const active =
    valid.find((t) => t.id === activeId) ??
    valid.reduce((best, t) => (t.usedAt > best.usedAt ? t : best));
  // über der Obergrenze (älterer Stand): der aktive bleibt, die zuletzt benutzten auch
  const keep = new Set([
    active.id,
    ...valid
      .filter((t) => t.id !== active.id)
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, MAX_TABS - 1)
      .map((t) => t.id),
  ]);
  return { tabs: valid.filter((t) => keep.has(t.id)), activeId: active.id };
}

/**
 * Beim Laden einer Seite: eigene Liste dieses Fensters (sessionStorage) vor dem letzten Stand
 * aller Fenster (localStorage) – ein anderes Fenster, das später schrieb, nimmt diesem Fenster
 * beim Neuladen nicht seine Reiter. Die Adresse im Browser gewinnt: Steht sie schon in einem
 * Reiter, wird er aktiv (mit seiner Scroll-Stelle). Sonst übernimmt sie im selben Fenster der
 * aktive Reiter (wie eine eingetippte Adresse im Browser-Tab); ein neues Fenster nimmt den Reiter
 * derselben Seite oder hängt einen neuen an.
 */
export function restoreTabs(
  stored: { session: string | null; local: string | null },
  url: string,
  { now, makeId }: { now: number; makeId: () => string },
): { state: TabsState; scroll: TabScroll | null } | null {
  const own = parseTabs(stored.session);
  const base = own ?? parseTabs(stored.local);
  const href = normalizeHref(url);
  if (!href) return base ? { state: base, scroll: null } : null;
  if (!base) {
    const id = makeId();
    return { state: { tabs: [{ id, href, title: "", usedAt: now }], activeId: id }, scroll: null };
  }
  const prefer = (match: (t: Tab) => boolean) =>
    base.tabs.find((t) => t.id === base.activeId && match(t)) ?? base.tabs.find(match);
  const exact = prefer((t) => sameHref(t.href, href));
  if (exact) {
    return {
      state: followHref(activateTab(base, exact.id, now), href),
      scroll: exact.scroll ?? null,
    };
  }
  if (own) return { state: followHref(activateTab(own, own.activeId, now), href), scroll: null };
  const samePath = prefer((t) => pathOf(t.href) === pathOf(href));
  if (samePath) {
    return { state: followHref(activateTab(base, samePath.id, now), href), scroll: null };
  }
  return { state: openTab(base, href, { id: makeId(), now }).state, scroll: null };
}
