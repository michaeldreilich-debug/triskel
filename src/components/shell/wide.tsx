"use client";

import { Maximize2, Minimize2, PanelLeftClose, PanelRightClose } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui-store";

export type WideMode = "task" | "page";

/** Detailseiten, die sich über die ganze Breite ziehen lassen: Notiz und Projekt. */
export const isDetailPath = (pathname: string) =>
  /^\/(wissen|projekte)\/[^/]+$/.test(pathname) && pathname !== "/projekte/zeitstrahl";

/**
 * Ganze Breite (Rückmeldung #31): gilt nur, solange die Ansicht offen ist – schließt man die
 * Aufgabe oder verlässt die Notiz/das Projekt, ist alles wieder normal.
 */
export function useWide() {
  const wide = useUi((s) => s.wide);
  const setWide = useUi((s) => s.setWide);
  const pathname = usePathname();
  const params = useSearchParams();
  const task = wide === "task" && Boolean(params.get("aufgabe"));
  const page = wide === "page" && isDetailPath(pathname);
  return { task, page, active: task || page, setWide };
}

/** Schalter im Kopf von Aufgabe, Notiz und Projekt (nur am großen Bildschirm). */
export function WideToggle({ mode, className }: { mode: WideMode; className?: string }) {
  const wide = useWide();
  const on = mode === "task" ? wide.task : wide.page;
  const Icon = on ? Minimize2 : Maximize2;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={on}
      aria-label="Ganze Breite"
      title={
        on
          ? "Normale Breite: Seitenleiste und Listen wieder zeigen"
          : "Ganze Breite: Seitenleiste und Listen zu Reitern zusammenziehen"
      }
      onClick={() => wide.setWide(on ? null : mode)}
      className={cn(mode === "task" ? "max-xl:hidden" : "max-lg:hidden", className)}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden />
    </Button>
  );
}

/**
 * Kleiner Knopf oben in einer Spalte, der sie zum senkrechten Reiter (`Rail`) zusammenschiebt
 * (#80). Linke Spalten schieben nach links, rechte nach rechts; der Reiter klappt sie wieder auf.
 */
export function FoldButton({
  label,
  side = "left",
  onClick,
  hint,
  className,
}: {
  /** Name der Spalte wie am Reiter, z. B. „Themen“ */
  label: string;
  side?: "left" | "right";
  onClick: () => void;
  /** Tooltip, falls abweichend vom Standard (z. B. mit Kürzel) */
  hint?: string;
  className?: string;
}) {
  const Icon = side === "left" ? PanelLeftClose : PanelRightClose;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`${label} einklappen`}
      title={hint ?? `${label} einklappen`}
      onClick={onClick}
      className={className}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden />
    </Button>
  );
}

/** Wo ein Reiter steht: Höhe, Rand und Hintergrund passend zur Spalte, die er ersetzt. */
const RAIL_PLACE = {
  /** Seitenleiste bzw. Seite hinter einer breiten Aufgabe: ganze Fensterhöhe */
  shell: "sticky top-0 h-dvh border-r bg-sidebar",
  /** Spalte am linken Rand des Inhalts (Themen, Notizliste, Steckbrief): unter der Reiterleiste */
  left: "sticky top-[var(--tabbar-h,0px)] h-[calc(100dvh-var(--tabbar-h,0px))] border-r bg-sidebar",
  /** Spalte am rechten Rand des Inhalts (Einplanen, Verknüpfungen): so hoch wie der Inhalt erlaubt */
  right:
    "sticky top-[calc(var(--tabbar-h,0px)+1rem)] max-h-[calc(100dvh-var(--tabbar-h,0px)-2rem)] min-h-48 rounded-control border-l",
  /** offene Aufgabe (Panel am rechten Fensterrand) */
  panel: "sticky top-0 h-dvh border-l bg-sidebar",
} as const;

/**
 * Zusammengezogene Spalte als schmaler, senkrechter Reiter (#31, #80). Ein Klick klappt sie
 * wieder auf. `side` sagt, welche Spalte er ersetzt (`RAIL_PLACE`), optional mit Anzahl.
 */
export function Rail({
  label,
  icon: Icon,
  onClick,
  hint,
  side = "shell",
  count,
  className,
}: {
  label: string;
  icon: ComponentType<{
    size?: number;
    strokeWidth?: number;
    className?: string;
    "aria-hidden"?: boolean;
  }>;
  onClick: () => void;
  /** Tooltip, falls abweichend vom Standard */
  hint?: string;
  side?: keyof typeof RAIL_PLACE;
  /** kleine Zahl unter dem Symbol (z. B. Aufgaben zum Einplanen) */
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} wieder einblenden`}
      title={hint ?? `${label} wieder einblenden`}
      className={cn(
        "w-10 shrink-0 flex-col items-center gap-3 border-border py-4 text-ui-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg",
        RAIL_PLACE[side],
        className ?? "hidden lg:flex",
      )}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />
      {count !== undefined ? (
        <span className="text-meta text-faint tabular-nums">{count}</span>
      ) : null}
      <span className="whitespace-nowrap [writing-mode:vertical-rl]">{label}</span>
    </button>
  );
}
