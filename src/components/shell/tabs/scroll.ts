/**
 * Scroll-Stelle eines Reiters (#63) im Browser: Fenster plus in sich scrollende Bereiche, die
 * sich mit `data-tab-scroll="<schlüssel>"` melden (Notiz-Spalte, Wochenraster, Einplanen, …).
 * Wiederherstellen erst, wenn die Seite unter der neuen Adresse steht und geladen ist (kein
 * Skeleton, kein `aria-busy`, hoch genug) – nie vorher springen. Scrollt oder tippt der Nutzer
 * inzwischen selbst, bleibt alles, wie er es will.
 */
import { normalizeHref, type ScrollSpot, sameHref, type TabScroll } from "./model";

export const SCROLL_ATTR = "data-tab-scroll";
const TOP: TabScroll = { y: 0, areas: {} };
/** so lange auf die neue Adresse warten (Netz langsam) */
const ROUTE_LIMIT = 8000;
/** so lange nach dem Wechsel auf geladene Inhalte warten, danach so gut es geht */
const LOAD_LIMIT = 5000;
/** späte Verschiebungen (Bilder, Jetzt-Linie im Raster) nach dem Setzen noch abfangen */
const RECHECK_MS = [150, 450];
const USER_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;

const visible = (el: HTMLElement) => el.getClientRects().length > 0;

function scrollArea(key: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[${SCROLL_ATTR}="${CSS.escape(key)}"]`);
  for (const el of all) if (visible(el)) return el;
  return null;
}

export function captureScroll(): TabScroll {
  const areas: Record<string, ScrollSpot> = {};
  for (const el of document.querySelectorAll<HTMLElement>(`[${SCROLL_ATTR}]`)) {
    const key = el.getAttribute(SCROLL_ATTR);
    if (!key || areas[key] || !visible(el)) continue;
    if (el.scrollTop === 0 && el.scrollLeft === 0) continue;
    areas[key] = { top: Math.round(el.scrollTop), left: Math.round(el.scrollLeft) };
  }
  return { y: Math.round(window.scrollY), areas };
}

const here = () => normalizeHref(`${window.location.pathname}${window.location.search}`);

function loading(): boolean {
  const main = document.getElementById("inhalt");
  return Boolean(main?.querySelector('[aria-busy="true"], [data-skeleton]'));
}

function reachable(target: TabScroll): boolean {
  const doc = document.scrollingElement ?? document.documentElement;
  if (doc.scrollHeight - window.innerHeight < target.y - 1) return false;
  for (const [key, spot] of Object.entries(target.areas)) {
    const el = scrollArea(key);
    if (!el) return false;
    if (el.scrollHeight - el.clientHeight < spot.top - 1) return false;
    if (el.scrollWidth - el.clientWidth < spot.left - 1) return false;
  }
  return true;
}

function apply(target: TabScroll) {
  window.scrollTo({ top: target.y, left: 0, behavior: "instant" });
  for (const [key, spot] of Object.entries(target.areas)) {
    const el = scrollArea(key);
    if (!el) continue;
    el.scrollTop = spot.top;
    el.scrollLeft = spot.left;
  }
}

function inPlace(target: TabScroll): boolean {
  if (Math.abs(window.scrollY - target.y) > 2) return false;
  return Object.entries(target.areas).every(([key, spot]) => {
    const el = scrollArea(key);
    return (
      !el || (Math.abs(el.scrollTop - spot.top) <= 2 && Math.abs(el.scrollLeft - spot.left) <= 2)
    );
  });
}

/**
 * Nach einem Reiterwechsel zu `href` die Scroll-Stelle setzen (ohne gemerkte Stelle: oben).
 * Gibt eine Funktion zum Abbrechen zurück (nächster Wechsel, Verlassen).
 */
export function restoreScroll(target: TabScroll | null | undefined, href: string): () => void {
  const want = target ?? TOP;
  const start = performance.now();
  let committedAt: number | null = null;
  let toppedOnce = false;
  let stopped = false;
  let frame = 0;
  const timers: number[] = [];

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    for (const t of timers) window.clearTimeout(t);
    for (const name of USER_EVENTS) window.removeEventListener(name, stop, true);
  };

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    const current = here();
    if (!current || !sameHref(current, href)) {
      if (now - start > ROUTE_LIMIT) stop();
      else frame = requestAnimationFrame(tick);
      return;
    }
    committedAt ??= now;
    const ready = !loading() && reachable(want);
    if (ready || now - committedAt > LOAD_LIMIT) {
      apply(want);
      for (const ms of RECHECK_MS) {
        timers.push(
          window.setTimeout(() => {
            if (!stopped && !inPlace(want)) apply(want);
          }, ms),
        );
      }
      timers.push(window.setTimeout(stop, (RECHECK_MS.at(-1) ?? 0) + 50));
      return;
    }
    // Ladeansicht von oben zeigen, nicht an der Stelle der vorigen Seite
    if (!toppedOnce) {
      toppedOnce = true;
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    frame = requestAnimationFrame(tick);
  };

  for (const name of USER_EVENTS) {
    window.addEventListener(name, stop, { capture: true, passive: true });
  }
  frame = requestAnimationFrame(tick);
  return stop;
}
