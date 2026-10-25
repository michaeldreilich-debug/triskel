import { notFound } from "next/navigation";

/** Entwicklerseiten (/dev/*): nur in der Entwicklung erreichbar, in Produktion 404. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
