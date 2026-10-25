/**
 * Google-Ersatz für Entwicklung und E2E (#64, N1a): OAuth und Calendar API nachgebildet
 * (`src/features/calendar/google/fake.ts`), damit kein Test ein echtes Google-Konto braucht. In
 * Produktion 404 (wie /dev/ics; das Layout der Dev-Seiten gilt nicht für Route-Handler). Die
 * App spricht ihn nur an, wenn NODE_ENV=test die Basis-Adressen umbiegt (playwright.config.ts).
 */
import { handleFakeGoogle } from "@/features/calendar/google/fake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = async (request: Request): Promise<Response> => {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  return handleFakeGoogle(request);
};

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
