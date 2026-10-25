"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Griff am rechten Rand einer Spalte (#43): ziehen ändert die Breite, Pfeiltasten in 16-px-
 * Schritten, Doppelklick bzw. Enter stellt die Standardbreite wieder her. `edge="left"` für
 * Spalten am rechten Rand (Einplanen, #61): nach links ziehen macht sie breiter.
 */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  onChange,
  onReset,
  edge = "right",
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  edge?: "right" | "left";
  className?: string;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const sign = edge === "left" ? -1 : 1;
  return (
    // biome-ignore lint/a11y/useSemanticElements: ein verschiebbarer Trenner ist kein <hr>
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Ziehen ändert die Breite · Doppelklick: Standard"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: value };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onChange(drag.current.width + sign * (event.clientX - drag.current.x));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16;
        if (event.key === "ArrowLeft") onChange(value - sign * step);
        else if (event.key === "ArrowRight") onChange(value + sign * step);
        else if (event.key === "Home") onChange(min);
        else if (event.key === "End") onChange(max);
        else if (event.key === "Enter") onReset();
        else return;
        event.preventDefault();
      }}
      className={cn(
        "group/handle absolute inset-y-0 z-10 w-3 cursor-col-resize touch-none outline-none",
        edge === "left" ? "-left-1.5" : "-right-1.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover/handle:bg-border-strong group-focus-visible/handle:bg-muted group-active/handle:bg-muted"
      />
    </div>
  );
}
