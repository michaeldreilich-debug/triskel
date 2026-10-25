/**
 * Sicherheits-Header (B16, F3). Die CSP braucht je Anfrage eine neue Nonce und kommt deshalb aus
 * proxy.ts; die festen Header setzt next.config.ts für alle Antworten.
 *
 * - Skripte nur mit Nonce ('strict-dynamic': was Next.js mit Nonce lädt, darf nachladen).
 *   Next.js versieht seine Skripte selbst mit der Nonce aus dem CSP-Header der Anfrage
 *   (alle Seiten sind dynamisch, das Root-Layout liest Cookies).
 * - Styles: 'unsafe-inline', weil Radix, TipTap und sonner Inline-Styles setzen. Ohne Skripte
 *   lässt sich darüber kein Code ausführen.
 * - Verbindungen nur zur eigenen Seite, zum Supabase-Projekt (kein Realtime, E11) und – wenn
 *   eingerichtet – zum R2-Endpunkt des Kontos (Bilder/Dateien über signierte Links, E41). Bilder
 *   und PDFs laufen als Blob-URLs, `img-src`/`frame-src` bleiben unverändert.
 * - Bilder: data: für den QR-Code der MFA-Einrichtung (SVG von Supabase).
 * - Worker: von der eigenen Seite (pdf.js zeichnet PDFs in einem Worker, #27) und als blob: –
 *   `heic-to` startet seinen Worker aus einem Blob (iPhone-Fotos, #39). Blobs kann nur Code
 *   erzeugen, der schon läuft (und der braucht die Nonce).
 * - In der Entwicklung (next dev, auch E2E) braucht React 'unsafe-eval'; im Build nie.
 */
export interface CspOptions {
  nonce: string;
  supabaseUrl?: string | null;
  /** Ursprung des Dateispeichers (R2, E41); ohne Einrichtung nichts ergänzen */
  r2Origin?: string | null;
  /**
   * Bilder direkt von R2 (`img-src`): nur auf der öffentlichen Freigabe (#94) – dort lädt `<img>`
   * die Freigabe-Route, die auf einen signierten R2-Link umleitet (die CSP prüft das Ziel mit).
   * In der App bleiben Bilder Blobs.
   */
  r2Images?: boolean;
  dev: boolean;
}

/** Nur der Ursprung (`https://<ref>.supabase.co`), ohne Pfad; Ungültiges fällt weg. */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { origin, protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy({
  nonce,
  supabaseUrl,
  r2Origin,
  r2Images = false,
  dev,
}: CspOptions): string {
  const supabase = originOf(supabaseUrl);
  const r2 = originOf(r2Origin);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(r2Images && r2 ? [r2] : [])],
    "font-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "connect-src": ["'self'", ...(supabase ? [supabase] : []), ...(r2 ? [r2] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** Neue Nonce je Anfrage (128 Bit Zufall, Base64). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Zusätzlich für die öffentliche Freigabe (#94, E42) – Seite `/freigabe/*` und Dateien
 * `/api/freigabe/*`: nicht in Suchmaschinen, der Token geht nie über den Referer an verlinkte
 * Seiten, nichts zwischenspeichern (Beenden wirkt sofort). Gilt nach SECURITY_HEADERS (gewinnt).
 */
export const SHARE_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "private, no-store" },
];

/** Feste Header für alle Antworten (next.config.ts). */
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // Vercel liefert nur https; lokal über http ignorieren Browser den Header
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Adressen (z. B. /wissen/<id>) verlassen die App nicht; Supabase-Aufrufe sind CORS (Origin bleibt)
  { key: "Referrer-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
