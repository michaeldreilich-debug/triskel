"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import type { AreaSummary } from "@/features/areas/defaults";
import { useUi } from "@/lib/ui-store";

const ALL = "alle";

/** Bereichs-Schalter: Alles / Beruf / Privat – filtert die ganze App. */
export function AreaSwitch({ areas, loading }: { areas: AreaSummary[]; loading?: boolean }) {
  const area = useUi((s) => s.area);
  const setArea = useUi((s) => s.setArea);
  const current = area && areas.some((a) => a.id === area) ? area : ALL;

  if (loading) {
    return (
      <div
        data-testid="area-switch-loading"
        className="flex h-11 rounded-full border border-border p-0.5 md:h-8"
      >
        <Skeleton className="flex-1 rounded-full" />
      </div>
    );
  }

  return (
    <SegmentedControl
      aria-label="Bereich"
      value={current}
      onValueChange={(value) => setArea(value === ALL ? null : value)}
      options={[
        { value: ALL, label: "Alles" },
        ...areas.map((a) => ({ value: a.id, label: a.name })),
      ]}
    />
  );
}
