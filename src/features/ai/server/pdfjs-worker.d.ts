/** Worker-Modul von pdf.js ohne eigene Typen – nur für `pdf-text.ts` (läuft im selben Prozess). */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
