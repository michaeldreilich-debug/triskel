/**
 * Text aus einem PDF für die KI (#71, `get_attachment`): pdf.js (Legacy-Build für Node) liest die
 * Textebene der ersten Seiten – ohne Zeichnen, ohne Schriften, ohne Worker-Thread (der Worker
 * läuft im selben Prozess über `globalThis.pdfjsWorker`, damit der Build ihn mitnimmt). Mit
 * Zeitlimit; scheitert es, liefert die Funktion `null` statt eines Absturzes.
 */
import { MAX_TEXT_CHARS } from "./media";

export const PDF_MAX_PAGES = 50;
const PDF_TIMEOUT_MS = 20_000;

export interface PdfText {
  text: string;
  /** Seiten insgesamt */
  pages: number;
  /** gelesene Seiten */
  read: number;
  truncated: boolean;
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let loader: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  loader ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]).then(([lib, worker]) => {
    const scope = globalThis as { pdfjsWorker?: unknown };
    scope.pdfjsWorker ??= worker;
    return lib;
  });
  loader.catch(() => {
    loader = null;
  });
  return loader;
}

export async function pdfText(
  bytes: Uint8Array,
  options: { maxPages?: number; maxChars?: number; timeoutMs?: number } = {},
): Promise<PdfText | null> {
  const maxPages = options.maxPages ?? PDF_MAX_PAGES;
  const maxChars = options.maxChars ?? MAX_TEXT_CHARS;
  let lib: PdfJs;
  try {
    lib = await loadPdfJs();
  } catch {
    return null;
  }
  // pdf.js übernimmt den Puffer – eine Kopie, damit der Aufrufer seine Bytes behält
  const task = lib.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: lib.VerbosityLevel.ERRORS,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), options.timeoutMs ?? PDF_TIMEOUT_MS);
  });
  const read = (async (): Promise<PdfText> => {
    const doc = await task.promise;
    const parts: string[] = [];
    let length = 0;
    let pagesRead = 0;
    let truncated = doc.numPages > maxPages;
    for (let number = 1; number <= Math.min(doc.numPages, maxPages); number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      page.cleanup();
      pagesRead = number;
      const chunk = `--- Seite ${number} ---\n${text}`;
      if (length + chunk.length > maxChars) {
        parts.push(chunk.slice(0, Math.max(0, maxChars - length)));
        truncated = true;
        break;
      }
      parts.push(chunk);
      length += chunk.length + 2;
    }
    return { text: parts.join("\n\n"), pages: doc.numPages, read: pagesRead, truncated };
  })();
  try {
    const result = await Promise.race([read, timeout]);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    read.catch(() => {});
    void task.destroy().catch(() => {});
  }
}
