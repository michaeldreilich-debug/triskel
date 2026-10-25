"use client";

import { BookOpen, CalendarDays, type LucideIcon, Menu, Plus, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { opensKeyboard } from "@/lib/undo";
import { isActive } from "./nav";

/**
 * Wird gerade geschrieben? Auf einem Touch-Gerät, solange der Fokus in einem Feld liegt, bei dem
 * die Tastatur aufgeht (Textfeld, Textbereich, Editor – nicht Uhrzeit, Datum, Auswahl: `opensKeyboard`). Beim Wechsel zwischen zwei Feldern liegt zwischen focusout und
 * focusin kein Frame – deshalb wird nach dem Verlassen erst im nächsten Takt geprüft.
 *
 * Verschwindet das Feld mit dem Fokus aus der Seite (Sheet schließt, Zeile wird ersetzt), meldet
 * Safari kein focusout – die Leiste bliebe weg, bis wieder ein Feld den Fokus bekommt. Solange
 * geschrieben wird, prüft deshalb ein Beobachter, ob das Feld noch in der Seite hängt.
 */
export function useIsWriting(): boolean {
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    const touch = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
    if (!touch) return;
    let frame = 0;
    let field: Element | null = null;
    const observer = new MutationObserver(() => {
      if (field && !field.isConnected) update();
    });
    const check = () => {
      const active = document.activeElement;
      field = opensKeyboard(active) ? active : null;
      setWriting(field !== null);
      observer.disconnect();
      if (field) observer.observe(document.body, { childList: true, subtree: true });
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return writing;
}

const SLOT =
  "relative flex h-tabbar min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-meta text-muted transition-colors aria-[current=page]:text-fg";

function Slot({
  icon: Icon,
  label,
  active,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
} & (
  | { href: string; onClick?: never; "aria-label"?: never }
  | { href?: never; onClick: () => void; "aria-label"?: string }
)) {
  const content = (
    <>
      <Icon size={20} strokeWidth={active ? 2 : 1.5} aria-hidden />
      <span className="max-w-full truncate">{label}</span>
    </>
  );
  if (props.href !== undefined) {
    return (
      <Link href={props.href} aria-current={active ? "page" : undefined} className={SLOT}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={props.onClick} aria-label={props["aria-label"]} className={SLOT}>
      {content}
    </button>
  );
}

/**
 * Leiste unten am Handy (< 768 px, E44 H2): Heute · Woche · ＋ · Wissen · Menü. Fest unten über
 * dem Inhalt (z-30), unter Sheets, Dialogen und der Palette (z-40/50). Sie blendet sich aus,
 * solange geschrieben wird – sonst schwebte sie über der Tastatur bzw. der Werkzeugleiste des
 * Outliners.
 *
 * `onCapture` ist die Stelle für das ＋: Die Shell übergibt, was beim Antippen geschieht
 * (das Sheet „Festhalten“, H3).
 */
export function MobileTabBar({ onCapture, onMenu }: { onCapture: () => void; onMenu: () => void }) {
  const pathname = usePathname();
  const writing = useIsWriting();
  return (
    <nav
      aria-label="Hauptleiste"
      data-testid="mobile-tab-bar"
      inert={writing}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex items-center border-t border-border bg-sidebar px-1 pb-[env(safe-area-inset-bottom)] md:hidden",
        "transition-[transform,visibility] duration-150 ease-out",
        writing && "invisible translate-y-full",
      )}
    >
      <Slot icon={Sun} label="Heute" href="/heute" active={isActive(pathname, "/heute")} />
      {/* ohne Tag: der Kalender nimmt „heute“ erst im Browser – ein Datum im Link wäre auf dem
          Server berechnet und veraltete, solange die App über Nacht offen bleibt */}
      <Slot
        icon={CalendarDays}
        label="Woche"
        href="/kalender?ansicht=woche"
        active={isActive(pathname, "/kalender")}
      />
      <div className="flex h-tabbar flex-1 items-center justify-center">
        <button
          type="button"
          aria-label="Schnell erfassen"
          onClick={onCapture}
          className="grid size-12 place-items-center rounded-full bg-accent text-accent-fg transition-colors hover:bg-accent/90"
        >
          <Plus size={24} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <Slot
        icon={BookOpen}
        label="Wissen"
        href={appPath.knowledge()}
        active={isActive(pathname, "/wissen")}
      />
      <Slot icon={Menu} label="Menü" aria-label="Menü öffnen" onClick={onMenu} />
    </nav>
  );
}
