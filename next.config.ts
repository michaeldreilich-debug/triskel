import type { NextConfig } from "next";
import { SECURITY_HEADERS, SHARE_HEADERS } from "./src/lib/security/headers";

// Bewusst ohne cacheComponents: Die App ist client-first (supabase-js + TanStack Query),
// jede Route hängt von der Anmeldung ab, und das Root-Layout liest das Theme aus einem Cookie
// (kein Inline-Skript). Siehe docs/session-log.md, Entscheidungen.
const nextConfig: NextConfig = {
  // E2E-Tests bauen in ein eigenes Verzeichnis (playwright.config.ts)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  // KI-Schnittstelle (#71): pdf.js liest PDF-Text auf dem Server – unverpackt aus node_modules,
  // damit der Worker (im selben Prozess) mitkommt; sharp ist bei Next ohnehin extern
  serverExternalPackages: ["pdfjs-dist"],
  // Feste Sicherheits-Header für alle Antworten; die CSP (mit Nonce) setzt proxy.ts (B16).
  // Öffentliche Freigabe (#94) danach: gleiche Schlüssel überschreiben (Referrer-Policy)
  async headers() {
    return [
      { source: "/:path*", headers: [...SECURITY_HEADERS] },
      { source: "/freigabe/:path*", headers: [...SHARE_HEADERS] },
      { source: "/api/freigabe/:path*", headers: [...SHARE_HEADERS] },
    ];
  },
  // In den E2E-Läufen ohne Entwickler-Anzeige: hing sie auf „Compiling …“, verdeckte die breite
  // Pille am Handy den „Rückgängig“-Knopf der Meldungen (18.10.2026, auch auf main)
  devIndicators: process.env.E2E_NO_DEV_INDICATOR ? false : { position: "bottom-right" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
