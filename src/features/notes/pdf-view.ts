"use client";

/**
 * PDF komplett in der Notiz ansehen (Rückmeldung #27): pdf.js zeichnet jede Seite in ein Canvas.
 * Die Bibliothek lädt erst, wenn ein PDF ganz angezeigt wird. Seiten werden nur in der Nähe des
 * sichtbaren Bereichs gezeichnet und weit außerhalb wieder freigegeben (Speicher am iPhone).
 * Seit #36 ein Fenster in Seitenhöhe (höchstens 80 % des Bildschirms): Darin wird geblättert,
 * eine Seite passt immer ganz hinein, „Seite 3 von 12“ meldet `onPage`.
 */
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let library: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  library ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return lib;
  });
  library.catch(() => {
    library = null;
  });
  return library;
}

/** Höchstens so breit zeichnen (CSS-Pixel) und höchstens doppelte Pixeldichte. */
const MAX_WIDTH = 1000;
const MAX_DPR = 2;
/** Fensterhöhe höchstens dieser Anteil des Bildschirms; Abstand um und zwischen den Seiten. */
const MAX_VIEWPORT_SHARE = 0.8;
const GAP = 8;

interface PageState {
  canvas: HTMLCanvasElement;
  number: number;
  task: RenderTask | null;
  /** läuft gerade (gesetzt, bevor die Seite geladen ist – nie zwei draw je Canvas, O-16) */
  drawing: Promise<void> | null;
  drawn: boolean;
  /** CSS-Breite beim Zeichnen – nach deutlich anderer Breite neu zeichnen (Drehen) */
  drawnWidth: number;
  /** im Bereich des IntersectionObservers */
  visible: boolean;
  /** laufendes Zeichnen wurde abgebrochen – danach neu, falls die Seite sichtbar ist */
  retry: boolean;
  /** Höhe / Breite der Seite (erst die der ersten Seite, nach dem Zeichnen die eigene) */
  ratio: number;
}

/** Nach einer Größenänderung neu zeichnen? Ab 15 % anderer Breite wäre die Seite sichtbar unscharf. */
export function needsRedraw(drawnWidth: number, width: number): boolean {
  if (drawnWidth <= 0 || width <= 0) return false;
  return Math.abs(width - drawnWidth) / drawnWidth > 0.15;
}

/**
 * Größe des Fensters und der Seiten: Die Seite füllt die Breite, außer sie wäre höher als das
 * Fenster – dann passt sie in der Höhe hinein (zentriert). Reine Rechnung, ohne DOM.
 */
export function pdfWindowSize(
  innerWidth: number,
  viewportHeight: number,
  firstRatio: number,
): { height: number; page: (ratio: number) => { width: number; height: number } } {
  const width = Math.max(innerWidth, 1);
  const height = Math.max(
    Math.min(width * firstRatio, viewportHeight * MAX_VIEWPORT_SHARE - 2 * GAP),
    80,
  );
  return {
    height,
    page: (ratio) => {
      const fitted = Math.min(height, width * ratio);
      return { width: fitted / ratio, height: fitted };
    },
  };
}

/** Seite in der Mitte des Fensters (1-basiert) aus den Oberkanten der Seiten. */
export function currentPdfPage(tops: number[], scrollTop: number, windowHeight: number): number {
  const middle = scrollTop + windowHeight / 2;
  let current = 1;
  tops.forEach((top, index) => {
    if (top <= middle) current = index + 1;
  });
  return current;
}

/**
 * Zeichnet das PDF in `container` und liefert die Aufräum-Funktion. `status` zeigt Laden und
 * Fehler als Text.
 */
