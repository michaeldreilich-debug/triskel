/**
 * Datei einer öffentlich freigegebenen Notiz (#94, E42) – ohne Anmeldung. Dünne Route; Prüfung und
 * Signieren: `src/features/storage/shared.ts`.
 */
import { type R2Config, readR2Config } from "@/features/storage/config";
import { handleSharedFile, sharedFileLookup } from "@/features/storage/shared";
import { createAnonSupabase } from "@/lib/supabase/anon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const query = new URL(request.url).searchParams;
  let config: R2Config | null;
  try {
    config = readR2Config();
  } catch {
    config = null;
  }
  return handleSharedFile(
    { token, path: query.get("pfad"), name: query.get("name") },
    { config, lookup: (t, p) => sharedFileLookup(createAnonSupabase())(t, p) },
  );
}
