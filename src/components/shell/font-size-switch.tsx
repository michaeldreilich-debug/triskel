"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { FONT_SIZE_LABELS, FONT_SIZES, type FontSize } from "@/lib/ui-prefs";
import { useUi } from "@/lib/ui-store";

/** Schriftgröße je Gerät (F5, #57): Klein · Normal · Groß · Sehr groß. */
export function FontSizeSwitch() {
  const fontSize = useUi((s) => s.fontSize);
  const setFontSize = useUi((s) => s.setFontSize);
  return (
    <SegmentedControl<FontSize>
      aria-label="Schriftgröße"
      value={fontSize}
      onValueChange={setFontSize}
      options={FONT_SIZES.map((size) => ({ value: size, label: FONT_SIZE_LABELS[size] }))}
    />
  );
}
