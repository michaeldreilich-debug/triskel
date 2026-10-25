import { cn } from "@/lib/cn";

/** Seitenrahmen: volle Breite des Inhaltsbereichs (Rückmeldung #20, vorher max. 760 px zentriert). */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full flex-col gap-7 px-4 py-6 md:px-8 md:py-8 lg:px-10", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  meta,
  summary,
  actions,
}: {
  title: string;
  meta?: React.ReactNode;
  /** Zeile unter dem Titel (Muster 1, #23), z. B. `SummaryLine` */
  summary?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {meta ? <p className="text-ui-sm text-faint">{meta}</p> : null}
        <h1 className="heading text-title-sm tracking-tight md:text-title-lg">{title}</h1>
        {summary}
      </div>
      {actions}
    </header>
  );
}
