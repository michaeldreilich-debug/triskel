"use client";

import { Dialog } from "radix-ui";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
  type CropHandle,
  type CropRect,
  FULL_CROP,
  moveCrop,
} from "@/features/outliner/model/crop";
import { cn } from "@/lib/cn";

const CORNERS: Array<{ handle: Exclude<CropHandle, "move">; label: string; className: string }> = [
  { handle: "nw", label: "Ecke oben links", className: "-top-2 -left-2 cursor-nwse-resize" },
  { handle: "ne", label: "Ecke oben rechts", className: "-top-2 -right-2 cursor-nesw-resize" },
  { handle: "sw", label: "Ecke unten links", className: "-bottom-2 -left-2 cursor-nesw-resize" },
  { handle: "se", label: "Ecke unten rechts", className: "-right-2 -bottom-2 cursor-nwse-resize" },
];

const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Drag {
  handle: CropHandle;
  x: number;
  y: number;
  start: CropRect;
  box: DOMRect;
}

/**
 * Bild zuschneiden (Rückmeldung #28): Rahmen an den Ecken ziehen oder als Ganzes verschieben
 * (Maus und Finger); Ecken auch mit den Pfeiltasten (⇧ = große Schritte).
 */
function CropDialog({
  src,
  alt,
  onDone,
}: {
  src: string;
  alt: string;
  onDone: (rect: CropRect | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [rect, setRect] = useState<CropRect>(FULL_CROP);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const done = useRef(false);

  const finish = (result: CropRect | null) => {
    if (done.current) return;
    done.current = true;
    setOpen(false);
    onDone(result);
  };

  const start = (handle: CropHandle) => (event: React.PointerEvent) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, x: event.clientX, y: event.clientY, start: rect, box };
  };
  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    setRect(
      moveCrop(
        current.start,
        current.handle,
        (event.clientX - current.x) / current.box.width,
        (event.clientY - current.y) / current.box.height,
      ),
    );
  };
  const end = () => {
    drag.current = null;
  };
  const nudge = (handle: CropHandle) => (event: React.KeyboardEvent) => {
    const step = KEYS[event.key];
    if (!step) return;
    event.preventDefault();
    const size = event.shiftKey ? 0.1 : 0.01;
    setRect((r) => moveCrop(r, handle, step[0] * size, step[1] * size));
  };
  const pct = (value: number) => `${(value * 100).toFixed(3)}%`;
  const handleEvents = (handle: CropHandle) => ({
    onPointerDown: start(handle),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onKeyDown: nudge(handle),
  });

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : finish(null))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[94dvh] w-[min(94vw,960px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-card border border-border bg-surface p-4 text-fg shadow-float outline-none data-[state=open]:animate-pop-in">
          <div className="flex flex-col gap-0.5">
            <Dialog.Title className="text-heading font-semibold">Bild zuschneiden</Dialog.Title>
            <Dialog.Description className="text-ui-sm text-muted">
              Ecken ziehen oder den Rahmen verschieben. Pfeiltasten bewegen die gewählte Ecke.
            </Dialog.Description>
          </div>
          <div className="flex justify-center">
            <div ref={frame} className="relative inline-block touch-none select-none">
              {/* biome-ignore lint/performance/noImgElement: Blob-URL aus dem privaten Bucket */}
              <img
                src={src}
                alt={alt || "Bild"}
                draggable={false}
                className="block max-h-[62dvh] max-w-full"
              />
              <div className="absolute inset-0 overflow-hidden">
                <div
                  role="img"
                  aria-label="Zuschnitt-Rahmen (verschieben)"
                  data-testid="crop-frame"
                  {...handleEvents("move")}
                  className="absolute cursor-move border-2 border-fg shadow-[0_0_0_9999px_var(--overlay)]"
                  style={{
                    left: pct(rect.x),
                    top: pct(rect.y),
                    width: pct(rect.w),
                    height: pct(rect.h),
                  }}
                />
              </div>
              <div
                className="pointer-events-none absolute"
                style={{
                  left: pct(rect.x),
                  top: pct(rect.y),
                  width: pct(rect.w),
                  height: pct(rect.h),
                }}
              >
                {CORNERS.map((corner) => (
                  <button
                    key={corner.handle}
                    type="button"
                    aria-label={corner.label}
                    {...handleEvents(corner.handle)}
                    className={cn(
                      "pointer-events-auto absolute size-4 touch-none rounded-sm border-2 border-bg bg-fg",
                      "after:absolute after:-inset-3 after:content-['']",
                      corner.className,
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" className="mr-auto" onClick={() => setRect(FULL_CROP)}>
              Zurücksetzen
            </Button>
            <Button onClick={() => finish(null)}>Abbrechen</Button>
            <Button variant="primary" onClick={() => finish(rect)}>
              Zuschneiden
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Dialog öffnen (auch aus dem Editor heraus, ohne React drumherum); liefert den Rahmen. */
export function openCropDialog(src: string, alt: string): Promise<CropRect | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    root.render(
      <CropDialog
        src={src}
        alt={alt}
        onDone={(rect) => {
          resolve(rect);
          // nach der Schließ-Animation aushängen
          setTimeout(() => {
            root.unmount();
            host.remove();
          }, 200);
        }}
      />,
    );
  });
}
