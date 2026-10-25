"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

/**
 * Ablagefläche für Dateien (Rückmeldung #27): Bilder, PDFs und andere Dateien lassen sich
 * irgendwo auf die Notiz oder Aufgabe ziehen, nicht nur genau in den Text. Was der Editor selbst
 * annimmt (Ablegen im Text), bleibt beim Editor; der Rest landet über `onFiles` am Ende.
 */
export function FileDrop({
  onFiles,
  label = "Loslassen zum Einfügen",
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Ziehen ist eine Abkürzung; Einfügen geht auch über „＋“ und ⌘V
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        depth.current = 0;
        setOver(false);
        if (event.defaultPrevented || !hasFiles(event)) return;
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over ? (
        <div
          aria-hidden
          data-testid="file-drop-overlay"
          className="pointer-events-none absolute inset-2 z-20 flex items-start justify-center rounded-card border-2 border-dashed border-link bg-bg/60 pt-24 text-ui font-medium text-fg"
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}
