/**
 * GET /api/google/callback (#64, N1a): Rückkehr von der Google-Anmeldung. Geschützt wie jede
 * App-Route (Sitzung mit zweitem Faktor; die Weiterleitung von Google bringt das Sitzungs-Cookie
 * mit, SameSite=Lax). Prüft das Anmelde-Cookie (state, PKCE, derselbe Nutzer, nicht abgelaufen),
 * tauscht den Code, verlangt beide Berechtigungen und einen Refresh-Token, liest die Kalenderliste
 * (E-Mail = ID des primären Kalenders) und legt den Refresh-Token verschlüsselt ab – mit der
 * Sitzung des Nutzers, nie service_role. Zurück geht es immer nach Einstellungen › Kalender mit
 * einem festen Code; Tokens und Antworten von Google erscheinen nirgends.
 */
import { type NextRequest, NextResponse } from "next/server";
import { saveGoogleAccount } from "@/features/calendar/google/access";
import { listGoogleCalendars } from "@/features/calendar/google/calendar-api";
import {
  googleEndpoints,
  googleRedirectOrigin,
  readGoogleConfig,
} from "@/features/calendar/google/config";
import {
  callbackUrl,
  exchangeCode,
  missingScopes,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  openOAuthState,
  safeEqual,
  settingsReturnUrl,
} from "@/features/calendar/google/oauth";
import type { GoogleReturnCode } from "@/features/calendar/google/types";
import { clearGoogleEventsCache } from "@/features/calendar/server/load-all";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentAuth } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Zurück in die Einstellungen; das Anmelde-Cookie gilt nur einmal. */
const back = (request: Request, code: GoogleReturnCode) => {
  const response = NextResponse.redirect(settingsReturnUrl(request.url, code), 303);
  response.headers.set("cache-control", "private, no-store");
  response.cookies.set(OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
};

export async function GET(request: NextRequest): Promise<Response> {
  const params = new URL(request.url).searchParams;
  // Abgebrochen oder abgelehnt (Google schickt error=access_denied): nichts weiter tun
  const googleError = params.get("error");
  if (googleError) return back(request, googleError === "access_denied" ? "abgebrochen" : "fehler");

  const auth = await currentAuth();
  if (auth?.aal !== "aal2") return back(request, "anmeldung");
  const config = readGoogleConfig();
  if (!config.ok) return back(request, "nicht-eingerichtet");

  const saved = openOAuthState(request.cookies.get(OAUTH_COOKIE)?.value, config.config.tokenKey);
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (!saved || saved.userId !== auth.userId || !code || !safeEqual(state, saved.state)) {
    return back(request, "abgelaufen");
  }

  const endpoints = googleEndpoints();
  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(endpoints, {
      clientId: config.config.clientId,
      clientSecret: config.config.clientSecret,
      code,
      verifier: saved.verifier,
      redirectUri: callbackUrl(googleRedirectOrigin(request.url)),
    });
  } catch {
    return back(request, "fehler");
  }
  // Tokens aus einem abgebrochenen Ablauf werden nur verworfen, nie widerrufen: Widerrufen träfe
  // die ganze Freigabe – auch eine bestehende Verbindung desselben Kontos.
  if (!tokens.refreshToken) return back(request, "fehler");
  if (missingScopes(tokens.scope).length > 0) return back(request, "berechtigung");

  let email: string | null = null;
  try {
    const calendars = await listGoogleCalendars(endpoints, tokens.accessToken);
    email = calendars.find((c) => c.primary)?.id ?? null;
  } catch {
    email = null;
  }
  if (!email) return back(request, "fehler");

  try {
    await saveGoogleAccount(
      await createServerSupabase(),
      auth.userId,
      { email, refreshToken: tokens.refreshToken, scope: tokens.scope },
      config.config.tokenKey,
    );
  } catch {
    return back(request, "fehler");
  }
  // ggf. ein anderes Konto als vorher: nichts aus dem Speicher der alten Verbindung zeigen (G-5)
  clearGoogleEventsCache(auth.userId);
  return back(request, "verbunden");
}
