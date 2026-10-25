import type { Metadata } from "next";
import { RecapsPage } from "@/features/recaps/components/recaps-page";

export const metadata: Metadata = { title: "Rückblicke" };

export default function RueckblickePage() {
  return <RecapsPage />;
}
