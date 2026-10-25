import type { Metadata } from "next";
import { CalendarPage } from "@/features/calendar/components/calendar-page";

export const metadata: Metadata = { title: "Kalender" };

export default function KalenderPage() {
  return <CalendarPage />;
}
