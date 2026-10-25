import { redirect } from "next/navigation";
import { AppFrame } from "@/components/shell/app-frame";
import { LOGIN_PATH, MFA_PATH } from "@/lib/auth/routes";
import { DataProvider } from "@/lib/data/provider";
import { currentAuth } from "@/lib/supabase/user";

/**
 * Geschützter Bereich: proxy.ts leitet Abgemeldete auf /login und Nutzer ohne zweiten Faktor
 * (aal1) zur MFA-Seite; hier zusätzlich abgesichert. Die Datenbank erzwingt aal2 per RLS
 * (Migration 13).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await currentAuth();
  if (!auth) redirect(LOGIN_PATH);
  if (auth.aal !== "aal2") redirect(MFA_PATH);
  return (
    <DataProvider userId={auth.userId}>
      <AppFrame>{children}</AppFrame>
    </DataProvider>
  );
}
