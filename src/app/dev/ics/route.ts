/**
 * Test-Kalender für Entwicklung und E2E (S2a): liefert die eigene ICS aus den Fixtures, damit die
 * Kalender-Tests nie einen echten Google-Kalender brauchen. In Produktion 404 (wie /dev/*; das
 * Layout der Dev-Seiten gilt nicht für Route-Handler, deshalb hier selbst). Der Server lässt die
 * Adresse nur zu, wenn CALENDAR_ALLOWED_ORIGINS den eigenen Ursprung nennt (playwright.config.ts).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const FIXTURES = path.join(process.cwd(), "src", "features", "calendar", "__fixtures__");

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const name = new URL(request.url).searchParams.get("name") ?? "probe";
  if (!/^[a-z0-9-]+$/.test(name)) return new Response(null, { status: 404 });
  try {
    const text = await readFile(path.join(FIXTURES, `${name}.ics`), "utf8");
    return new Response(text, {
      headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
