"use client";

import { type LucideIcon, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  decideAxis,
  isArmed,
  SWIPE,
  type SwipeAxis,
  type SwipeSide,
  sideOf,
  swipeOffset,
  swipeOutcome,
} from "@/lib/swipe";

export interface SwipeAction {
  /** kurz, steht unter der Zeile: „Papierkorb“, „Erledigt“ */
  label: string;
  icon: LucideIcon;
  tone: "danger" | "success" | "neutral";
  /** Zeile gleitet hinaus (sie verschwindet aus der Liste) statt zurückzufedern */
  dismiss?: boolean;
  onTrigger: () => void;
}

/** Nach links wischen = in den Papierkorb (die Aktion zeigt ihren „Rückgängig“-Toast). */
export const trashSwipe = (onTrigger: () => void): SwipeAction => ({
  label: "Papierkorb",
  icon: Trash2,
  tone: "danger",
  dismiss: true,
  onTrigger,
});

const TONES: Record<SwipeAction["tone"], { tint: string; armed: string }> = {
  danger: { tint: "bg-danger/15 text-danger", armed: "bg-danger text-bg" },
  success: { tint: "bg-success/15 text-success", armed: "bg-success text-bg" },
  neutral: { tint: "bg-surface-2 text-muted", armed: "bg-border-strong text-fg" },
};

/** Wischen nur am Handy mit Touch (Desktop behält den Rechtsklick, Rückmeldung #22). */
const MOBILE_QUERY = "(max-width: 767.98px)";

const matches = (query: string) =>
  typeof window !== "undefined" && window.matchMedia?.(query).matches === true;

interface Gesture {
  touchId: number;
  x: number;
  y: number;
  axis: SwipeAxis;
  width: number;
  offset: number;
  lastX: number;
  lastT: number;
  velocity: number;
}

const reducedMotion = () => matches("(prefers-reduced-motion: reduce)");

/**
 * Listenzeile mit Wischgesten (Rückmeldung #22): nach links wischen = `left` (z. B. Papierkorb),
 * nach rechts = `right` (z. B. erledigt). Nur Touch unter 768 px; senkrechtes Scrollen hat
 * Vorrang (Richtung erst nach ein paar Pixeln). Unter der Zeile erscheint Farbe und Symbol der
 * Aktion, kräftiger, sobald Loslassen auslöst. Die Aktionen selbst bleiben über Checkbox und Menü
 * erreichbar – Wischen ist nur der schnelle Weg.
 *
 * Touch-Ereignisse statt Pointer (Rückmeldung #24): Safari am iPhone begann bei leicht schrägem
 * Wischen zu scrollen und brach die Geste ab (`pointercancel`, die Zeile „bewegte sich kaum“).
 * Jetzt hält `touchmove` (nicht passiv) das Scrollen an, sobald die Bewegung waagrecht ist.
 */
