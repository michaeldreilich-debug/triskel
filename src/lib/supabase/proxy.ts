import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { r2ConnectOrigin } from "@/features/storage/config";
import {
  type AssuranceLevel,
  decideRoute,
  isSharePath,
  needsFactorStatus,
} from "@/lib/auth/routes";
import { contentSecurityPolicy, createNonce } from "@/lib/security/headers";
import { getSupabaseConfig } from "./config";

/** R2-Ursprung für `connect-src`; ohne Einrichtung (oder bei gesperrtem Test-Bucket) keiner. */
function r2Origin(): string | null {
  try {
    return r2ConnectOrigin();
  } catch {
    return null;
  }
}

/**
 * Session erneuern (Auth-Cookies), Routen schützen (inkl. zweitem Faktor, B16) und die CSP mit
 * einer Nonce je Anfrage setzen. Ohne Supabase-Konfiguration gilt niemand als angemeldet →
 * geschützte Seiten leiten auf /login.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const config = getSupabaseConfig();
  const csp = contentSecurityPolicy({
    nonce: createNonce(),
    supabaseUrl: config?.url,
    r2Origin: r2Origin(),
    // öffentliche Freigabe (#94): Bilder kommen per Umleitung direkt von R2
    r2Images: isSharePath(request.nextUrl.pathname),
    dev: process.env.NODE_ENV !== "production",
  });

  // Next.js liest die Nonce aus dem CSP-Header der Anfrage und versieht seine Skripte damit.
  // Neu aufbauen, wenn Supabase Cookies erneuert (request.cookies ändert die Anfrage-Header).
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers } });
  };

  let response = next();
  let authenticated = false;
  let aal: AssuranceLevel | null = null;
  let hasVerifiedFactor: boolean | undefined;

  if (config) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = next();
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    });
    // getClaims prüft das JWT (nicht nur das Cookie) – Grundlage für den Routenschutz.
    // aal steht im geprüften Token: „aal2“ erst nach bestätigtem zweitem Faktor.
    const { data } = await supabase.auth.getClaims();
    authenticated = Boolean(data?.claims?.sub);
    aal = data?.claims?.aal === "aal2" ? "aal2" : authenticated ? "aal1" : null;

    const { pathname, search } = request.nextUrl;
    if (needsFactorStatus({ pathname, search, authenticated, aal })) {
      // Nur mit Passwort angemeldet: beim Auth-Server nachfragen, ob schon ein Faktor besteht
      // (Abfrage oder Einrichtung). Fehler → unbekannt → Abfrage, nie Einrichtung.
      const { data: factors, error } = await supabase.auth.mfa.listFactors();
      if (!error) hasVerifiedFactor = factors.totp.length > 0;
    }
  }

  const decision = decideRoute({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    authenticated,
    aal,
    hasVerifiedFactor,
  });

  if (decision.type === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // erneuerte Auth-Cookies nicht verlieren
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}
