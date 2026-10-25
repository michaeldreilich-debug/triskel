import { cn } from "@/lib/cn";

/** Tabelle; scrollt auf schmalen Bildschirmen horizontal in sich, nie die Seite. */
export function Table({
  className,
  label = "Tabelle",
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { label?: string }) {
  return (
    <section
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Scroll-Container muss per Tastatur scrollbar sein
      tabIndex={0}
      aria-label={label}
      className="w-full overflow-x-auto rounded-card border border-border"
    >
      <table
        className={cn("w-full min-w-max border-collapse text-left text-ui", className)}
        {...props}
      />
    </section>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-surface" {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-border last:border-b-0 hover:bg-surface/60", className)}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-border px-3 py-2 text-meta font-medium uppercase tracking-widest text-faint",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}
