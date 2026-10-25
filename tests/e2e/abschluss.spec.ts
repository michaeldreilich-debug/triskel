/**
 * Abschluss Stufe 1 (B15): Jede Hauptansicht in beiden Themes (Dunkel, Papier) bei 1440 px und
 * 390 px – axe ohne Verstöße (WCAG 2.1 A/AA inkl. Kontrast), kein horizontales Scrollen – und die
 * Sicherheits-Header auf einer App-Seite.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, mondayWeeksAgo, seedDb, seedProject, seedRecap } from "./support/seed";

test.use({ storageState: AUTH_FILE });

const THEMES = ["dark", "paper"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number], baseURL: string) {
  await page.context().addCookies([{ name: "sz-theme", value: theme, url: baseURL }]);
}

/** Seite laden, bis die Ladeskelette weg sind, dann prüfen. */
async function check(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
}

for (const theme of THEMES) {
  test(`Alle Hauptansichten ohne a11y-Verstöße und Überlauf (${theme})`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const prefix = uniqueName("Abschluss");
    const { beruf } = await areaIds();
    // aktiv ohne Ergebnis: Warnhinweise („festgefahren“) erscheinen auf Heute und im Projekt
    const projectId = await seedProject({
      title: `${prefix} Projekt`,
      area_id: beruf,
      status: "aktiv",
    });
    const noteId = crypto.randomUUID();
    const note = await (await seedDb())
      .from("notes")
      .insert({ id: noteId, title: `${prefix} Notiz`, area_id: beruf });
    expect(note.error).toBeNull();
    // eigene Woche je Viewport und Theme
    const week = 10 + (info.project.name === "mobile" ? 2 : 0) + (theme === "paper" ? 1 : 0);
    const recapId = await seedRecap({ period_start: mondayWeeksAgo(week), mood: 3 });
    await setTheme(page, theme, baseURL as string);

    for (const path of [
      "/heute",
      "/inbox",
      "/wissen",
      `/wissen/${noteId}`,
      "/rueckblicke",
      `/rueckblicke/${recapId}`,
      "/projekte",
      `/projekte/${projectId}`,
      "/aufgaben",
      "/notizen",
      "/papierkorb",
      "/einstellungen",
    ]) {
      await test.step(path, () => check(page, path));
    }
  });
}

test("Sicherheits-Header auf einer App-Seite @desktop", async ({ page }) => {
  const response = await page.goto("/heute");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("Seiten mit Dateiendung im Pfad bekommen dieselbe CSP (S-6) @desktop", async ({ page }) => {
  for (const path of ["/wissen/plan.png", "/projekte/logo.svg"]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.headers()["content-security-policy"], path).toMatch(/'strict-dynamic'/);
  }
});
