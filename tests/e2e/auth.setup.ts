/**
 * Meldet Testnutzer A EINMAL je Lauf an – per API in Node, nicht über das Formular: So steht
 * das Passwort nie im Browser, in Reports oder Traces. Die Sitzungs-Cookies erzeugt
 * @supabase/ssr selbst (gleiches Format wie im Browser-Client). Schutzschalter zuerst.
 *
 * Danach wärmt er den Testserver auf (N4): `next dev` übersetzt jede Seite und jede Route erst
 * beim ersten Aufruf. Kamen die sieben Worker gleich zu Beginn gleichzeitig auf ungesehene
 * Seiten, dauerte das Übersetzen länger als die 7 s der Prüfungen (z. B. „Theme bleibt nach
 * Reload“ fand die Seite noch leer). Einmal nacheinander, bevor die Tests starten.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { AUTH_FILE } from "./support/auth";
import { sessionCookies } from "./support/session";

/** Seiten der App (je eine Adresse genügt – dynamische Seiten mit erfundener ID). */
const PAGES = [
  "/inbox",
  "/kalender",
  "/wissen",
  "/notizen",
  "/projekte",
  "/projekte/zeitstrahl",
  `/projekte/${crypto.randomUUID()}`,
  "/aufgaben",
  "/rueckblicke",
  `/rueckblicke/${crypto.randomUUID()}`,
  "/wochenreview",
  "/papierkorb",
  "/einstellungen",
];

/** Routen ohne Seite: nur übersetzen lassen (GET; Routen ohne GET antworten 405, auch gut). */
const ROUTES = [
  "/api/kalender?von=2026-12-07&bis=2026-12-13",
  "/api/kalender/termin",
  "/api/kalender/termin/verschieben-kalender",
  "/api/kalender/termin/wiederherstellen",
  "/api/kalender/probe",
  "/api/google/status",
  "/api/google/calendars",
  "/api/google/disconnect",
  "/dev/google/_test/state",
  "/dev/ics?name=probe",
];

setup("Testnutzer A anmelden", async ({ browser, baseURL }) => {
  setup.setTimeout(240_000);
  const url = baseURL as string;
  const context = await browser.newContext({ baseURL });
  await context.addCookies(await sessionCookies(url));
  const page = await context.newPage();
  await page.goto("/heute");
  await expect(page).toHaveURL(/\/heute$/);
  mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });

  for (const route of ROUTES) {
    await page.request.get(route, { maxRedirects: 0, timeout: 120_000 });
  }
  for (const target of PAGES) {
    await page.goto(target, { timeout: 120_000 });
    await expect(page.getByRole("main")).toBeVisible({ timeout: 60_000 });
  }
  await context.close();
});
