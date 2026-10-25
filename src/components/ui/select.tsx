"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select as RadixSelect } from "radix-ui";
import { cn } from "@/lib/cn";
import { controlClasses, quietControlClasses, titleControlClasses } from "./input";

export interface SelectOption {
  value: string;
  label: string;
  /** z. B. Bereichspunkt vor dem Namen */
  icon?: React.ReactNode;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
  /** quiet = Wert ohne Rahmen (Eigenschaften), title = Überschrift, default = Formularfeld */
  variant?: "default" | "quiet" | "title";
  className?: string;
}

export function Select({
  options,
  placeholder = "Auswählen …",
  className,
  id,
  variant = "default",
  ...props
}: SelectProps) {
  return (
    <RadixSelect.Root
      value={props.value}
      defaultValue={props.defaultValue}
      onValueChange={props.onValueChange}
      disabled={props.disabled}
    >
      <RadixSelect.Trigger
        id={id}
        aria-label={props["aria-label"]}
        className={cn(
          variant === "quiet"
            ? quietControlClasses
            : variant === "title"
              ? titleControlClasses
              : controlClasses,
          "inline-flex h-11 items-center justify-between gap-2 text-left md:h-9 data-[placeholder]:text-faint",
          "[&>span:first-child]:min-w-0 [&>span:first-child]:truncate",
          variant === "quiet" && "group md:h-8",
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon
          className={cn(
            "shrink-0 text-faint",
            variant === "quiet" &&
              "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:opacity-100",
          )}
        >
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]",
            "overflow-hidden rounded-card border border-border bg-surface p-1 text-fg shadow-float data-[state=open]:animate-pop-in",
          )}
        >
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "relative flex min-h-11 cursor-default select-none items-center rounded-control py-1.5 pr-8 pl-2 text-ui outline-none md:min-h-8",
                  "data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50",
                )}
              >
                <RadixSelect.ItemText>
                  {option.icon ? (
                    <span className="inline-flex items-center gap-2">
                      {option.icon}
                      {option.label}
                    </span>
                  ) : (
                    option.label
                  )}
                </RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2 text-muted">
                  <Check size={14} strokeWidth={2} aria-hidden />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
