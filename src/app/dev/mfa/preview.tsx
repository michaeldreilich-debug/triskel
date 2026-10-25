"use client";

import { useMemo } from "react";
import { TotpChallenge, TotpSetup } from "@/features/auth/components/totp-forms";
import { type MfaApi, MfaError } from "@/features/auth/mfa";

/** Platzhalter im Stil des Supabase-QR-Codes (schwarz auf weiß), kein echter Schlüssel */
const DEMO_QR = `data:image/svg+xml;utf-8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 25 25' shape-rendering='crispEdges'>" +
    "<rect width='25' height='25' fill='white'/>" +
    [
      [2, 2],
      [16, 2],
      [2, 16],
    ]
      .map(
        ([x, y]) =>
          `<rect x='${x}' y='${y}' width='7' height='7' fill='black'/>` +
          `<rect x='${(x as number) + 1}' y='${(y as number) + 1}' width='5' height='5' fill='white'/>` +
          `<rect x='${(x as number) + 2}' y='${(y as number) + 2}' width='3' height='3' fill='black'/>`,
      )
      .join("") +
    "<rect x='11' y='11' width='3' height='3' fill='black'/></svg>",
)}`;

/** Gespielte Anbindung: Code 123456 gilt, alles andere ist falsch. */
function demoApi(): MfaApi {
  return {
    verifiedFactorId: async () => "demo",
    enroll: async () => ({
      factorId: "demo",
      qrCode: DEMO_QR,
      secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    }),
    verify: async (_factorId, code) => {
      if (code !== "123456")
        throw new MfaError(
          "Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.",
          "mfa_verification_failed",
        );
    },
    signOut: async () => {},
  };
}

export function MfaPreview({ view }: { view: "einrichten" | "abfrage" }) {
  const api = useMemo(demoApi, []);
  const next = `/dev/mfa?ansicht=${view}&bestaetigt=1`;
  return view === "einrichten" ? (
    <TotpSetup api={api} next={next} />
  ) : (
    <TotpChallenge api={api} next={next} />
  );
}