export function SwipeRow({
  left,
  right,
  children,
  className,
}: {
  left?: SwipeAction;
  right?: SwipeAction;
  children: React.ReactNode;
  className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const swipedAt = useRef(0);
  const busy = useRef(false);
  const actions = useRef({ left, right });
  const [side, setSide] = useState<SwipeSide | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    actions.current = { left, right };
  });

  useEffect(() => {
    const box = outer.current;
    if (!box) return;
    const allowed = () => ({
      left: Boolean(actions.current.left),
      right: Boolean(actions.current.right),
    });

    const apply = (offset: number, animate: boolean) => {
      const node = content.current;
      if (!node) return;
      node.style.transition = animate ? `transform ${SWIPE.duration}ms var(--ease-out)` : "";
      node.style.transform = offset ? `translateX(${offset}px)` : "";
      // gleichzeitig mit dem Versatz: nie seitlich über den Rand (kein waagrechtes Scrollen)
      box.style.overflow = offset ? "hidden" : "";
      box.style.setProperty("--swipe-reveal", `${Math.abs(offset)}px`);
    };

    const reset = (animate: boolean) => {
      apply(0, animate);
      const done = () => {
        setSide(null);
        setArmed(false);
        busy.current = false;
      };
      if (animate) setTimeout(done, SWIPE.duration);
      else done();
    };

    const finish = (velocity: number, current: Gesture) => {
      const reduced = reducedMotion();
      const outcome = swipeOutcome(current.offset, current.width, velocity, allowed());
      const { left: onLeft, right: onRight } = actions.current;
      const action = outcome === "left" ? onLeft : outcome === "right" ? onRight : undefined;
      if (!outcome || !action) return reset(!reduced);
      busy.current = true;
      if (action.dismiss && !reduced) {
        apply(outcome === "left" ? -current.width : current.width, true);
        // Aktion auch dann, wenn die Zeile inzwischen verschwunden ist (Navigation o. Ä.)
        setTimeout(() => {
          action.onTrigger();
          reset(false);
        }, SWIPE.duration);
      } else {
        action.onTrigger();
        reset(!reduced);
      }
    };

    const touchOf = (event: TouchEvent, id: number) =>
      Array.from(event.changedTouches).find((t) => t.identifier === id);

    const cancel = () => {
      const current = gesture.current;
      gesture.current = null;
      if (current?.axis === "horizontal") reset(!reducedMotion());
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || busy.current || !matches(MOBILE_QUERY)) {
        cancel();
        return;
      }
      const { left: onLeft, right: onRight } = actions.current;
      if (!onLeft && !onRight) return;
      const touch = event.touches[0];
      gesture.current = {
        touchId: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        axis: "pending",
        width: box.offsetWidth,
        offset: 0,
        lastX: touch.clientX,
        lastT: event.timeStamp,
        velocity: 0,
      };
    };

    const onMove = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current) return;
      // zweiter Finger (Zoomen): Geste abbrechen
      if (event.touches.length > 1) return cancel();
      const touch = touchOf(event, current.touchId);
      if (!touch) return;
      const dx = touch.clientX - current.x;
      const dy = touch.clientY - current.y;
      if (current.axis === "pending") {
        current.axis = decideAxis(dx, dy);
        if (current.axis === "vertical") {
          gesture.current = null;
          return;
        }
        if (current.axis === "pending") {
          // noch unentschieden, aber eher waagrecht: Safari soll noch nicht zu scrollen beginnen
          if (Math.abs(dx) > Math.abs(dy) && event.cancelable) event.preventDefault();
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      const dt = event.timeStamp - current.lastT;
      if (dt > 0) current.velocity = (touch.clientX - current.lastX) / dt;
      current.lastX = touch.clientX;
      current.lastT = event.timeStamp;
      current.offset = swipeOffset(dx, allowed());
      apply(current.offset, false);
      setSide(sideOf(current.offset));
      setArmed(isArmed(current.offset, current.width));
    };

    const onEnd = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current || !touchOf(event, current.touchId)) return;
      gesture.current = null;
      if (current.axis !== "horizontal") return;
      swipedAt.current = Date.now();
      // langsames Ende: letzte Geschwindigkeit nur, wenn der Finger zuletzt noch in Bewegung war
      const velocity = event.timeStamp - current.lastT > 80 ? 0 : current.velocity;
      finish(velocity, current);
    };

    box.addEventListener("touchstart", onStart, { passive: true });
    // nicht passiv: nur so lässt sich das Scrollen während des Wischens anhalten
    box.addEventListener("touchmove", onMove, { passive: false });
    box.addEventListener("touchend", onEnd);
    box.addEventListener("touchcancel", cancel);
    return () => {
      box.removeEventListener("touchstart", onStart);
      box.removeEventListener("touchmove", onMove);
      box.removeEventListener("touchend", onEnd);
      box.removeEventListener("touchcancel", cancel);
    };
  }, []);

  const action = side === "left" ? left : side === "right" ? right : undefined;
  const Icon = action?.icon;

  return (
    <div
      ref={outer}
      data-swipe={side ?? undefined}
      // senkrecht scrollt der Browser, waagrecht die Geste; Zoomen mit zwei Fingern bleibt
      className={cn("relative max-md:touch-pan-y max-md:touch-pinch-zoom", className)}
      onClickCapture={(event) => {
        // nach dem Wischen kein Klick auf Link oder Checkbox darunter
        if (Date.now() - swipedAt.current < 400) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {action && Icon ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 flex items-center gap-2 overflow-hidden rounded-card px-4 text-ui-sm font-medium whitespace-nowrap transition-colors",
            // Symbol zuerst sichtbar: an der Kante, von der die Zeile weggleitet
            side === "left" ? "right-0 flex-row-reverse" : "left-0",
            armed ? TONES[action.tone].armed : TONES[action.tone].tint,
          )}
          style={{ width: "var(--swipe-reveal, 0px)" }}
        >
          <Icon size={18} strokeWidth={1.5} className="shrink-0" />
          {action.label}
        </div>
      ) : null}
      <div ref={content} className="relative">
        {children}
      </div>
    </div>
  );
}
