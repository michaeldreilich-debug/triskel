import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Leerer Zustand mit Handlungsaufforderung. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="text-faint [&_svg]:size-6">{icon}</div> : null}
      <div className="flex flex-col gap-1">
        <p className="heading text-heading">{title}</p>
        {description ? <p className="max-w-sm text-ui text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
