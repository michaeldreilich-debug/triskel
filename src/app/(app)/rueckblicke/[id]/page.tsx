import type { Metadata } from "next";
import { RecapPage } from "@/features/recaps/components/recap-page";

export const metadata: Metadata = { title: "Rückblick" };

export default async function RueckblickPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecapPage key={id} recapId={id} />;
}
