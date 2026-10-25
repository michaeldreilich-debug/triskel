"use client";

import { Check } from "lucide-react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { cn } from "@/lib/cn";

export interface CheckboxProps extends React.ComponentProps<typeof RadixCheckbox.Root> {
  label?: React.ReactNode;
}

export function Checkbox({ label, className, id, ...props }: CheckboxProps) {
  const box = (
    <RadixCheckbox.Root
      id={id}
      className={cn(
        "peer inline-flex size-5 shrink-0 items-center justify-center rounded-control border-[1.5px] border-faint",
        "transition-colors hover:border-muted data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator className="text-accent-fg">
        <Check size={14} strokeWidth={3} aria-hidden />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );

  if (!label) return box;
  return (
    <label
      htmlFor={id}
      className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-ui md:min-h-8"
    >
      {box}
      <span className="peer-data-[state=checked]:text-faint peer-data-[state=checked]:line-through">
        {label}
      </span>
    </label>
  );
}
