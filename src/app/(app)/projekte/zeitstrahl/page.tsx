import type { Metadata } from "next";
import { TimelinePage } from "@/features/timeline/components/timeline-page";

export const metadata: Metadata = { title: "Zeitstrahl" };

export default function ZeitstrahlPage() {
  return <TimelinePage />;
}
