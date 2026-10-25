"use client";

import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { de } from "react-day-picker/locale";
import { cn } from "@/lib/cn";
import { formatDateShort, type IsoDate, parseIsoDate, toIsoDate } from "@/lib/dates";
import { Button } from "./button";
import { controlClasses, quietControlClasses } from "./input";

export interface DatePickerProps {
  value: IsoDate | null;
  onChange: (value: IsoDate | null) => void;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  /** quiet = Wert ohne Rahmen (Eigenschaften), default = Formularfeld */
  variant?: "default" | "quiet";
  className?: string;
  /** Inhalt des Knopfs statt Symbol und Datum (z. B. die Fälligkeit in der Tabelle, #87) */
  display?: React.ReactNode;
}

export function DatePicker({
  value,
  onChange,
  id,
  placeholder = "Datum wählen",
  variant = "default",
  className,
  display,
  ...props
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value) ?? undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        aria-label={props["aria-label"]}
        className={cn(
          variant === "quiet" ? quietControlClasses : controlClasses,
          "inline-flex h-11 items-center gap-2 text-left md:h-9",
          variant === "quiet" && "md:h-8",
          className,
        )}
      >
        {display ?? (
          <>
            <CalendarDays size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
            {value ? (
              <span className="text-ui tabular-nums">{formatDateShort(value)}</span>
            ) : (
              <span className="text-faint">{placeholder}</span>
            )}
          </>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          collisionPadding={16}
          className="z-50 rounded-card border border-border bg-surface p-3 text-fg shadow-float data-[state=open]:animate-pop-in"
        >
          <DayPicker
            mode="single"
            // U-3: ein Klick auf den schon gesetzten Tag löscht das Datum nicht (Entfernen über den Knopf)
            required
            locale={de}
            weekStartsOn={1}
            showOutsideDays
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              onChange(date ? toIsoDate(date) : null);
              setOpen(false);
            }}
            classNames={{
              root: "text-ui",
              months: "relative",
              month_caption: "flex h-9 items-center px-1 font-medium",
              nav: "absolute right-0 top-0 flex gap-1",
              button_previous:
                "inline-flex size-9 items-center justify-center rounded-control text-muted hover:bg-surface-2",
              button_next:
                "inline-flex size-9 items-center justify-center rounded-control text-muted hover:bg-surface-2",
              weekday: "size-9 text-meta font-normal text-faint",
              day: "p-0 text-center",
              day_button:
                "inline-flex size-9 items-center justify-center rounded-control text-ui-sm tabular-nums hover:bg-surface-2 aria-selected:bg-accent aria-selected:text-accent-fg",
              selected: "font-semibold",
              today: "text-area-orange",
              outside: "text-faint/60",
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === "left" ? (
                  <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
                ) : (
                  <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
                ),
            }}
          />
          <div className="mt-2 flex justify-between gap-2 border-t border-border pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(toIsoDate(new Date()));
                setOpen(false);
              }}
            >
              Heute
            </Button>
            {value ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <X size={14} strokeWidth={1.5} aria-hidden />
                Entfernen
              </Button>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
