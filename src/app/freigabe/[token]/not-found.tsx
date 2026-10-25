import { TriskelMark } from "@/components/triskel-mark";

/**
 * Freigabe unbekannt, beendet oder Notiz im Papierkorb (#94): von außen immer dieselbe schlichte
 * Seite – kein Hinweis, welcher Fall vorliegt, kein Link in die App.
 */
export default function SharedNoteNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 pt-[calc(3rem+env(safe-area-inset-top))] pb-[calc(3rem+env(safe-area-inset-bottom))] text-center">
      <TriskelMark size={28} />
      <h1 className="heading text-heading">Diese Freigabe gibt es nicht (mehr).</h1>
      <p className="max-w-sm text-ui text-muted">
        Der Link ist falsch, oder die Freigabe wurde beendet.
      </p>
    </main>
  );
}
