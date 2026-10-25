import type { Metadata } from "next";
import { TrashPage } from "@/features/trash/trash-page";

export const metadata: Metadata = { title: "Papierkorb" };

export default function TrashRoute() {
  return <TrashPage />;
}
