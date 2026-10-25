/**
 * TOTP-Codes für die Testnutzer (B16, E17). Das Geheimnis kommt aus .env.test.local
 * (E2E_USER_<A|B>_TOTP_SECRET, eingerichtet mit `node scripts/test-totp.mjs`) und wird nie
 * ausgegeben.
 */
import * as OTPAuth from "otpauth";

export function totpCode(secret: string, timestamp = Date.now()): string {
  if (!secret) {
    throw new Error(
      "TOTP-Geheimnis des Testnutzers fehlt in .env.test.local – `node scripts/test-totp.mjs` ausführen.",
    );
  }
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate({ timestamp });
}
