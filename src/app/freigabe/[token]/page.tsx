import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TriskelMark } from "@/components/triskel-mark";
import { SharedOutline } from "@/features/share/components/shared-outline";
import { sharedDoc, sharedTitle } from "@/features/share/model";
import { loadSharedNote } from "@/features/share/server";

/**
 * Öffentlich freigegebene Notiz (#94, E42, docs/konzept-freigabe.md): Titel und Inhalt, nur
 * lesend, ohne Anmeldung und ohne App-Daten (keine Shell, nur die Funktion `shared_note` mit dem
 * publishable key). Ohne Eigenschaften: kein Typ, Bereich, Thema, Projekt, Tags-Feld, keine
 * Datumsangaben, keine Rückverweise. Unbekannt, beendet oder im Papierkorb → dieselbe 404-Seite.
 * Kopfzeilen (noindex, no-referrer, no-store) aus next.config.ts, CSP aus dem Proxy.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const note = await loadSharedNote(token);
  return {
    // kein notFound() hier: das entscheidet die Seite (Status 404 vor dem ersten Byte)
    title: note ? sharedTitle(note) : "Freigabe",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function SharedNotePage({ params }: Props) {
  const { token } = await params;
  const note = await loadSharedNote(token);
  if (!note) notFound();
  const { doc, taskDone } = sharedDoc(note);
  return (
    <main className="shared-note mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] md:px-8 md:pt-[calc(3rem+env(safe-area-inset-top))] md:pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <h1 className="heading text-title-sm tracking-tight md:text-title">{sharedTitle(note)}</h1>
      {note.blocks.length > 0 ? (
        <SharedOutline doc={doc} taskDone={taskDone} token={token} />
      ) : (
        <p className="text-ui text-faint">Diese Notiz ist leer.</p>
      )}
      <footer className="mt-6 flex items-center gap-2 border-t border-border pt-4 text-meta text-faint">
        <TriskelMark size={14} />
        Mit Triskel geteilt
      </footer>
    </main>
  );
}
