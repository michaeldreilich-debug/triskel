import type { Metadata } from "next";
import { TasksPage } from "@/features/tasks/components/tasks-page";

export const metadata: Metadata = { title: "Aufgaben" };

export default function AufgabenPage() {
  return <TasksPage />;
}
