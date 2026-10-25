import { cn } from "@/lib/cn";

/** Platzhalter beim Laden (statt Spinner). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      // Reiter (#63): Scroll-Stelle erst setzen, wenn kein Platzhalter mehr lädt
      data-skeleton=""
      className={cn("animate-pulse rounded-control bg-surface-2", className)}
      {...props}
    />
  );
}
