import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/features/auth/components/auth-card";
import { MfaChallengeScreen } from "@/features/auth/components/mfa-screens";
import { MFA_CHALLENGE_TEXT } from "@/features/auth/mfa";

export const metadata: Metadata = { title: MFA_CHALLENGE_TEXT.title };

/** Abfrage nach dem Login (B16): ohne Code aus der Authenticator-App kein Zugang (aal2). */
export default function MfaPage() {
  return (
    <AuthCard {...MFA_CHALLENGE_TEXT}>
      <Suspense>
        <MfaChallengeScreen />
      </Suspense>
    </AuthCard>
  );
}
