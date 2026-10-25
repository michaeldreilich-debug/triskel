/**
 * Zweiter Faktor (TOTP) über Supabase Auth (B16). Die Oberfläche spricht nur mit `MfaApi`,
 * damit sich die Seiten ohne Backend zeigen und testen lassen (/dev/mfa).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const TOTP_DIGITS = 6;
/** Name des Faktors (im Supabase-Dashboard) und Aussteller (in der Authenticator-App) */
export const FACTOR_NAME = "Authenticator";
export const ISSUER = "Triskel";

/** Titel und Beschreibung der MFA-Seiten (auch für die Vorschau /dev/mfa) */
export const MFA_CHALLENGE_TEXT = {
  title: "Zweiter Faktor",
  description: "Code aus der Authenticator-App eingeben.",
} as const;
export const MFA_SETUP_TEXT = {
  title: "Zweiten Faktor einrichten",
  description:
    "Einmalig: Ab jetzt fragt die Anmeldung zusätzlich einen Code aus der Authenticator-App ab.",
} as const;

/** Nur Ziffern, höchstens 6 („123 456“ aus der App einfügen geht also auch). */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, TOTP_DIGITS);
}

/** Geheimnis in Vierergruppen zum Abtippen. */
export function formatSecret(secret: string): string {
  return (
    secret
      .replace(/\s+/g, "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? ""
  );
}

export class MfaError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MfaError";
  }
}

/** Verständliche Meldung zu einem Fehler von Supabase Auth. */
export function mfaErrorMessage(error: {
  code?: string;
  name?: string;
  status?: number;
  message: string;
}) {
  // Sitzung weg: z. B. hat eine Bestätigung auf einem anderen Gerät diese (aal1-)Sitzung beendet
  if (error.name === "AuthSessionMissingError") {
    return "Die Anmeldung ist abgelaufen. Bitte abmelden und neu anmelden.";
  }
  switch (error.code) {
    case "mfa_verification_failed":
      return "Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.";
    case "mfa_factor_not_found":
      // z. B. Einrichtung in einem zweiten Fenster neu gestartet (räumt unbestätigte Faktoren ab)
      return "Diese Einrichtung gilt nicht mehr (anderswo neu gestartet). Seite neu laden und den neuen QR-Code scannen.";
    case "mfa_challenge_expired":
      return "Die Abfrage ist abgelaufen. Bitte den Code noch einmal eingeben.";
    case "mfa_totp_enroll_not_enabled":
    case "mfa_totp_verify_not_enabled":
      return "TOTP ist im Supabase-Projekt ausgeschaltet (Authentication → Multi-Factor).";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
      return "Die Anmeldung ist abgelaufen. Bitte abmelden und neu anmelden.";
    case "over_request_rate_limit":
      return "Zu viele Versuche. Bitte kurz warten.";
  }
  if (error.status === 429) return "Zu viele Versuche. Bitte kurz warten.";
  return `Das hat nicht geklappt: ${error.message}`;
}

export interface TotpEnrollment {
  factorId: string;
  /** SVG als data:-URL (von Supabase) */
  qrCode: string;
  /** Base32-Geheimnis zum Abtippen */
  secret: string;
}

export interface MfaApi {
  /** ID des bestätigten TOTP-Faktors oder null */
  verifiedFactorId(): Promise<string | null>;
  /** Abgebrochene Einrichtungen entfernen und einen neuen TOTP-Faktor anlegen */
  enroll(): Promise<TotpEnrollment>;
  /** Code prüfen; danach ist die Sitzung aal2 (wirft MfaError) */
  verify(factorId: string, code: string): Promise<void>;
  /** Nur diese Sitzung beenden */
  signOut(): Promise<void>;
}

type AuthFailure = { code?: string; name?: string; status?: number; message: string } | null;

function check(error: AuthFailure): void {
  if (error) throw new MfaError(mfaErrorMessage(error), error.code);
}

export function createMfaApi(supabase: SupabaseClient): MfaApi {
  const mfa = supabase.auth.mfa;
  return {
    async verifiedFactorId() {
      const { data, error } = await mfa.listFactors();
      check(error);
      return data?.totp[0]?.id ?? null;
    },
    async enroll() {
      const { data: factors, error: listError } = await mfa.listFactors();
      check(listError);
      // Ein Neuladen der Einrichtung hinterlässt unbestätigte Faktoren (gleicher Name → Konflikt)
      for (const factor of factors?.all ?? []) {
        if (factor.status === "verified") continue;
        const { error } = await mfa.unenroll({ factorId: factor.id });
        check(error);
      }
      const { data, error } = await mfa.enroll({
        factorType: "totp",
        friendlyName: FACTOR_NAME,
        issuer: ISSUER,
      });
      check(error);
      if (data?.type !== "totp") throw new MfaError("Einrichten fehlgeschlagen.");
      return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
    },
    async verify(factorId, code) {
      const { error } = await mfa.challengeAndVerify({ factorId, code });
      check(error);
    },
    async signOut() {
      await supabase.auth.signOut({ scope: "local" });
    },
  };
}
