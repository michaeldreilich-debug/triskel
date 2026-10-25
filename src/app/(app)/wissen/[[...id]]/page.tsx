import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KnowledgeView } from "@/features/notes/components/knowledge-view";

export const metadata: Metadata = { title: "Wissen" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /wissen (Liste) und /wissen/<Notiz-ID>; Thema als ?thema=<ID|ohne>. */
export default async function WissenPage({ params }: { params: Promise<{ id?: string[] }> }) {
  const { id } = await params;
  if (id && (id.length > 1 || !UUID.test(id[0] ?? ""))) notFound();
  // Ohne eigene <Suspense>-Grenze: Mit ihr hydrierte die Ansicht erst, wenn ihr Code geladen war.
  // Kam er nach der Seitenleiste, hatten deren Abfragen schon Daten, der Server hatte aber den
  // Ladezustand gerendert (Hydration-Fehler). Wie die anderen Seiten hydriert sie jetzt mit dem
  // Rest der Seite; die Route ist dynamisch, useSearchParams braucht hier kein Suspense.
  return <KnowledgeView noteId={id?.[0] ?? null} />;
}
