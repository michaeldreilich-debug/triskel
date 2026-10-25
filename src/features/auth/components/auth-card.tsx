import { useId } from "react";
import { TriskelMark } from "@/components/triskel-mark";

/** Rahmen der Anmelde-Seiten (Login, Zweiter Faktor): Logo, Karte mit Titel und Beschreibung. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 pt-[calc(3rem+env(safe-area-inset-top))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="flex w-full min-w-0 max-w-sm flex-col gap-8">
        <div className="flex items-center justify-center gap-2.5">
          <TriskelMark size={32} />
          <span className="heading text-title-sm">Triskel</span>
        </div>
        <section
          aria-labelledby={titleId}
          className="flex min-w-0 flex-col gap-6 rounded-card border border-border bg-surface p-6"
        >
          <div className="flex flex-col gap-1">
            <h1 id={titleId} className="heading text-heading">
              {title}
            </h1>
            <p className="text-ui text-muted">{description}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
