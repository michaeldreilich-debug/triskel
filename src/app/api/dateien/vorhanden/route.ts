/** Dünne Route – Ablauf und Fehlercodes: `src/features/storage/handlers.ts`. */
import { openFileRequest } from "@/features/storage/access";
import { handleExists } from "@/features/storage/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const opened = await openFileRequest(request);
  if (opened instanceof Response) return opened;
  return handleExists(opened.context, opened.body);
}
