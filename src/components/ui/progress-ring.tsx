import { cn } from "@/lib/cn";
import type { AreaColor } from "./pill";
import type { ProjectStatus } from "./status-badge";

const STROKE: Record<AreaColor, string> = {
  orange: "stroke-area-orange",
  blue: "stroke-area-blue",
};

const R = 9;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Länge des Bogens für einen Anteil 0–1 (auf zwei Stellen, damit das SVG ruhig bleibt). */
export function ringArc(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * CIRCUMFERENCE * 100) / 100;
}

/**
 * Fortschrittsring (Muster 5, Rückmeldung #23) in Bereichsfarbe. Ohne Aufgaben (value null)
 * ist die Spur gestrichelt. Ersetzt den Balken in Listen, auf Heute und in der Seitenleiste.
 */
export function ProgressRing({
  value,
  color = "blue",
  label,
  size = "md",
  decorative = false,
  className,
}: {
  value: number | null;
  color?: AreaColor;
  label: string;
  /** nur Schmuck neben einem Namen, der schon dasteht (z. B. Seitenleiste): für Screenreader aus */
  decorative?: boolean;
  /** xs = 12 px (Seitenleiste), md = 22 px */
  size?: "xs" | "md";
  className?: string;
}) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  const arc = value === null ? 0 : ringArc(value);
  const classes = cn("-rotate-90 shrink-0", size === "xs" ? "size-3" : "size-[22px]", className);
  const strokeWidth = size === "xs" ? 3.5 : 2.5;
  const circles = (
    <>
      <circle
        cx="11"
        cy="11"
        r={R}
        className="fill-none stroke-border-strong"
        strokeWidth={strokeWidth}
        strokeDasharray={value === null ? "2.5 2.2" : undefined}
      />
      {arc > 0 ? (
        <circle
          cx="11"
          cy="11"
          r={R}
          className={cn("fill-none", STROKE[color])}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${CIRCUMFERENCE.toFixed(2)}`}
        />
      ) : null}
    </>
  );
  if (decorative) {
    return (
      <svg viewBox="0 0 22 22" aria-hidden className={classes}>
        {circles}
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 22 22"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={pct === null ? "keine Aufgaben" : `${pct} %`}
      className={classes}
    >
      {circles}
    </svg>
  );
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  idee: "Idee",
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
  archiv: "Archiv",
};

/**
 * Projekt-Status als Form (Muster 5): Idee gepunktet, geplant gestrichelt, aktiv = Ring mit
 * Fortschritt, pausiert mit Pause-Strichen, abgeschlossen grün mit Haken, Archiv blass.
 * Ohne `color` neutral (z. B. im Gruppenkopf).
 */
export function ProjectStatusIcon({
  status,
  color,
  progress = null,
  label,
  size = "md",
  className,
}: {
  status: ProjectStatus;
  color?: AreaColor;
  progress?: number | null;
  label?: string;
  /** sm = 16 px (Gruppenkopf), md = 22 px */
  size?: "sm" | "md";
  className?: string;
}) {
  if (status === "aktiv" && color) {
    return (
      <ProgressRing
        value={progress}
        color={color}
        label={label ?? STATUS_LABELS.aktiv}
        className={className}
      />
    );
  }
  const stroke = color ? STROKE[color] : "stroke-muted";
  const name = label ?? STATUS_LABELS[status];
  return (
    <svg
      viewBox="0 0 22 22"
      role="img"
      aria-label={name}
      className={cn(
        "shrink-0 fill-none",
        size === "sm" ? "size-4" : "size-[22px]",
        stroke,
        className,
      )}
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <title>{name}</title>
      {status === "idee" ? (
        <circle cx="11" cy="11" r="8" strokeDasharray="0.1 3.2" strokeWidth={2} />
      ) : status === "geplant" ? (
        <circle cx="11" cy="11" r="8" strokeDasharray="2.6 2.4" />
      ) : status === "aktiv" ? (
        <>
          <circle cx="11" cy="11" r="8" className="stroke-border-strong" strokeWidth={2.2} />
          <path d="M11 3a8 8 0 0 1 8 8" strokeWidth={2.2} />
        </>
      ) : status === "pausiert" ? (
        <>
          <circle cx="11" cy="11" r="8" />
          <path d="M9 8v6M13 8v6" />
        </>
      ) : status === "abgeschlossen" ? (
        <>
          <circle cx="11" cy="11" r="8.5" className="fill-success stroke-none" />
          <path d="M7.5 11.3l2.4 2.4 4.8-5" className="stroke-accent-fg" strokeWidth={1.8} />
        </>
      ) : (
        <>
          <rect x="4" y="5" width="14" height="4" rx="1" />
          <path d="M5.5 9v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9M9.5 12.5h3" />
        </>
      )}
    </svg>
  );
}
