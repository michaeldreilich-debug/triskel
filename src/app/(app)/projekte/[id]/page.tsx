import type { Metadata } from "next";
import { ProjectPage } from "@/features/projects/components/project-page";

export const metadata: Metadata = { title: "Projekt" };

export default async function ProjektPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectPage key={id} projectId={id} />;
}
