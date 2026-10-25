import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/features/auth/components/auth-card";
import { MfaSetupScreen } from "@/features/auth/components/mfa-screens";
import { MFA_SETUP_TEXT } from "@/features/auth/mfa";

export const metadata: Metadata = { title: MFA_SETUP_TEXT.title };

/** Einmalige Einrichtung (B16): Ohne bestätigten Faktor führt jeder Weg in die App hierher. */
export default function MfaSetupPage() {
  return (
    <AuthCard {...MFA_SETUP_TEXT}>
      <Suspense>
        <MfaSetupScreen />
      </Suspense>
    </AuthCard>
  );
}
