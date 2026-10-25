"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useLocalFlag } from "@/lib/local-pref";
import { SectionHeader } from "./section-header";

/**
 * Klappbarer Abschnitt (F6, #58): Kopf wie `SectionHeader` (Muster 2), ein Klick klappt auf. Zu ist
 * der Kopf die Übersicht – die Zusammenfassung des aktuellen Werts steht dann unter dem Titel.
 * Klappzustand je Gerät (`useLocalFlag`). Ein Sprungziel (`/einstellungen#sicherung`) öffnet den
 * Abschnitt und scrollt hin, auch wenn er je Gerät zu ist.
 */
export function FoldSection({
  id,
  icon,
  title,
  sub,
  summary,
  className,
  bodyClassName,
  children,
}: {
  /** Sprungziel (#id) und Schlüssel für den gemerkten Zustand */
  id: string;
  icon: LucideIcon;
  title: string;
  /** Erklärung, sichtbar solange der Abschnitt offen ist */
  sub?: React.ReactNode;
  /** aktueller Wert in einer Zeile, sichtbar solange der Abschnitt zu ist */
  summary?: React.ReactNode;
  className?: string;
  /** Abstand im geöffneten Inhalt (Standard gap-4) */
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const [stored, setStored] = useLocalFlag(`sz-fold-${id}`, false);
  const [jumped, setJumped] = useState(false);
  const open = stored || jumped;
  const ref = useRef<HTMLElement>(null);
  const panelId = useId();

  useEffect(() => {
    const check = () => {
      if (window.location.hash !== `#${id}`) return;
      setJumped(true);
      // erst nach dem Aufklappen scrollen: der Browser hat beim Laden zu früh gesprungen
      requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "start" }));
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [id]);

  const toggle = () => {
    setStored(!open);
    setJumped(false);
  };

  return (
    <section
      ref={ref}
      id={id}
      aria-label={title}
      className={cn("flex scroll-mt-8 flex-col gap-4", className)}
    >
      {/* Muster „Akkordeon“: Überschrift außen, Knopf darin (M3-3) */}
      <h2 className="-mx-2 flex min-w-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="flex min-h-11 min-w-0 flex-1 items-center rounded-card px-2 py-1 text-left transition-colors hover:bg-surface-2"
        >
          <SectionHeader
            inline
            icon={icon}
            title={title}
            sub={open ? sub : (summary ?? sub)}
            meta={
              <ChevronDown
                size={16}
                strokeWidth={1.5}
                aria-hidden
                className={cn("transition-transform", open && "rotate-180")}
              />
            }
            className="flex-1"
          />
        </button>
      </h2>
      {open ? (
        <div id={panelId} className={cn("flex flex-col gap-4", bodyClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
