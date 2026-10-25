"use client";

import { forwardRef } from "react";
import { useBufferedText } from "./buffered";

/** <input> mit lokalem Entwurf für Cache-Werte (siehe useBufferedText). */
export const BufferedInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
  }
>(function BufferedInput({ value, onValueChange, onFocus, onBlur, ...props }, ref) {
  const field = useBufferedText(value, onValueChange);
  return (
    <input
      ref={ref}
      {...props}
      value={field.value}
      onChange={field.onChange}
      onFocus={(event) => {
        field.onFocus();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        field.onBlur();
        onBlur?.(event);
      }}
    />
  );
});
