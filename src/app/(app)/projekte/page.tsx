import type { Metadata } from "next";
import { ProjectsPage } from "@/features/projects/components/projects-page";

export const metadata: Metadata = { title: "Projekte" };

export default function ProjektePage() {
  return <ProjectsPage />;
}
