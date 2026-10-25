import { cn } from "@/lib/cn";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded-control border border-border px-1.5 font-mono text-meta text-faint",
        className,
      )}
      {...props}
    />
  );
}
