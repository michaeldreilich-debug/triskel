/**
 * GET /api/google/start (#64, N1a): „Mit Google verbinden“ aus Einstellungen › Kalender. Nur
 * angemeldet mit zweitem Faktor (der Proxy prüft das schon, hier noch einmal). Legt state und
 * PKCE-Verifier verschlüsselt in ein kurzlebiges httpOnly-Cookie (Secure, SameSite=Lax, nur
 * /api/google) und leitet zur Google-Anmeldung. Ein Link, kein Formular: `form-action 'self'`
 * der CSP gälte auch für die Weiterleitung zu Google. Der Rücksprung ist in Produktion fest
 * (`googleRedirectOrigin`, G-2); ist die App über eine andere Adresse geöffnet, geht es zuerst
 * dorthin – das Cookie muss beim Rücksprung auf derselben Adresse liegen.
 */
import { NextResponse } from "next/server";
import {
  googleEndpoints,
  googleRedirectOrigin,
  readGoogleConfig,
} from "@/features/calendar/google/config";
import {
  buildAuthUrl,
  callbackUrl,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  OAUTH_MAX_AGE_S,
  pkceChallenge,
  randomToken,
  START_PATH,
  sealOAuthState,
  settingsReturnUrl,
} from "@/features/calendar/google/oauth";
import { currentAuth } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (request: Request, code: string) => {
  const response = NextResponse.redirect(settingsReturnUrl(request.url, code), 303);
  response.headers.set("cache-control", "private, no-store");
  return response;
};

export async function GET(request: Request): Promise<Response> {
  const auth = await currentAuth();
  if (auth?.aal !== "aal2") return back(request, "anmeldung");
  const config = readGoogleConfig();
  if (!config.ok) return back(request, "nicht-eingerichtet");
  const origin = googleRedirectOrigin(request.url);
  const here = new URL(request.url);
  // andere Adresse (z. B. Vercel-Alias): einmal zur festen wechseln (`?fest=1` verhindert Schleifen)
  if (here.origin !== origin && !here.searchParams.has("fest")) {
    const canonical = new URL(START_PATH, origin);
    canonical.searchParams.set("fest", "1");
    const response = NextResponse.redirect(canonical, 303);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }

  const state = randomToken();
  const verifier = randomToken();
  const sealed = sealOAuthState(
    { state, verifier, userId: auth.userId, expires: Date.now() + OAUTH_MAX_AGE_S * 1000 },
    config.config.tokenKey,
  );
  const target = buildAuthUrl(googleEndpoints(), {
    clientId: config.config.clientId,
    redirectUri: callbackUrl(origin),
    state,
    challenge: pkceChallenge(verifier),
  });
  const response = NextResponse.redirect(target, 303);
  response.headers.set("cache-control", "private, no-store");
  response.cookies.set(OAUTH_COOKIE, sealed, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_MAX_AGE_S,
  });
  return response;
}
