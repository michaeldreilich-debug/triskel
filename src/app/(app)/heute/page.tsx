import type { Metadata } from "next";
import { TodayPage } from "@/features/today/today-page";

export const metadata: Metadata = { title: "Heute" };

export default function HeutePage() {
  return <TodayPage />;
}
