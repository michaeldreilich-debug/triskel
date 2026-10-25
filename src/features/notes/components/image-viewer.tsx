"use client";

import { ChevronLeft, ChevronRight, Minus, Pencil, Plus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { clampView, type ImageView, zoomAt } from "../image-zoom";

export interface ViewerItem {
  path: string;
  alt: string;
}

const FIT: ImageView = { scale: 1, x: 0, y: 0 };

/**
 * Großansicht eines Bildes im Fenster (#59): eingepasst, Mausrad, zwei Finger, +/− und Doppelklick
 * zoomen, Ziehen verschiebt, ← → blättert durch die Bilder der Notiz, Esc, ✕ oder ein Klick
 * daneben schließt. Am Handy „Bearbeiten“: schließt und wählt das Bild für Größe/Zuschnitt aus.
 */
function ImageViewer({
  items,
  start,
  load,
  editable,
  onDone,
}: {
  items: ViewerItem[];
  start: number;
  load: (path: string) => Promise<string>;
  editable: boolean;
  onDone: (result: { edit: number } | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(start);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<ImageView>(FIT);
  // „Bearbeiten“ nur bei Touch (am Desktop erscheinen die Werkzeuge beim Drüberfahren)
  const [touch] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; pinch: number | null; last: { x: number; y: number } }>({
    moved: false,
    pinch: null,
    last: { x: 0, y: 0 },
  });
  const done = useRef(false);
  const item = items[index] ?? items[0];
  const many = items.length > 1;

  const finish = (result: { edit: number } | null) => {
    if (done.current) return;
    done.current = true;
    setOpen(false);
    onDone(result);
  };

  useEffect(() => {
    if (!item) return;
    let current = true;
    setSrc(null);
    setFailed(false);
    setView(FIT);
    load(item.path)
      .then((url) => current && setSrc(url))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [item, load]);

  /** Größen für das Begrenzen: Bühne und eingepasstes Bild (ohne Zoom). */
  const sizes = useCallback(() => {
    const s = stage.current?.getBoundingClientRect();
    const i = img.current;
    return {
      stage: { w: s?.width ?? 0, h: s?.height ?? 0 },
      image: { w: i?.offsetWidth ?? 0, h: i?.offsetHeight ?? 0 },
    };
  }, []);

  /** Punkt relativ zur Bühnenmitte (Zoom um diesen Punkt). */
  const pointOf = useCallback((clientX: number, clientY: number) => {
    const s = stage.current?.getBoundingClientRect();
    if (!s) return { x: 0, y: 0 };
    return { x: clientX - s.left - s.width / 2, y: clientY - s.top - s.height / 2 };
  }, []);

  const zoom = useCallback(
    (factor: number, at = { x: 0, y: 0 }) =>
      setView((v) => clampView(zoomAt(v, v.scale * factor, at), sizes())),
    [sizes],
  );

  const go = (step: number) => {
    if (!many) return;
    setIndex((i) => (i + step + items.length) % items.length);
  };

  // Mausrad zoomt (auch Zwei-Finger-Geste am Trackpad); passiv geht nicht, sonst scrollt die Seite
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      zoom(factor, pointOf(event.clientX, event.clientY));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (event: React.PointerEvent) => {
    // Knöpfe auf der Bühne (Blättern) behalten ihren Klick – kein Festhalten des Zeigers
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { moved: false, pinch: null, last: { x: event.clientX, y: event.clientY } };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (pointers.current.size === 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      g.moved = true;
      zoom(distance / g.pinch, pointOf((a.x + b.x) / 2, (a.y + b.y) / 2));
      g.pinch = distance;
      return;
    }
    const dx = event.clientX - g.last.x;
    const dy = event.clientY - g.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true;
    g.last = { x: event.clientX, y: event.clientY };
    if (view.scale > 1) {
      setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, sizes()));
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = null;
  };

  // Klick neben das Bild schließt (nicht nach Ziehen oder Zoomen mit zwei Fingern)
  const onStageClick = (event: React.MouseEvent) => {
    if (gesture.current.moved) return;
    if (event.target === img.current) return;
    finish(null);
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const at = pointOf(event.clientX, event.clientY);
    setView((v) => clampView(v.scale > 1 ? FIT : zoomAt(v, 2.5, at), sizes()));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") go(-1);
    else if (event.key === "ArrowRight") go(1);
    else if (event.key === "+" || event.key === "=") zoom(1.25);
    else if (event.key === "-") zoom(0.8);
    else if (event.key === "0") setView(FIT);
    else return;
    event.preventDefault();
  };

  const percent = Math.round(view.scale * 100);
  const alt = item?.alt || "Bild";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : finish(null))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onKeyDown={onKeyDown}
          // den Fokus gibt der Editor selbst zurück (Bild ausgewählt), sonst landete er im Leeren
          onCloseAutoFocus={(event) => event.preventDefault()}
          aria-describedby="image-viewer-hint"
          data-testid="image-viewer"
          className="fixed inset-0 z-50 flex flex-col bg-bg text-fg outline-none data-[state=open]:animate-fade-in"
        >
          <div className="flex items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:px-4">
            <Dialog.Title className="min-w-0 flex-1 truncate text-ui-sm text-muted">
              {alt}
              {many ? (
                <span className="ml-2 text-faint tabular-nums">
                  {index + 1} von {items.length}
                </span>
              ) : null}
            </Dialog.Title>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Verkleinern"
              title="Verkleinern (−)"
              onClick={() => zoom(0.8)}
              disabled={view.scale <= 1}
            >
              <Minus size={16} strokeWidth={1.5} aria-hidden />
            </Button>
            <button
              type="button"
              onClick={() => setView(FIT)}
              title="Einpassen (0)"
              aria-label={`Zoom ${percent} % – einpassen`}
              className="min-w-12 rounded-control px-1 text-ui-sm text-muted tabular-nums hover:bg-surface-2 hover:text-fg"
            >
              {percent} %
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Vergrößern"
              title="Vergrößern (+)"
              onClick={() => zoom(1.25)}
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
            </Button>
            {editable && touch ? (
              <Button variant="ghost" size="sm" onClick={() => finish({ edit: index })}>
                <Pencil size={15} strokeWidth={1.5} aria-hidden />
                Bearbeiten
              </Button>
            ) : null}
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Schließen" title="Schließen (Esc)">
                <X size={18} strokeWidth={1.5} aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          {/* biome-ignore lint/a11y/noStaticElementInteractions: Ziehen/Zoomen per Zeiger; Tastatur über +/−/0 und die Knöpfe */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Schließen per Tastatur über Esc und ✕ */}
          <div
            ref={stage}
            data-testid="image-viewer-stage"
            className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none"
            style={{ cursor: view.scale > 1 ? "grab" : "zoom-in" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={onStageClick}
            onDoubleClick={onDoubleClick}
          >
            {src ? (
              // biome-ignore lint/performance/noImgElement: signierte Adresse aus dem privaten Bucket
              <img
                ref={img}
                src={src}
                alt={alt}
                draggable={false}
                className="block max-h-full max-w-full object-contain"
                style={{
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                  transition: gesture.current.moved ? "none" : "transform 120ms ease-out",
                }}
              />
            ) : (
              <p role="status" className="text-ui-sm text-muted">
                {failed ? "Bild nicht gefunden" : "Bild wird geladen …"}
              </p>
            )}
            {many ? (
              <>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Vorheriges Bild"
                  title="Vorheriges Bild (←)"
                  className="absolute top-1/2 left-2 -translate-y-1/2 md:left-4"
                  onClick={(event) => {
                    event.stopPropagation();
                    go(-1);
                  }}
                >
                  <ChevronLeft size={18} strokeWidth={1.5} aria-hidden />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Nächstes Bild"
                  title="Nächstes Bild (→)"
                  className="absolute top-1/2 right-2 -translate-y-1/2 md:right-4"
                  onClick={(event) => {
                    event.stopPropagation();
                    go(1);
                  }}
                >
                  <ChevronRight size={18} strokeWidth={1.5} aria-hidden />
                </Button>
              </>
            ) : null}
          </div>
          <p
            id="image-viewer-hint"
            className="hidden items-center justify-center gap-1.5 px-4 py-2 text-meta text-faint md:flex"
          >
            Mausrad oder <Kbd>+</Kbd> <Kbd>−</Kbd> zoomt · Ziehen verschiebt · Doppelklick
            {many ? (
              <>
                {" "}
                · <Kbd>←</Kbd> <Kbd>→</Kbd> blättert
              </>
            ) : null}{" "}
            · <Kbd>Esc</Kbd> schließt
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Großansicht öffnen (auch aus dem Editor heraus, ohne React drumherum). Liefert `{ edit }`, wenn
 * am Handy „Bearbeiten“ gewählt wurde (Index des zuletzt gezeigten Bildes), sonst null.
 */
export function openImageViewer(options: {
  items: ViewerItem[];
  start: number;
  load: (path: string) => Promise<string>;
  editable: boolean;
}): Promise<{ edit: number } | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    root.render(
      <ImageViewer
        {...options}
        onDone={(result) => {
          // nach der Schließ-Animation aushängen, erst dann antworten (der Editor holt den Fokus,
          // solange das Fenster ihn nicht mehr festhält)
          setTimeout(() => {
            root.unmount();
            host.remove();
            resolve(result);
          }, 200);
        }}
      />,
    );
  });
}
