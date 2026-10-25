import type { Metadata } from "next";
import { AuthCard } from "@/features/auth/components/auth-card";
import { MFA_CHALLENGE_TEXT, MFA_SETUP_TEXT } from "@/features/auth/mfa";
import { MfaPreview } from "./preview";

export const metadata: Metadata = { title: "MFA-Vorschau" };

/**
 * Vorschau der MFA-Seiten ohne Backend (nur Entwicklung, in Produktion 404): Die Einrichtung
 * braucht sonst einen Nutzer ohne Faktor, und die Testnutzer haben alle einen (B16).
 * ?ansicht=einrichten (Standard) | abfrage; Code 123456 gilt.
 */
export default async function MfaPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ ansicht?: string; bestaetigt?: string }>;
}) {
  const { ansicht, bestaetigt } = await searchParams;
  const view = ansicht === "abfrage" ? "abfrage" : "einrichten";
  if (bestaetigt) {
    return (
      <AuthCard title="Bestätigt" description="Vorschau: Hier ginge es weiter in die App.">
        <p className="text-ui text-muted">Nur in der Entwicklung · /dev/mfa</p>
      </AuthCard>
    );
  }
  return view === "einrichten" ? (
    <AuthCard {...MFA_SETUP_TEXT}>
      <MfaPreview view="einrichten" />
    </AuthCard>
  ) : (
    <AuthCard {...MFA_CHALLENGE_TEXT}>
      <MfaPreview view="abfrage" />
    </AuthCard>
  );
}
