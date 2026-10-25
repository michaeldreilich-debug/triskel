import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ConsentScreen } from "@/features/ai/components/consent-screen";
import { CONSENT_PATH, CONSENT_TEXT } from "@/features/ai/consent";
import { AuthCard } from "@/features/auth/components/auth-card";
import { LOGIN_PATH, MFA_PATH } from "@/lib/auth/routes";
import { currentAuth } from "@/lib/supabase/user";

export const metadata: Metadata = { title: CONSENT_TEXT.title };

/**
 * Freigabe eines KI-Zugangs (#33): Supabase leitet Claude bzw. ChatGPT hierher. Erlauben nur mit
 * Login und zweitem Faktor – der Proxy leitet sonst um, hier zusätzlich abgesichert (wie das
 * App-Layout); der Rücksprung behält die authorization_id.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const auth = await currentAuth();
  const id = (await searchParams).authorization_id;
  const next = `${CONSENT_PATH}${id ? `?authorization_id=${encodeURIComponent(id)}` : ""}`;
  if (!auth) redirect(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
  if (auth.aal !== "aal2") redirect(`${MFA_PATH}?next=${encodeURIComponent(next)}`);
  return (
    <AuthCard title={CONSENT_TEXT.title} description={CONSENT_TEXT.description}>
      <Suspense>
        <ConsentScreen />
      </Suspense>
    </AuthCard>
  );
}
