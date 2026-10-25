"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { THEME_LABELS, THEMES, type Theme } from "@/lib/theme";
import { useUi } from "@/lib/ui-store";

export function ThemeSwitch() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  return (
    <SegmentedControl<Theme>
      aria-label="Darstellung"
      value={theme}
      onValueChange={setTheme}
      options={THEMES.map((t) => ({ value: t, label: THEME_LABELS[t] }))}
    />
  );
}
