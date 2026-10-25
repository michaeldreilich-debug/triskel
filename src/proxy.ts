import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Nur Next-eigene statische Dateien auslassen: public/ hat nur das Triskel-Symbol (öffentlich über
  // PUBLIC_FILES in routes.ts, wie die App-Icons), Schriften und pdf.js liegen
  // unter /_next/static. Ein Ausschluss nach Dateiendung ließe Seiten wie /wissen/x.png ohne CSP
  // und ohne Cookie-Erneuerung durch (S-6).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
