"use client";

import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/cn";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentOption<T>[];
  "aria-label": string;
  className?: string;
}

/** Umschalter als Pillen-Gruppe (Bereichs-Schalter, Theme). Aktiv = helle bzw. dunkle Pille. */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      aria-label={props["aria-label"]}
      orientation="horizontal"
      className={cn("flex gap-0.5 rounded-full border border-border bg-bg p-0.5", className)}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "min-h-11 flex-1 rounded-full px-2 text-ui-sm text-muted transition-colors md:min-h-7",
            "hover:text-fg data-[state=checked]:bg-accent data-[state=checked]:font-medium data-[state=checked]:text-accent-fg",
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