export function mountPdf(
  container: HTMLElement,
  load: () => Promise<Blob>,
  status: (text: string) => void,
  onPage?: (page: number, total: number) => void,
): () => void {
  let destroyed = false;
  let doc: PDFDocumentProxy | null = null;
  let loading: PDFDocumentLoadingTask | null = null;
  let observer: IntersectionObserver | null = null;
  let resize: ResizeObserver | null = null;
  let shownPage = 0;
  const pages: PageState[] = [];
  status("PDF wird geladen …");

  /** Fenster und Seiten an die Breite anpassen (beim Laden, bei jeder Größenänderung). */
  const layout = () => {
    const first = pages[0];
    if (!first) return;
    const size = pdfWindowSize(container.clientWidth - 2 * GAP, window.innerHeight, first.ratio);
    container.style.height = `${Math.round(size.height + 2 * GAP)}px`;
    for (const page of pages) {
      const box = size.page(page.ratio);
      page.canvas.style.width = `${Math.round(box.width)}px`;
      page.canvas.style.height = `${Math.round(box.height)}px`;
    }
    report();
  };

  const report = () => {
    if (pages.length === 0) return;
    const page = currentPdfPage(
      // das Fenster ist offsetParent der Seiten (position: relative)
      pages.map((p) => p.canvas.offsetTop),
      container.scrollTop,
      container.clientHeight,
    );
    if (page === shownPage) return;
    shownPage = page;
    onPage?.(page, pages.length);
  };

  const draw = (page: PageState): Promise<void> | undefined => {
    if (!doc || page.drawing || page.drawn) return page.drawing ?? undefined;
    page.drawing = render(page, doc).finally(() => {
      page.drawing = null;
      if (page.retry && page.visible && !page.drawn && !destroyed) {
        page.retry = false;
        void draw(page);
      }
    });
    return page.drawing;
  };

  const render = async (page: PageState, pdf: PDFDocumentProxy) => {
    const pdfPage = await pdf.getPage(page.number);
    // inzwischen weit weg gescrollt oder geschlossen: nicht mehr zeichnen
    if (destroyed || !page.visible) return;
    const base = pdfPage.getViewport({ scale: 1 });
    const cssWidth = Math.min(page.canvas.clientWidth || container.clientWidth || 600, MAX_WIDTH);
    const scale = (cssWidth * Math.min(window.devicePixelRatio || 1, MAX_DPR)) / base.width;
    const viewport = pdfPage.getViewport({ scale });
    page.canvas.width = Math.floor(viewport.width);
    page.canvas.height = Math.floor(viewport.height);
    const ratio = base.height / base.width;
    if (Math.abs(ratio - page.ratio) > 0.001) {
      page.ratio = ratio;
      layout();
    }
    page.task = pdfPage.render({ canvas: page.canvas, viewport });
    try {
      await page.task.promise;
      page.drawn = true;
      page.drawnWidth = cssWidth;
    } catch {
      // abgebrochen (Seite weit weg gescrollt) – beim nächsten Mal neu
    } finally {
      page.task = null;
    }
  };

  const release = (page: PageState) => {
    if (page.drawing) page.retry = true;
    page.task?.cancel();
    page.task = null;
    if (!page.drawn) return;
    page.drawn = false;
    page.canvas.width = 0;
    page.canvas.height = 0;
  };

  (async () => {
    const [lib, blob] = await Promise.all([loadPdfJs(), load()]);
    if (destroyed) return;
    const data = new Uint8Array(await blob.arrayBuffer());
    loading = lib.getDocument({ data, useSystemFonts: true });
    const loaded = await loading.promise;
    if (destroyed) return;
    doc = loaded;
    const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
    if (destroyed) return;
    status("");
    for (let number = 1; number <= loaded.numPages; number++) {
      const canvas = document.createElement("canvas");
      canvas.className = "ol-pdf-page";
      canvas.dataset.page = String(number);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Seite ${number} von ${loaded.numPages}`);
      canvas.width = 0;
      canvas.height = 0;
      container.append(canvas);
      // Platz schon vor dem Zeichnen (Seitenverhältnis der ersten Seite)
      pages.push({
        canvas,
        number,
        task: null,
        drawing: null,
        drawn: false,
        drawnWidth: 0,
        visible: false,
        retry: false,
        ratio: first.height / first.width,
      });
    }
    container.dataset.window = "true";
    layout();
    container.addEventListener("scroll", report, { passive: true });
    resize = new ResizeObserver(() => {
      layout();
      // nach dem Drehen o. Ä.: sichtbare Seiten in der neuen Breite neu zeichnen (sonst unscharf)
      for (const page of pages) {
        if (!page.drawn || !needsRedraw(page.drawnWidth, page.canvas.clientWidth)) continue;
        release(page);
        if (page.visible) void draw(page);
      }
    });
    resize.observe(container);
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = pages.find((p) => p.canvas === entry.target);
          if (!page) continue;
          page.visible = entry.isIntersecting;
          if (entry.isIntersecting) void draw(page);
          else release(page);
        }
      },
      // im Fenster: zwei Seiten vor und nach der sichtbaren zeichnen
      { root: container, rootMargin: "200% 0px" },
    );
    for (const page of pages) observer.observe(page.canvas);
  })().catch(() => {
    if (!destroyed) status("PDF konnte nicht angezeigt werden.");
  });

  return () => {
    destroyed = true;
    observer?.disconnect();
    resize?.disconnect();
    container.removeEventListener("scroll", report);
    container.style.height = "";
    delete container.dataset.window;
    for (const page of pages) page.task?.cancel();
    void loading?.destroy();
    container.replaceChildren();
  };
}
