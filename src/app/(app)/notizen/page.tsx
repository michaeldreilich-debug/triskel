import type { Metadata } from "next";
import { NotesDatabasePage } from "@/features/notes/components/note-database";

export const metadata: Metadata = { title: "Notizen" };

export default function NotizenPage() {
  return <NotesDatabasePage />;
}
