import type { Metadata } from "next";
import { WeeklyReviewPage } from "@/features/recaps/components/weekly-review";

export const metadata: Metadata = { title: "Wochenreview" };

export default function WochenreviewPage() {
  return <WeeklyReviewPage />;
}
